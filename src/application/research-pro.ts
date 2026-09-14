import { ProductError } from "../platform/zhihu/errors.ts";
import type { ZhidaGateway } from "../platform/zhihu/zhida.ts";
import type { ResearchProEvent } from "../contracts/research.ts";
import { DEFAULT_LIMITS, TIER_ZHIDA_MODEL } from "./research-baseline.ts";
import type {
  QuickAnswer,
  TaskDetail,
} from "../contracts/research.ts";

/**
 * 网页端的深度研究 Pro：单次调用知乎直答（`zhida-agent`）并返回终端结果。
 *
 * 与自研 Ultra 引擎是两条路：这里不拆题、不取证、不产生来源引用，也不落库——
 * 网页端是 Serverless，没有可写入的持久目录，任务列表在那侧始终为空。
 * 因此本命令不引入引擎、store 与 libsql，只依赖无依赖的档位常量模块，
 * 避免为了承接一次直答把整套本地存储拖进函数包。
 *
 * 产出的 TaskDetail 与引擎的 Pro 分支形状一致，前端沿用同一个快答渲染。
 */

export type ResearchProInput = {
  requestId: string;
  question: string;
};

export type ResearchProResult = { detail: TaskDetail; accepted: boolean };

export function createResearchProCommand(input: {
  zhida: ZhidaGateway;
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
      const model = TIER_ZHIDA_MODEL.pro;
      const createdAt = clock().toISOString();
      options.signal?.throwIfAborted();
      await options.onEvent?.({ type: "started", question, createdAt });
      const response = await input.zhida.answer({
        model,
        prompt: question,
        signal: options.signal,
        onDelta: (text) => options.onEvent?.({ type: "answer_delta", text }),
      });
      options.signal?.throwIfAborted();
      const answer: QuickAnswer = {
        content: response.content,
        model: response.model,
        generatedAt: clock().toISOString(),
      };
      const detail: TaskDetail = {
        id: nextId(request.requestId),
        question,
        status: "completed",
        stage: null,
        createdAt,
        endedAt: answer.generatedAt,
        sourceCount: 0,
        reportId: null,
        error: null,
        tier: "pro",
        allowWebSupplement: false,
        // 快答不产生计划、findings、分析与来源；这些字段保持空，界面据此只渲染正文。
        plan: null,
        findings: [],
        analysis: null,
        queries: [],
        usage: {
          searchRequests: 0,
          // 一次直答即一次模型调用；与引擎 Pro 分支的记账口径一致。
          modelRequests: 1,
          inputTokens: response.usage?.inputTokens ?? null,
          outputTokens: response.usage?.outputTokens ?? null,
          cachedInputTokens: null,
          elapsedMs: Math.max(0, Date.parse(answer.generatedAt) - Date.parse(createdAt)),
        },
        limits: { ...DEFAULT_LIMITS },
        modelInfo: { provider: "zhihu-zhida", modelId: model },
        answer,
      };
      await options.onEvent?.({ type: "completed", detail });
      return { detail, accepted: true };
    },
  };
}
