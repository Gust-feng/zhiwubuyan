/**
 * 网页端深度研究 Pro 验证：确认它走单次知乎直答、产出终端 TaskDetail，
 * 且不依赖引擎/store（因此能在 Serverless 里承接）。
 * 用假直答网关驱动，不触网、不消耗真实额度；不代表真实上游内容质量。
 */
import { createResearchProCommand } from "../application/research-pro.ts";
import { TIER_ZHIDA_MODEL } from "../application/research-baseline.ts";
import { TaskDetail as TaskDetailSchema } from "../contracts/research.ts";
import { isProductError, ProductError } from "../platform/zhihu/errors.ts";
import type { ZhidaGateway } from "../platform/zhihu/zhida.ts";

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

function makeZhida(recorder: { model?: string; prompt?: string }): ZhidaGateway {
  return {
    async answer(input) {
      recorder.model = input.model;
      recorder.prompt = input.prompt;
      return {
        model: input.model,
        content: "这是直答生成的正文。",
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 34 },
      };
    },
  };
}

// —— 正常路径：单次直答、终端结果、DTO 符合契约 ——
{
  const recorder: { model?: string; prompt?: string } = {};
  const command = createResearchProCommand({
    zhida: makeZhida(recorder),
    clock: () => new Date("2026-09-14T00:00:00.000Z"),
  });
  const result = await command.execute({ requestId: "req-1", question: "  为什么要做缓存？  " });

  check(recorder.model === TIER_ZHIDA_MODEL.pro, "Pro 应调用 zhida-agent");
  check(recorder.model === "zhida-agent", "Pro 的模型标识应为 zhida-agent");
  check(recorder.prompt === "为什么要做缓存？", "问题应去首尾空白后传给直答");

  const detail = result.detail;
  check(detail.status === "completed", "Pro 应在创建时就返回终态");
  check(detail.tier === "pro", "产出档位应为 pro");
  check(detail.answer !== null && detail.answer.content.length > 0, "应带直答正文");
  check(detail.sourceCount === 0, "Pro 不产生来源引用");
  check(detail.reportId === null && detail.plan === null, "Pro 不产生计划与报告");
  check(detail.usage.modelRequests === 1, "一次直答应记一次模型调用");

  // DTO 必须过共享契约：形状漂移在类型检查之外也要被这里拦下。
  const parsed = TaskDetailSchema.safeParse(detail);
  check(parsed.success, `TaskDetail 应符合契约：${parsed.success ? "" : parsed.error.message}`);
  // 契约要求 generatedAt 带时区偏移，上面的时钟是 UTC，若 schema 收紧会在这里暴露。
}

// —— 空问题：如实拒绝，不打上游 ——
{
  const recorder: { model?: string } = {};
  const command = createResearchProCommand({ zhida: makeZhida(recorder) });
  let threw: unknown;
  await command.execute({ requestId: "req-2", question: "   " }).catch((error: unknown) => {
    threw = error;
  });
  check(isProductError(threw) && threw.code === "INVALID_INPUT", "空问题应以 INVALID_INPUT 拒绝");
  check(recorder.model === undefined, "空问题不应触达直答");
}

// —— 上游失败：如实抛出，不编造完成态 ——
{
  const failing: ZhidaGateway = {
    async answer() {
      throw new ProductError("RATE_LIMITED", "知乎直答请求过于频繁。");
    },
  };
  const command = createResearchProCommand({ zhida: failing });
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
