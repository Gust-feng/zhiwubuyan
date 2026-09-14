/**
 * 网页端深度研究 Pro 验证：确认它按「拆题 → 取证 → 覆盖判断 → 成稿」多轮编排，
 * 产出终端 TaskDetail，且不依赖引擎/store（因此能在 Serverless 里承接）。
 * 用假直答与假检索网关驱动，不触网、不消耗真实额度；不代表真实上游内容质量。
 */
import { createResearchProCommand } from "../application/research-pro.ts";
import { PRO_LIMITS, TIER_ZHIDA_MODEL } from "../application/research-baseline.ts";
import { TaskDetail as TaskDetailSchema } from "../contracts/research.ts";
import { isProductError, ProductError } from "../platform/zhihu/errors.ts";
import type { ZhidaGateway } from "../platform/zhihu/zhida.ts";
import type { ContentGateway, ContentSource } from "../platform/zhihu/content.ts";

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

const PLAN_JSON = JSON.stringify({
  objective: "为什么要做缓存",
  questions: [
    { text: "缓存解决什么问题", priority: "high" },
    { text: "缓存有哪些代价", priority: "normal" },
    { text: "缓存何时不适用", priority: "normal" },
  ],
});
const COVERAGE_JSON = JSON.stringify({
  answers: [
    { questionId: "q1", coverage: "supported", text: "有依据。", gaps: [] },
    { questionId: "q2", coverage: "partial", text: "部分依据。", gaps: ["缺少成本数据"] },
    { questionId: "q3", coverage: "unanswered", text: "暂无。", gaps: ["缺少资料"] },
  ],
  nextQueries: [],
  stop: true,
});

/** 假直答：按提示词区分拆题/覆盖/成稿，记录模型名与提示词。 */
function makeZhida(recorder: { models: string[]; prompts: string[]; script?: (prompt: string) => string | undefined }): ZhidaGateway {
  return {
    async answer(input) {
      recorder.models.push(input.model);
      recorder.prompts.push(input.prompt);
      if (input.model === TIER_ZHIDA_MODEL.pro) {
        return { model: input.model, content: "# 报告\n\n## 结论\n有依据的结论 [1]。", finishReason: "stop", usage: { inputTokens: 12, outputTokens: 34 } };
      }
      const override = recorder.script?.(input.prompt);
      const content = override ?? (input.prompt.includes("拆题员") ? PLAN_JSON : COVERAGE_JSON);
      return { model: input.model, content, finishReason: "stop", usage: { inputTokens: 3, outputTokens: 5 } };
    },
  };
}

function source(index: number): ContentSource {
  return {
    id: `zhihu_search:${index}`,
    kind: "zhihu_search",
    title: `资料 ${index}`,
    url: `https://www.zhihu.com/question/1/answer/${index}`,
    summary: `这是第 ${index} 条摘要。`,
    authorName: `作者 ${index}`,
    fetchedAt: "2026-09-15T00:00:00.000Z",
  };
}

function makeContent(recorder?: { queries: string[]; webCount: number }): Pick<ContentGateway, "searchZhihu" | "searchGlobal"> {
  return {
    async searchZhihu(input) {
      recorder?.queries.push(input.query);
      return { kind: "zhihu_search", fetchedAt: "2026-09-15T00:00:00.000Z", items: [source(recorder?.queries.length ?? 1)] };
    },
    async searchGlobal(input) {
      recorder?.queries.push(input.query);
      if (recorder) recorder.webCount += 1;
      return { kind: "global_search", fetchedAt: "2026-09-15T00:00:00.000Z", items: [source(100 + (recorder?.webCount ?? 0))] };
    },
  };
}

// —— 正常路径：多轮编排、终端结果、DTO 符合契约 ——
{
  const recorder = { models: [] as string[], prompts: [] as string[] };
  const contentRecorder = { queries: [] as string[], webCount: 0 };
  const command = createResearchProCommand({
    zhida: makeZhida(recorder),
    content: makeContent(contentRecorder),
    clock: () => new Date("2026-09-15T00:00:00.000Z"),
  });
  const events: string[] = [];
  const result = await command.execute(
    { requestId: "req-1", question: "  为什么要做缓存？  " },
    { onEvent: (event) => { events.push(event.type); } },
  );

  const detail = result.detail;
  check(detail.status === "completed", "Pro 应在创建时就返回终态");
  check(detail.tier === "pro", "产出档位应为 pro");
  check(detail.answer !== null && detail.answer.content.length > 0, "应带成稿正文");
  check(detail.sourceCount === 0, "Pro 不产生已保存来源计数");
  check(detail.reportId === null, "Pro 不产生已保存报告");
  // 编排产物：计划与覆盖判断必须落进 TaskDetail。
  check(detail.plan !== null && detail.plan.questions.length === 3, "拆题应产出 3 个子问题");
  check(detail.plan?.questions.every((question) => /^q\d+$/.test(question.id)) === true, "子问题 ID 应由应用按序分配");
  check(detail.analysis !== null && detail.analysis.answers.length === 3, "覆盖判断应覆盖全部开放子问题");
  check(detail.findings.length === 0, "Pro 不产生 findings");
  // 资料与引用：编号由应用分配，问题去空白后用于拆题。
  check(detail.answer?.material?.sources.length === 3, "三个子问题各应带回一条资料");
  check(detail.answer?.material?.sources.every((item, index) => item.number === index + 1) === true, "资料编号应按序分配");
  check(recorder.prompts.some((prompt) => prompt.includes("为什么要做缓存？")), "问题应去首尾空白后进入提示词");
  // 记账：拆题 + 覆盖 + 成稿共 3 次模型调用；检索 3 次（未开全网）。
  check(detail.usage.modelRequests === 3, `应记 3 次模型调用，实际 ${detail.usage.modelRequests}`);
  check(detail.usage.searchRequests === 3, `应记 3 次检索，实际 ${detail.usage.searchRequests}`);
  check(detail.limits.maxModelRequests === PRO_LIMITS.maxModelRequests, "应使用 Pro 编排预算");
  // 事件序：started → plan → coverage → material → answer_delta → completed。
  check(events[0] === "started" && events[1] === "plan", "应先发 started 与 plan");
  check(events.includes("coverage"), "应发出覆盖判断事件");
  check(events.indexOf("coverage") < events.indexOf("material"), "覆盖判断应早于资料");
  check(events.at(-1) === "completed", "末事件应为 completed");

  const parsed = TaskDetailSchema.safeParse(detail);
  check(parsed.success, `TaskDetail 应符合契约：${parsed.success ? "" : parsed.error.message}`);
}

// —— 全网补充：开启后每轮会额外发起一次全网检索 ——
{
  const recorder = { models: [] as string[], prompts: [] as string[] };
  const contentRecorder = { queries: [] as string[], webCount: 0 };
  const command = createResearchProCommand({
    zhida: makeZhida(recorder),
    content: makeContent(contentRecorder),
    clock: () => new Date("2026-09-15T00:00:00.000Z"),
  });
  const result = await command.execute({ requestId: "req-web", question: "问题", allowWebSupplement: true });
  check(contentRecorder.webCount > 0, "开启全网补充后应发起全网检索");
  check(result.detail.allowWebSupplement === true, "应回显 allowWebSupplement");
  check(result.detail.usage.searchRequests >= 4, "全网补充应计入检索次数");
}

// —— 拆题降级：拆题连续两次失败时退回单轮取证并照样成稿 ——
{
  const recorder = {
    models: [] as string[],
    prompts: [] as string[],
    script: (prompt: string) => (prompt.includes("拆题员") ? "不是一个 JSON" : COVERAGE_JSON),
  };
  const command = createResearchProCommand({
    zhida: makeZhida(recorder),
    content: makeContent(),
    clock: () => new Date("2026-09-15T00:00:00.000Z"),
  });
  const events: string[] = [];
  const result = await command.execute(
    { requestId: "req-degrade", question: "降级问题" },
    { onEvent: (event) => { events.push(event.type); } },
  );
  check(result.detail.status === "completed", "拆题失败仍应完成成稿");
  check(result.detail.plan === null, "拆题降级不应写入计划");
  check(!events.includes("plan"), "拆题降级不应发出 plan 事件");
  // 拆题两次尝试 + 成稿一次 = 3；降级路径不做覆盖判断。
  check(result.detail.usage.modelRequests === 3, `降级应记 3 次模型调用，实际 ${result.detail.usage.modelRequests}`);
  // 降级时用原问题检索一次。
  check(result.detail.usage.searchRequests === 1, `降级应记 1 次检索，实际 ${result.detail.usage.searchRequests}`);
}

// —— 空问题：如实拒绝，不打上游 ——
{
  const recorder = { models: [] as string[], prompts: [] as string[] };
  const command = createResearchProCommand({ zhida: makeZhida(recorder), content: makeContent() });
  let threw: unknown;
  await command.execute({ requestId: "req-2", question: "   " }).catch((error: unknown) => {
    threw = error;
  });
  check(isProductError(threw) && threw.code === "INVALID_INPUT", "空问题应以 INVALID_INPUT 拒绝");
  check(recorder.models.length === 0, "空问题不应触达直答");
}

// —— 上游失败：如实抛出，不编造完成态 ——
{
  const failing: ZhidaGateway = {
    async answer() {
      throw new ProductError("RATE_LIMITED", "知乎直答请求过于频繁。");
    },
  };
  const command = createResearchProCommand({ zhida: failing, content: makeContent() });
  let threw: unknown;
  await command.execute({ requestId: "req-3", question: "正常问题" }).catch((error: unknown) => {
    threw = error;
  });
  check(isProductError(threw) && threw.code === "RATE_LIMITED", "上游限流应原样抛出，便于路由映射状态码");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: "research-pro" }));
