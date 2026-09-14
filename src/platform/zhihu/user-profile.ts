import type { FetchLike } from "./client.ts";
import { ProductError } from "./errors.ts";
import { asRecord, parseJsonPreserveIntegers, readOptionalString } from "./json.ts";
import { OAUTH_BASE_URL } from "./oauth.ts";

/**
 * 授权用户基础信息：`GET https://openapi.zhihu.com/user`，只带 OAuth token，
 * 不需要 Access Secret 与请求时间戳。
 *
 * 该端点来自平台补充资料，尚无正式契约文档，也没有与本项目凭证联调验证，
 * 因此定位为可选的展示资料：读取失败只让界面回退到无昵称头像的登录态，
 * 不阻断会话与 5 个正式用户数据接口。
 */
export type AuthorizedUserProfile = {
  fullname: string;
  /** 用户字符串标识，用作个人档案的稳定身份键；缺失时该次同步不落盘。 */
  hashId?: string;
  avatarUrl?: string;
  headline?: string;
};

export type FetchAuthorizedUserProfileOptions = {
  baseUrl?: string;
  fetch?: FetchLike;
};

/** 读取不到有效用户对象时返回 undefined，由调用方决定展示其后的回退形态。 */
export async function fetchAuthorizedUserProfile(
  accessToken: string,
  options: FetchAuthorizedUserProfileOptions = {},
): Promise<AuthorizedUserProfile | undefined> {
  const token = accessToken.trim();
  if (token === "") throw new ProductError("AUTH_REQUIRED", "缺少已授权用户令牌。");
  const baseUrl = (options.baseUrl ?? OAUTH_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? defaultFetch;

  let response: { ok: boolean; status: number; text(): Promise<string> };
  try {
    response = await fetchImpl(`${baseUrl}/user`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (cause) {
    throw new ProductError(
      "UPSTREAM_ERROR",
      "无法连接知乎用户信息服务。",
      cause instanceof Error ? cause.message : undefined,
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw new ProductError("AUTH_INVALID", "读取知乎用户信息失败。", `http ${response.status}`);
  }
  if (text.trim() === "") return undefined;

  let parsed: unknown;
  try {
    parsed = parseJsonPreserveIntegers(text);
  } catch {
    throw new ProductError("PROTOCOL_ERROR", "知乎用户信息响应不是合法 JSON。", `http ${response.status}`);
  }
  // 成功响应是扁平的用户对象；协议修订也可能把它放进 data。错误响应的 data 是说明字符串。
  const record = asRecord(asRecord(parsed)?.data) ?? asRecord(parsed);
  if (record === undefined) return undefined;
  const fullname = readOptionalString(record.fullname);
  if (fullname === undefined) return undefined;
  return {
    fullname,
    hashId: readOptionalString(record.hash_id),
    avatarUrl: readOptionalString(record.avatar_path),
    headline: readOptionalString(record.headline),
  };
}

async function defaultFetch(
  input: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) {
  const response = await fetch(input, init);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
}
