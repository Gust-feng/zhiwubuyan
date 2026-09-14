import { ProductError } from "./errors.ts";
import { asRecord, parseJsonPreserveIntegers, readNumber, readOptionalString } from "./json.ts";
import type { FetchLike } from "./client.ts";

export const OAUTH_BASE_URL = "https://openapi.zhihu.com";
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

/**
 * 授权回调的固定路径。必须落在 /api/ 之下：网页端部署只把 /api/* 交给服务端函数，
 * 其余路径回退到前端页面，回调落在别处就拿不到 authorization_code。
 * 登记到开放平台的完整地址是 `${公开来源}${OAUTH_CALLBACK_PATH}`。
 */
export const OAUTH_CALLBACK_PATH = "/api/auth/callback";

export type OAuthAppConfig = {
  appId: string;
  appKey: string;
  redirectUri: string;
};

export type OAuthToken = {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
};

export type ExchangeOptions = {
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => number;
};

/**
 * 公开来源：优先 PUBLIC_ORIGIN；也接受把完整回调地址写在 ZHIHU_OAUTH_REDIRECT_URI 里，
 * 只取其中的来源部分。都未配置时返回 undefined，登录能力不启用。
 */
export function readPublicOrigin(env: Record<string, string | undefined>): string | undefined {
  return normalizeOrigin(env.PUBLIC_ORIGIN) ?? normalizeOriginFromUri(env.ZHIHU_OAUTH_REDIRECT_URI);
}

/** 登记到开放平台的完整回调地址；未配置公开来源时为 undefined。 */
export function oauthRedirectUri(env: Record<string, string | undefined>): string | undefined {
  const origin = readPublicOrigin(env);
  return origin === undefined ? undefined : `${origin}${OAUTH_CALLBACK_PATH}`;
}

export function readOAuthAppConfig(env: Record<string, string | undefined>): OAuthAppConfig | undefined {
  const appId = env.ZHIHU_OAUTH_APP_ID?.trim();
  const appKey = env.ZHIHU_OAUTH_APP_KEY?.trim();
  // 回调路径由应用固定，避免登记地址与实际路由不一致；配置里只决定来源。
  const redirectUri = oauthRedirectUri(env);
  if (!appId || !appKey || !redirectUri) return undefined;
  return { appId, appKey, redirectUri };
}

/**
 * 登录所需配置项的名称清单。未接通时前端据此如实说明缺哪一项；
 * 只回配置项名称，绝不回传任何值。
 */
export function missingOAuthConfig(env: Record<string, string | undefined>): string[] {
  const missing: string[] = [];
  if (!env.ZHIHU_OAUTH_APP_ID?.trim()) missing.push("ZHIHU_OAUTH_APP_ID");
  if (!env.ZHIHU_OAUTH_APP_KEY?.trim()) missing.push("ZHIHU_OAUTH_APP_KEY");
  // 公开来源决定回调地址；也接受从 ZHIHU_OAUTH_REDIRECT_URI 反推。
  if (readPublicOrigin(env) === undefined) missing.push("PUBLIC_ORIGIN");
  return missing;
}

/** 接受带协议或裸主机名（裸主机名按 https 处理），只保留来源部分。 */
function normalizeOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return undefined;
  }
}

function normalizeOriginFromUri(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).origin;
  } catch {
    return undefined;
  }
}

export function buildAuthorizeUrl(config: OAuthAppConfig): string {
  const url = new URL("/authorize", `${OAUTH_BASE_URL}/`);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("app_id", config.appId);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export function readAuthorizationCode(query: URLSearchParams): string | undefined {
  return readOptionalString(query.get("authorization_code")) ?? readOptionalString(query.get("code"));
}

export async function exchangeAuthorizationCode(
  config: OAuthAppConfig,
  code: string,
  options: ExchangeOptions = {},
): Promise<OAuthToken> {
  const baseUrl = (options.baseUrl ?? OAUTH_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? defaultFetch;
  const body = new URLSearchParams({
    app_id: config.appId,
    app_key: config.appKey,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });
  let response: { ok: boolean; status: number; text(): Promise<string> };
  try {
    response = await fetchImpl(`${baseUrl}/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (cause) {
    throw new ProductError("UPSTREAM_ERROR", "无法连接知乎授权服务。", cause instanceof Error ? cause.message : undefined);
  }
  const text = await response.text();
  const parsed = parseBody(text, response.status);
  if (!response.ok) {
    throw new ProductError("AUTH_INVALID", "知乎授权登录失败。", failureDetail(response.status, parsed));
  }
  const accessToken = readTokenField(parsed, "access_token");
  if (!accessToken) {
    throw new ProductError("AUTH_INVALID", "知乎授权登录未返回访问令牌。", failureDetail(response.status, parsed));
  }
  const expiresIn = readExpiresIn(parsed) ?? DEFAULT_EXPIRES_IN_SECONDS;
  return {
    accessToken,
    tokenType: readTokenField(parsed, "token_type") ?? "Bearer",
    // 提前 30 秒判定过期，为后续请求留出时钟与网络余量
    expiresAt: (options.now ?? Date.now)() + Math.max(expiresIn - 30, 30) * 1000,
  };
}

function parseBody(text: string, status: number): unknown {
  if (text.trim() === "") {
    throw new ProductError("PROTOCOL_ERROR", "知乎授权服务返回空响应。", `http ${status}`);
  }
  try {
    return parseJsonPreserveIntegers(text);
  } catch {
    throw new ProductError("PROTOCOL_ERROR", "知乎授权服务响应不是合法 JSON。", `http ${status}`);
  }
}

// 令牌接口以 access_token 是否存在判定成功；业务码 20000 表示成功，不作为错误处理
function readTokenField(body: unknown, field: string): string | undefined {
  const record = asRecord(body);
  const direct = readOptionalString(record?.[field]);
  if (direct) return direct;
  return readOptionalString(asRecord(record?.data)?.[field]);
}

function readExpiresIn(body: unknown): number | undefined {
  const record = asRecord(body);
  const seconds = readNumber(record?.expires_in) ?? readNumber(asRecord(record?.data)?.expires_in);
  return seconds !== undefined && seconds > 0 ? Math.floor(seconds) : undefined;
}

function failureDetail(status: number, body: unknown): string {
  const record = asRecord(body);
  const message = readOptionalString(record?.message) ?? readOptionalString(record?.error) ?? "";
  return `http ${status}${message ? `: ${message.slice(0, 200)}` : ""}`;
}

async function defaultFetch(
  input: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
) {
  const response = await fetch(input, init);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
}
