import { ProductError } from "../platform/zhihu/errors.ts";
import type { ZhidaGateway } from "../platform/zhihu/zhida.ts";
import type { ContentGateway, ContentSource } from "../platform/zhihu/content.ts";
import type { ZodType } from "zod";
import {
  ProCoverageOutput as ProCoverageOutputSchema,
  ProPlanOutput as ProPlanOutputSchema,
} from "../contracts/research.ts";
import type {
  ProCoverageOutput as ProCoverageOutputType,
  ProPlanOutput as ProPlanOutputType,
} from "../contracts/research.ts";
import { PRO_LIMITS, PRO_ORCHESTRATION, TIER_ZHIDA_MODEL } from "./research-baseline.ts";
import {
  buildCoveragePrompt,
  buildPlanPrompt,
  buildReportPrompt,
  parseProOutput,
} from "./research-pro-prompt.ts";
import type {
  AnswerMaterial,
  AnswerSource,
  QuickAnswer,
  ResearchAnalysis,
  ResearchPlan,
  ResearchProEvent,
  TaskDetail,
} from "../contracts/research.ts";

/**
 * 网页端的深度研究 Pro：单请求内跑完的多轮编排（ADR-0014）。
 *
 * 拆题（直答 fast）→ 逐子问题检索取证 → 覆盖判断（直答 fast）→ 成稿（直答 agent，流式）。
 * 只在知乎自己的检索与直答两个能力上编排：不引入引擎、store 与 libsql，不落库，
 * 因此能在 Serverless 单个请求内完成。轮数与总预算有界，落在函数执行上限内。
 *
 * 产出与快答同构（TaskDetail + QuickAnswer），并额外带上计划与覆盖判断：
 * 界面据此展示子问题与取证状态。资料是检索摘要，仍不进入 Ultra 的已保存来源表。
 */

export type ResearchProInput = {
  requestId: string;
  question: string;
  allowWebSupplement?: boolean;
};

export type ResearchProResult = { detail: TaskDetail; accepted: boolean };

export function createResearchProCommand(input: {
  zhida: ZhidaGateway;
  content: Pick<ContentGateway, "searchZhihu" | "searchGlobal">;
  clock?: () => Date;
  /** 任务 ID 生成器；测试可注入固定值，默认取创建请求的 requestId。 */
  nextId?: (requestId: string) => string;
}) {
  const clock = input.clock ?? (() => new Date());
  const nextId = input.nextId ?? ((requestId: string) => `pro-${requestId}`);

  return {
    async execute(request: ResearchProInput, options: {
      signal?: AbortSignal;
      onEvent?: (event: ResearchProEvent) => void | Promise<void>;
    } = {}): Promise<ResearchProResult> {
      const question = request.question.trim();
      if (!question) throw new ProductError("INVALID_INPUT", "研究问题不能为空。");
      const allowWebSupplement = request.allowWebSupplement ?? false;
      const createdAt = clock().toISOString();
      const deadline = clock().getTime() + PRO_LIMITS.timeoutMs;
      const remainingMs = () => deadline - clock().getTime();
      options.signal?.throwIfAborted();
      await options.onEvent?.({ type: "started", question, createdAt });

      let modelRequests = 0;
      let searchRequests = 0;
      let searchFailures = 0;
      let webSearches = 0;
      const sources: AnswerSource[] = [];
      const seenUrls = new Set<string>();

      /** 拆题与覆盖判断共用的结构化调用；模型调用次数在这里统一记账。 */
      async function askJson<T>(prompt: string, schema: ZodType<T>): Promise<T | undefined> {
        const response = await input.zhida.answer({
          model: PRO_ORCHESTRATION.planningModel,
          prompt,
          signal: options.signal,
        });
        modelRequests += 1;
        return parseProOutput(response.content, schema);
      }

      /** 检索并登记资料：编号在首次登记时分配，跨轮保持稳定；单次失败不中断编排。 */
      async function searchAndCollect(query: string, channel: "zhihu" | "web"): Promise<void> {
        const text = query.trim();
        if (!text) return;
        const signal = AbortSignal.any([
          ...(options.signal ? [options.signal] : []),
          AbortSignal.timeout(PRO_ORCHESTRATION.perSearchTimeoutMs),
        ]);
        try {
          const result = channel === "zhihu"
            ? await input.content.searchZhihu({ query: text, count: PRO_ORCHESTRATION.zhihuCount, signal })
            : await input.content.searchGlobal({ query: text, count: PRO_ORCHESTRATION.webCount, signal });
          for (const item of result.items) {
            if (sources.length >= PRO_ORCHESTRATION.materialLimit) return;
            const source = referenceSource(item, sources.length + 1);
            if (!source) continue;
            const key = dedupeKey(source.url);
            if (seenUrls.has(key)) continue;
            seenUrls.add(key);
            sources.push(source);
          }
        } catch {
          // 单次检索失败如实记账，不伪装成功；成稿时按资料不足处理。
          searchFailures += 1;
        }
      }

      /** 一轮取证：按并发上限执行有界检索，返回本轮实际发起的检索次数。 */
      async function runSearches(queries: readonly { query: string }[]): Promise<number> {
        const jobs: Array<() => Promise<void>> = [];
        let planned = 0;
        for (const item of queries) {
          if (planned >= PRO_LIMITS.maxSearchRequests) break;
          jobs.push(() => searchAndCollect(item.query, "zhihu"));
          planned += 1;
          if (allowWebSupplement && webSearches < PRO_ORCHESTRATION.maxWebSearches && planned < PRO_LIMITS.maxSearchRequests) {
            webSearches += 1;
            jobs.push(() => searchAndCollect(item.query, "web"));
            planned += 1;
          }
        }
        let cursor = 0;
        const workers = Array.from(
          { length: Math.min(PRO_LIMITS.maxConcurrentSearches, jobs.length) },
          async () => {
            while (cursor < jobs.length) {
              const job = jobs[cursor];
              cursor += 1;
              if (job) await job();
            }
          },
        );
        await Promise.all(workers);
        return planned;
      }

      // ---- 拆题：两次尝试（含一次重试）；都失败则退回单轮取证，不整单失败 ----
      let plan: ResearchPlan | null = null;
      {
        const prompt = buildPlanPrompt(question);
        for (let attempt = 0; attempt < 2 && plan === null; attempt += 1) {
          const parsed = await askJson<ProPlanOutputType>(prompt, ProPlanOutputSchema);
          if (parsed) plan = toPlan(parsed);
        }
        if (plan) await options.onEvent?.({ type: "plan", plan, round: 0 });
      }

      // ---- 取证循环：有界轮数；时间预算到点即转入成稿 ----
      let analysis: ResearchAnalysis | null = null;
      {
        const maxRounds = plan ? PRO_ORCHESTRATION.maxRounds : 1;
        let nextQueries: Array<{ questionId: string; query: string }> = [];
        let stop = false;
        for (let round = 1; round <= maxRounds && !stop; round += 1) {
          if (remainingMs() <= PRO_LIMITS.synthesisTimeReserveMs) break;
          const queries = round === 1
            ? plan
              ? plan.questions.map((item) => ({ questionId: item.id, query: item.text }))
              : [{ questionId: "", query: question }]
            : nextQueries;
          if (queries.length === 0) break;
          searchRequests += await runSearches(queries);
          options.signal?.throwIfAborted();
          // 无计划（拆题降级）时没有子问题可判断，一轮取证后直接成稿。
          if (!plan) break;
          if (remainingMs() <= PRO_LIMITS.synthesisTimeReserveMs) break;
          const prompt = buildCoveragePrompt({
            question,
            plan,
            sources,
            round,
            maxQueries: PRO_ORCHESTRATION.maxQueriesPerRound,
          });
          let parsed: ProCoverageOutputType | undefined;
          for (let attempt = 0; attempt < 2 && parsed === undefined; attempt += 1) {
            parsed = await askJson<ProCoverageOutputType>(prompt, ProCoverageOutputSchema);
          }
          // 覆盖判断失败：保留已得来源照样成稿，不因一次判断失败丢失整轮取证。
          if (!parsed) break;
          const projected = toAnalysis(parsed, plan);
          if (!projected) break;
          analysis = projected;
          await options.onEvent?.({ type: "coverage", analysis, round });
          stop = parsed.stop;
          nextQueries = sanitizeNextQueries(parsed.nextQueries, plan);
        }
      }

      // ---- 成稿：资料在生成前随 material 事件发出（与单轮 Pro 的时序一致）----
      const material: AnswerMaterial = {
        status: sources.length > 0 ? (searchFailures > 0 ? "partial" : "ready") : (searchFailures > 0 ? "failed" : "empty"),
        sources,
        warning: searchFailures > 0 ? "部分检索未能完成，本次回答可能缺少相关依据。" : null,
      };
      await options.onEvent?.({ type: "material", material });

      const reportPrompt = buildReportPrompt({
        question,
        plan: plan ?? fallbackPlan(question),
        sources,
      });
      const response = await input.zhida.answer({
        model: TIER_ZHIDA_MODEL.pro,
        prompt: reportPrompt,
        signal: options.signal,
        onDelta: (text) => options.onEvent?.({ type: "answer_delta", text }),
      });
      modelRequests += 1;
      options.signal?.throwIfAborted();

      const answer: QuickAnswer = {
        content: response.content,
        model: response.model,
        generatedAt: clock().toISOString(),
        material,
      };
      const detail: TaskDetail = {
        id: nextId(request.requestId),
        question,
        status: "completed",
        stage: null,
        createdAt,
        endedAt: answer.generatedAt,
        // 来源计数仍专指 Ultra 的已保存来源；参考资料随 answer.material 返回。
        sourceCount: 0,
        reportId: null,
        error: null,
        tier: "pro",
        allowWebSupplement,
        // 计划与覆盖判断是本档的编排产物；findings 仍为空，不进入证据体系。
        plan,
        findings: [],
        analysis,
        queries: [],
        usage: {
          searchRequests,
          modelRequests,
          inputTokens: response.usage?.inputTokens ?? null,
          outputTokens: response.usage?.outputTokens ?? null,
          cachedInputTokens: null,
          elapsedMs: Math.max(0, Date.parse(answer.generatedAt) - Date.parse(createdAt)),
        },
        limits: { ...PRO_LIMITS },
        modelInfo: { provider: "zhihu-zhida", modelId: TIER_ZHIDA_MODEL.pro },
        answer,
      };
      await options.onEvent?.({ type: "completed", detail });
      return { detail, accepted: true };
    },
  };
}

/** 拆题输出 → 产品计划：子问题 ID 由应用按序分配，不接受模型自造 ID。 */
function toPlan(output: ProPlanOutputType): ResearchPlan {
  return {
    version: 1,
    objective: output.objective,
    assumptions: [],
    questions: output.questions.map((item, index) => ({
      id: `q${index + 1}`,
      text: item.text,
      priority: item.priority,
      closedReason: null,
    })),
  };
}

/** 覆盖输出 → 产品分析：只接受计划里真实存在的子问题，全部无效则视为判断失败。 */
function toAnalysis(output: ProCoverageOutputType, plan: ResearchPlan): ResearchAnalysis | null {
  const openIds = new Set(plan.questions.filter((item) => item.closedReason === null).map((item) => item.id));
  const answers = output.answers.filter((item) => openIds.has(item.questionId)).map((item) => ({
    questionId: item.questionId,
    coverage: item.coverage,
    text: item.text,
    findingIds: [],
    gaps: item.gaps,
  }));
  return answers.length > 0 ? { answers } : null;
}

/** 下一轮查询只保留指向开放子问题的项，并截到单轮上限。 */
function sanitizeNextQueries(
  nextQueries: readonly { questionId: string; query: string }[],
  plan: ResearchPlan,
): Array<{ questionId: string; query: string }> {
  const openIds = new Set(plan.questions.filter((item) => item.closedReason === null).map((item) => item.id));
  const seen = new Set<string>();
  const out: Array<{ questionId: string; query: string }> = [];
  for (const item of nextQueries) {
    const query = item.query.trim();
    if (!openIds.has(item.questionId) || !query || seen.has(query)) continue;
    seen.add(query);
    out.push({ questionId: item.questionId, query });
    if (out.length >= PRO_ORCHESTRATION.maxQueriesPerRound) break;
  }
  return out;
}

/** 拆题降级时的占位计划：只用于成稿提示词，不写进 TaskDetail.plan。 */
function fallbackPlan(question: string): ResearchPlan {
  return {
    version: 1,
    objective: question,
    assumptions: [],
    questions: [{ id: "q1", text: question, priority: "high", closedReason: null }],
  };
}

/** 检索结果 → 参考资料：只接受 http/https + 有摘要的条目，编号由应用分配。 */
function referenceSource(item: ContentSource, number: number): AnswerSource | null {
  let url: URL;
  try { url = new URL(item.url); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || !item.summary.trim()) return null;
  return {
    number,
    title: item.title,
    url: item.url,
    excerpt: item.summary.slice(0, 1600),
    author: item.authorName ?? null,
    channel: item.kind === "global_search" ? "web" : "zhihu",
  };
}

/** 去重键：忽略协议/主机的书写差异与查询串，避免同一链接以不同参数重复入列。 */
function dedupeKey(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return url.origin + url.pathname;
  } catch {
    return rawUrl;
  }
}
