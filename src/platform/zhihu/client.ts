import { EventSourceParserStream } from "eventsource-parser/stream";
import { ProductError } from "./errors.ts";
import { identityHeaders, type RequestIdentity } from "./identity.ts";
import { asRecord, parseJsonPreserveIntegers, readNumber, readString } from "./json.ts";

export const OPEN_PLATFORM_BASE_URL = "https://developer.zhihu.com";

export type HttpMethod = "GET" | "POST";

export type FetchLike = (
  input: string,
  init: {
    method: HttpMethod;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  body?: Awaited<ReturnType<typeof fetch>>["body"];
  text(): Promise<string>;
}>;

export type Envelope = {
  code: number;
  message: string;
  data: unknown;
};

export type TransportRequest = {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  identity: RequestIdentity;
  envelope?: "platform" | "raw";
  /** 中止信号：超时与任务取消由调用方组合后传入。 */
  signal?: AbortSignal;
};

export type OpenPlatformClientOptions = {
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => number;
};

export function createOpenPlatformClient(options: OpenPlatformClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? OPEN_PLATFORM_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;

  async function send(input: TransportRequest) {
    const url = new URL(input.path, `${baseUrl}/`);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    const headers = {
      ...identityHeaders(input.identity),
      "X-Request-Timestamp": String(Math.floor(now() / 1000)),
      "Content-Type": "application/json",
    };
    return fetchImpl(url.toString(), {
      method: input.method,
      headers,
      body: input.json === undefined ? undefined : JSON.stringify(input.json),
      signal: input.signal,
    }).catch((error: unknown) => {
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
        throw new ProductError("ABORTED", "请求已中止。", error.name);
      }
      throw error;
    });
  }

  return {
    async request(input: TransportRequest): Promise<Envelope | unknown> {
      const response = await send(input);
      const text = await response.text();
      const body = parseBody(text, response.status);
      if (!response.ok) {
        throw mapHttpFailure(response.status, body);
      }
      if ((input.envelope ?? "platform") === "raw") {
        return body;
      }
      return requireEnvelope(body);
    },
    async get(
      path: string,
      identity: RequestIdentity,
      query: Record<string, string | number | undefined> = {},
      signal?: AbortSignal,
    ): Promise<Envelope> {
      return await this.request({ method: "GET", path, identity, query, signal }) as Envelope;
    },
    async postJson(
      path: string,
      identity: RequestIdentity,
      json: unknown,
      envelope: "platform" | "raw" = "platform",
      signal?: AbortSignal,
    ): Promise<Envelope | unknown> {
      return await this.request({ method: "POST", path, identity, json, envelope, signal });
    },
    async *postEventStream(path: string, identity: RequestIdentity, json: unknown, signal?: AbortSignal): AsyncGenerator<string> {
      const response = await send({ method: "POST", path, identity, json, signal });
      if (!response.ok) {
        throw mapHttpFailure(response.status, parseBody(await response.text(), response.status));
      }
      if (!response.body || !response.headers?.get("content-type")?.includes("text/event-stream")) {
        throw new ProductError("PROTOCOL_ERROR", "直答未返回事件流。");
      }
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream())
        .getReader();
      try {
        while (true) {
          const event = await reader.read();
          if (event.done) return;
          yield event.value.data;
        }
      } finally {
        // 结束标记、用户停止及解析错误都关闭同一次上游连接。
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
  };
}

function parseBody(text: string, status: number): unknown {
  if (text.trim() === "") {
    throw new ProductError("PROTOCOL_ERROR", "上游返回空响应。", `http ${status}`);
  }
  try {
    return parseJsonPreserveIntegers(text);
  } catch {
    throw new ProductError("PROTOCOL_ERROR", "上游响应不是合法 JSON。", `http ${status}`);
  }
}

function requireEnvelope(body: unknown): Envelope {
  const record = asRecord(body);
  if (!record) {
    throw new ProductError("PROTOCOL_ERROR", "上游响应缺少对象外壳。");
  }
  const code = readNumber(record.Code ?? record.code);
  if (code === undefined) {
    throw new ProductError("PROTOCOL_ERROR", "上游响应缺少业务码。");
  }
  const message = readString(record.Message ?? record.message) || "unknown error";
  if (code !== 0) {
    throw mapBusinessCode(code, message);
  }
  return {
    code,
    message,
    data: record.Data ?? record.data ?? {},
  };
}

function mapHttpFailure(status: number, body: unknown): ProductError {
  const record = asRecord(body);
  const message = record
    ? readString(record.Message ?? record.message) || `http ${status}`
    : `http ${status}`;
  if (status === 401 || status === 403) {
    return new ProductError("AUTH_INVALID", "开放平台鉴权失败。", message);
  }
  if (status === 429) {
    return new ProductError("RATE_LIMITED", "开放平台请求过于频繁。", message);
  }
  return new ProductError("UPSTREAM_ERROR", "开放平台请求失败。", message);
}

function mapBusinessCode(code: number, message: string): ProductError {
  switch (code) {
    case 10001:
      return new ProductError("INVALID_INPUT", "开放平台参数错误。", message);
    case 20001:
      return new ProductError("AUTH_INVALID", "开放平台鉴权失败。", message);
    case 30001:
      return new ProductError("RATE_LIMITED", "开放平台请求过于频繁。", message);
    case 30002:
      return new ProductError("QUOTA_EXHAUSTED", "开放平台额度已用尽。", message);
    default:
      return new ProductError("UPSTREAM_ERROR", "开放平台返回业务错误。", `${code}: ${message}`);
  }
}

async function defaultFetch(
  input: string,
  init: { method: HttpMethod; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) {
  return fetch(input, init);
}
