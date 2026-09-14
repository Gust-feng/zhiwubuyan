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
  answer(input: {
    model: ZhidaModel;
    prompt: string;
    signal?: AbortSignal;
    onDelta?: (text: string) => void | Promise<void>;
  }): Promise<ZhidaAnswer>;
};

type Client = ReturnType<typeof createOpenPlatformClient>;

export function createZhidaGateway(client: Client, identity: RequestIdentity): ZhidaGateway {
  return {
    async answer(input) {
      const prompt = input.prompt.trim();
      if (!prompt) throw new ProductError("INVALID_INPUT", "直答的输入不能为空。");
      if (input.model === "zhida-agent" || input.onDelta) {
        return readStream(client, identity, { ...input, prompt });
      }
      const body = await client.postJson(
        "/v1/chat/completions",
        identity,
        {
          model: requireModel(input.model),
          stream: false,
          messages: [{ role: "user", content: prompt }],
        },
        "raw",
        input.signal,
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

async function readStream(client: Client, identity: RequestIdentity, input: Parameters<ZhidaGateway["answer"]>[0]): Promise<ZhidaAnswer> {
  let content = "";
  let finishReason: string | undefined;
  let usage: ZhidaAnswer["usage"] = null;
  for await (const data of client.postEventStream("/v1/chat/completions", identity, {
    model: input.model,
    stream: true,
    messages: [{ role: "user", content: input.prompt }],
  }, input.signal)) {
    input.signal?.throwIfAborted();
    if (data === "[DONE]") {
      if (!content.trim()) throw new ProductError("PROTOCOL_ERROR", "直答没有返回内容。");
      return { model: input.model, content: content.trim(), finishReason, usage };
    }
    let chunk: Record<string, unknown> | undefined;
    try {
      chunk = asRecord(JSON.parse(data));
    } catch {
      throw new ProductError("PROTOCOL_ERROR", "直答事件不是合法 JSON。");
    }
    if (!chunk) throw new ProductError("PROTOCOL_ERROR", "直答事件缺少对象外壳。");
    const choice = asArrayFirst(chunk.choices);
    const delta = asRecord(choice?.delta);
    if (chunk.error || choice?.error || delta?.error || choice?.finish_reason === "error") {
      throw new ProductError("UPSTREAM_ERROR", "知乎直答生成中断，请重新研究。");
    }
    if (typeof delta?.content === "string" && delta.content !== "") {
      content += delta.content;
      await input.onDelta?.(delta.content);
    }
    const reason = readString(choice?.finish_reason);
    if (reason) finishReason = reason;
    const tokens = asRecord(chunk.usage);
    if (tokens) usage = {
      inputTokens: readNumber(tokens.prompt_tokens) ?? null,
      outputTokens: readNumber(tokens.completion_tokens) ?? null,
    };
  }
  throw new ProductError("PROTOCOL_ERROR", "直答连接在答案完成前断开，请重新研究。");
}

function requireModel(model: ZhidaModel): ZhidaModel {
  return ZHIDA_MODELS.includes(model) ? model : "zhida-fast-1p5";
}

function asArrayFirst(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? asRecord(value[0]) : undefined;
}
