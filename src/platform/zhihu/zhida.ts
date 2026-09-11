import { ProductError } from "./errors.ts";
import { asRecord, readNumber, readString } from "./json.ts";
import type { createOpenPlatformClient } from "./client.ts";
import type { RequestIdentity } from "./identity.ts";

export const ZHIDA_MODELS = ["zhida-fast-1p5", "zhida-thinking-1p5", "zhida-agent"] as const;

export type ZhidaModel = (typeof ZHIDA_MODELS)[number];

export type ZhidaAnswer = {
  model: ZhidaModel;
  content: string;
  finishReason?: string;
  /** 上游返回的 token 用量；缺失为 null，不填零。 */
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
};

export type ZhidaGateway = {
  answer(input: { model: ZhidaModel; prompt: string }): Promise<ZhidaAnswer>;
};

type Client = ReturnType<typeof createOpenPlatformClient>;

export function createZhidaGateway(client: Client, identity: RequestIdentity): ZhidaGateway {
  return {
    async answer(input) {
      const prompt = input.prompt.trim();
      if (!prompt) throw new ProductError("INVALID_INPUT", "直答的输入不能为空。");
      const body = await client.postJson(
        "/v1/chat/completions",
        identity,
        {
          model: requireModel(input.model),
          stream: false,
          messages: [{ role: "user", content: prompt }],
        },
        "raw",
      );
      const record = asRecord(body);
      if (!record) throw new ProductError("PROTOCOL_ERROR", "直答响应缺少对象外壳。");
      const failure = asRecord(record.error);
      if (failure) {
        const message = readString(failure.message) || "unknown error";
        throw new ProductError("UPSTREAM_ERROR", "知乎直答暂时没有响应。", message);
      }
      const choice = asArrayFirst(record.choices);
      const message = asRecord(choice?.message);
      const content = readString(message?.content).trim();
      if (!content) {
        throw new ProductError("PROTOCOL_ERROR", "直答没有返回内容。");
      }
      const usageRecord = asRecord(record.usage);
      const inputTokens = readNumber(usageRecord?.prompt_tokens);
      const outputTokens = readNumber(usageRecord?.completion_tokens);
      return {
        model: readString(record.model) === "" ? input.model : readString(record.model) as ZhidaModel,
        content,
        finishReason: readString(choice?.finish_reason) || undefined,
        usage: {
          inputTokens: inputTokens ?? null,
          outputTokens: outputTokens ?? null,
        },
      };
    },
  };
}

function requireModel(model: ZhidaModel): ZhidaModel {
  return ZHIDA_MODELS.includes(model) ? model : "zhida-fast-1p5";
}

function asArrayFirst(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? asRecord(value[0]) : undefined;
}
