import { ProductError } from "../zhihu/errors.ts";

/**
 * 通用 OpenAI 兼容对话模型适配：只做"把消息发给模型、取回文本"这一件事。
 * 概念动画等生成式能力共用它，避免各自直连 HTTP 或引入额外 SDK。
 *
 * 与知乎直答网关的区别：这里面向自备模型（BYOK）的 OpenAI 风格端点，
 * 凭证只经内存传递，不写入日志或响应；错误统一收敛为 ProductError。
 */

export type ChatRole = "system" | "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };

export type ChatModelConfig = {
  /** OpenAI 兼容端点基址；可带 /v1，也可直接写到 /chat/completions。 */
  baseUrl: string;
  /** 模型 ID，如 deepseek-chat、claude-sonnet-4。 */
  modelId: string;
  /** 仅进程内存持有，禁止写入日志、数据库或前端响应。 */
  apiKey: string;
};

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type ChatCompletion = {
  content: string;
  modelId: string;
  finishReason: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null };
};

export type ChatCompletionOptions = {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type ChatModelClient = {
  readonly modelId: string;
  complete(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<ChatCompletion>;
};

const DEFAULT_TEMPERATURE = 0.8;

export function createChatModelClient(input: ChatModelConfig & { fetch?: FetchLike }): ChatModelClient {
  const fetchImpl = input.fetch ?? defaultFetch;
  const url = chatCompletionsUrl(input.baseUrl);

  return {
    modelId: input.modelId,
    async complete(messages, options = {}) {
      if (messages.length === 0) throw new ProductError("INVALID_INPUT", "模型消息不能为空。");
      const body: Record<string, unknown> = {
        model: input.modelId,
        messages,
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
        stream: false,
      };
      if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${input.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: options.signal,
        });
      } catch (error) {
        throw toTransportError(error);
      }

      const text = await response.text();
      if (!response.ok) {
        const code = response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR";
        throw new ProductError(code, "模型服务返回错误。", `${response.status}: ${truncate(text)}`);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new ProductError("PROTOCOL_ERROR", "模型响应不是合法 JSON。");
      }

      const record = asRecord(payload);
      const failure = asRecord(record?.error);
      if (failure) {
        throw new ProductError(
          "UPSTREAM_ERROR",
          "模型服务报告了错误。",
          readString(failure.message) || "unknown error",
        );
      }
      const choice = firstChoice(record?.choices);
      const content = readString(asRecord(choice?.message)?.content).trim();
      if (!content) throw new ProductError("PROTOCOL_ERROR", "模型没有返回内容。");

      const usage = asRecord(record?.usage);
      return {
        content,
        modelId: readString(record?.model) || input.modelId,
        finishReason: readString(choice?.finish_reason) || null,
        usage: {
          inputTokens: readNumber(usage?.prompt_tokens),
          outputTokens: readNumber(usage?.completion_tokens),
        },
      };
    },
  };
}

/** 端点归一：已指向 /chat/completions 则原样使用，否则补全路径。 */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  // Gemini 的 OpenAI 兼容入口挂在 /v1beta/openai 下，而厂商文档常只给站点根域名；
  // 补全这个已知路径，避免拼出会 404 的 /chat/completions。
  if (/^https?:\/\/generativelanguage\.googleapis\.com$/i.test(trimmed)) {
    return `${trimmed}/v1beta/openai/chat/completions`;
  }
  return `${trimmed}/chat/completions`;
}

function toTransportError(error: unknown): ProductError {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new ProductError("ABORTED", "模型请求已中止。", error.name);
  }
  return new ProductError("UPSTREAM_ERROR", "模型服务无法连接。", error instanceof Error ? error.message : undefined);
}

async function defaultFetch(
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) {
  const response = await fetch(input, init);
  return { ok: response.ok, status: response.status, text: () => response.text() };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstChoice(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? asRecord(value[0]) : undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncate(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 400 ? `${collapsed.slice(0, 400)}…` : collapsed;
}
