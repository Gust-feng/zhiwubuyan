import { createHmac, randomUUID } from "node:crypto";
import { ProductError } from "./errors.ts";
import { asArray, asRecord, readNumber, readOptionalString, readString, parseJsonPreserveIntegers } from "./json.ts";

export const COMMUNITY_BASE_URL = "https://openapi.zhihu.com";

/** 社区 API 当前允许读写的圈子；数组顺序即产品中的展示顺序。 */
export const COMMUNITY_RINGS = [
  { id: "2029619126742656657", name: "黑客松脑洞补给站" },
  { id: "2001009660925334090", name: "OpenClaw 人类观察员" },
  { id: "2015023739549529606", name: "A2A for Reconnect" },
] as const;

export type CommunityConfig = {
  /** 用户 token，来自本人知乎主页链接中 `people/` 之后的一段。 */
  appKey: string;
  /** 开放平台发放的应用密钥，仅服务端持有。 */
  appSecret: string;
};

export type CommunityCredentialsInput = {
  appKey: string;
  appSecret: string;
};

export type FetchLike = (
  input: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type CommunityClientOptions = {
  config?: CommunityConfig;
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => number;
  newLogId?: () => string;
};

export type CommunityEnvelope<T = unknown> = {
  status: number;
  message: string;
  data: T;
};

export function readCommunityConfig(env: Record<string, string | undefined>): CommunityConfig | undefined {
  const appKey = env.ZHIHU_COMMUNITY_APP_KEY?.trim();
  const appSecret = env.ZHIHU_COMMUNITY_APP_SECRET?.trim();
  if (!appKey || !appSecret) return undefined;
  return { appKey, appSecret };
}

/** 按 ID 查白名单圈子；不属于白名单返回 undefined，由调用方拒绝而不是把任意 ID 发往上游。 */
export function readCommunityRing(ringId: string): (typeof COMMUNITY_RINGS)[number] | undefined {
  return COMMUNITY_RINGS.find((ring) => ring.id === ringId);
}

/**
 * 构造社区 API 签名：对 `app_key:{app_key}|ts:{ts}|logid:{logId}|extra_info:{extraInfo}`
 * 做 HMAC-SHA256（密钥为 app_secret），再 Base64 编码。
 */
export function signCommunityRequest(
  appKey: string,
  appSecret: string,
  timestamp: string,
  logId: string,
  extraInfo = "",
): string {
  const payload = `app_key:${appKey}|ts:${timestamp}|logid:${logId}|extra_info:${extraInfo}`;
  return createHmac("sha256", appSecret).update(payload, "utf8").digest("base64");
}

export function buildSignatureHeaders(
  config: CommunityConfig,
  options: { now?: () => number; logId?: string; extraInfo?: string } = {},
): Record<string, string> {
  const timestamp = String(Math.floor((options.now ?? Date.now)() / 1000));
  const logId = options.logId ?? `log_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const extraInfo = options.extraInfo ?? "";
  return {
    "X-App-Key": config.appKey,
    "X-Timestamp": timestamp,
    "X-Log-Id": logId,
    "X-Sign": signCommunityRequest(config.appKey, config.appSecret, timestamp, logId, extraInfo),
    "X-Extra-Info": extraInfo,
  };
}

export function createCommunityClient(options: CommunityClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? COMMUNITY_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? defaultFetch;

  const request = async <T = unknown>(
    method: "GET" | "POST",
    path: string,
    input: {
      config: CommunityConfig;
      query?: Record<string, string | number | undefined>;
      json?: unknown;
    },
  ): Promise<CommunityEnvelope<T>> => {
    const url = new URL(path, `${baseUrl}/`);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      ...buildSignatureHeaders(input.config, { now: options.now, logId: options.newLogId?.() }),
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    };
    const response = await fetchImpl(url.toString(), {
      method,
      headers,
      body: method === "POST" && input.json !== undefined ? JSON.stringify(input.json) : undefined,
    });
    const text = await response.text();
    const body = parseBody(text, response.status);
    if (!response.ok) throw mapHttpFailure(response.status, body);
    return requireEnvelope<T>(body);
  };

  return {
    request,
    get<T = unknown>(
      path: string,
      config: CommunityConfig,
      query?: Record<string, string | number | undefined>,
    ): Promise<CommunityEnvelope<T>> {
      return request<T>("GET", path, { config, query });
    },
    post<T = unknown>(path: string, config: CommunityConfig, json: unknown): Promise<CommunityEnvelope<T>> {
      return request<T>("POST", path, { config, json });
    },
  };
}

export type CommunityClient = ReturnType<typeof createCommunityClient>;

// ---- 领域结果类型（与平台字段一一对应，不做二次加工） ----

export type CommunityRing = {
  ringId: string;
  name: string;
  description: string;
  avatarUrl: string;
  membershipCount?: number;
  discussionCount?: number;
};

export type CommunityComment = {
  commentId: string;
  content: string;
  authorName: string;
  authorToken?: string;
  likeCount?: number;
  replyCount?: number;
  replyTo?: string;
  publishedAt?: string;
};

export type CommunityContent = {
  pinId: string;
  title?: string;
  content: string;
  authorName: string;
  imageUrls: string[];
  publishedAt?: string;
  likeCount?: number;
  commentCount?: number;
  favoriteCount?: number;
  shareCount?: number;
  comments: CommunityComment[];
};

export type RingDetail = {
  ring: CommunityRing;
  contents: CommunityContent[];
};

export type StorySummary = {
  workId: string;
  title: string;
  artworkUrl?: string;
  tabArtworkUrl?: string;
  description?: string;
  labels: string[];
};

export type StoryDetail = {
  workId: string;
  chapterName?: string;
  authorName?: string;
  authorAvatarUrl?: string;
  labels: string[];
  introduction?: string;
  content: string;
};

export type CommunityGateway = {
  ringDetail(input: { ringId: string; pageSize?: number; pageNum?: number }): Promise<RingDetail>;
  publishPin(input: { ringId: string; content: string; title?: string; imageUrls?: string[] }): Promise<{ contentToken: string }>;
  listComments(input: { contentToken: string; contentType: "pin" | "comment"; pageNum?: number; pageSize?: number }): Promise<{ comments: CommunityComment[]; hasMore: boolean }>;
  createComment(input: { contentToken: string; contentType: "pin" | "comment"; content: string }): Promise<{ commentId: string }>;
  deleteComment(input: { commentId: string }): Promise<{ success: boolean }>;
  react(input: { contentToken: string; contentType: "pin" | "comment"; like: boolean }): Promise<{ success: boolean }>;
  listStories(): Promise<StorySummary[]>;
  storyDetail(input: { workId: string }): Promise<StoryDetail>;
};

/**
 * 绑定一组凭据的社区 API 网关。写操作有外发副作用，调用方负责限流与重试策略：
 * 发布想法每小时最多 5 条、每个想法下评论每小时最多 20 条、接口全局限流 10 QPS。
 */
export function createCommunityGateway(client: CommunityClient, config: CommunityConfig): CommunityGateway {
  return {
    async ringDetail(input) {
      const envelope = await client.get<Record<string, unknown>>("/openapi/ring/detail", config, {
        ring_id: input.ringId,
        page_size: input.pageSize,
        page_num: input.pageNum,
      });
      const data = asRecord(envelope.data) ?? {};
      return {
        ring: mapRing(asRecord(data.ring_info)),
        contents: asArray(data.contents).map(mapContent),
      };
    },
    async publishPin(input) {
      const envelope = await client.post<Record<string, unknown>>("/openapi/publish/pin", config, {
        ring_id: input.ringId,
        content: input.content,
        title: input.title,
        image_urls: input.imageUrls,
      });
      return { contentToken: readString(asRecord(envelope.data)?.content_token) };
    },
    async listComments(input) {
      const envelope = await client.get<Record<string, unknown>>("/openapi/comment/list", config, {
        content_token: input.contentToken,
        content_type: input.contentType,
        page_num: input.pageNum,
        page_size: input.pageSize,
      });
      const data = asRecord(envelope.data) ?? {};
      return { comments: asArray(data.comments).map(mapComment), hasMore: data.has_more === true };
    },
    async createComment(input) {
      const envelope = await client.post<Record<string, unknown>>("/openapi/comment/create", config, {
        content_token: input.contentToken,
        content_type: input.contentType,
        content: input.content,
      });
      return { commentId: readString(asRecord(envelope.data)?.comment_id) };
    },
    async deleteComment(input) {
      const envelope = await client.post<Record<string, unknown>>("/openapi/comment/delete", config, {
        comment_id: input.commentId,
      });
      return { success: asRecord(envelope.data)?.success === true };
    },
    async react(input) {
      const envelope = await client.post<Record<string, unknown>>("/openapi/reaction", config, {
        content_token: input.contentToken,
        content_type: input.contentType,
        action_type: "like",
        action_value: input.like ? 1 : 0,
      });
      return { success: asRecord(envelope.data)?.success === true };
    },
    async listStories() {
      const envelope = await client.get<unknown>("/openapi/hackathon_story/list", config);
      return asArray(envelope.data).map(mapStorySummary);
    },
    async storyDetail(input) {
      const envelope = await client.get<Record<string, unknown>>("/openapi/hackathon_story/detail", config, {
        work_id: input.workId,
      });
      const data = asRecord(envelope.data) ?? {};
      return {
        workId: readString(data.work_id),
        chapterName: readOptionalString(data.chapter_name),
        authorName: readOptionalString(data.author_name),
        authorAvatarUrl: readOptionalString(data.author_avatar),
        labels: asArray(data.labels).map((label) => readString(label)).filter((label) => label !== ""),
        introduction: readOptionalString(data.introduction),
        content: readString(data.content),
      };
    },
  };
}

function mapRing(value: Record<string, unknown> | undefined): CommunityRing {
  return {
    ringId: readString(value?.ring_id),
    name: readString(value?.ring_name),
    description: readString(value?.ring_desc),
    avatarUrl: readString(value?.ring_avatar),
    membershipCount: readNumber(value?.membership_num),
    discussionCount: readNumber(value?.discussion_num),
  };
}

function mapContent(value: unknown): CommunityContent {
  const record = asRecord(value) ?? {};
  return {
    pinId: readString(record.pin_id),
    title: readOptionalString(record.title),
    content: readString(record.content),
    authorName: readString(record.author_name),
    imageUrls: asArray(record.images).map((image) => readString(image)).filter((image) => image !== ""),
    publishedAt: fromSeconds(record.publish_time),
    likeCount: readNumber(record.upvote_num),
    commentCount: readNumber(record.comment_num),
    favoriteCount: readNumber(record.fav_num),
    shareCount: readNumber(record.share_num),
    comments: asArray(record.comments).map(mapComment),
  };
}

function mapComment(value: unknown): CommunityComment {
  const record = asRecord(value) ?? {};
  return {
    commentId: readString(record.comment_id),
    content: readString(record.content),
    authorName: readString(record.author_name),
    authorToken: readOptionalString(record.author_token),
    likeCount: readNumber(record.like_count),
    replyCount: readNumber(record.reply_count),
    replyTo: readOptionalString(record.reply_to),
    publishedAt: fromSeconds(record.publish_time),
  };
}

function mapStorySummary(value: unknown): StorySummary {
  const record = asRecord(value) ?? {};
  return {
    workId: readString(record.work_id),
    title: readString(record.title),
    artworkUrl: readOptionalString(record.artwork),
    tabArtworkUrl: readOptionalString(record.tab_artwork),
    description: readOptionalString(record.description),
    labels: asArray(record.labels).map((label) => readString(label)).filter((label) => label !== ""),
  };
}

function fromSeconds(value: unknown): string | undefined {
  const seconds = readNumber(value);
  if (seconds === undefined || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function parseBody(text: string, status: number): unknown {
  if (text.trim() === "") {
    throw new ProductError("PROTOCOL_ERROR", "社区 API 返回空响应。", `http ${status}`);
  }
  try {
    return parseJsonPreserveIntegers(text);
  } catch {
    throw new ProductError("PROTOCOL_ERROR", "社区 API 响应不是合法 JSON。", `http ${status}`);
  }
}

// 响应外壳为 { status, msg, data }；status=0 成功、1 失败。评论创建示例使用 code 字段，一并兼容。
function requireEnvelope<T>(body: unknown): CommunityEnvelope<T> {
  const record = asRecord(body);
  if (!record) throw new ProductError("PROTOCOL_ERROR", "社区 API 响应缺少对象外壳。");
  const status = readNumber(record.status) ?? readNumber(record.code);
  if (status === undefined) throw new ProductError("PROTOCOL_ERROR", "社区 API 响应缺少状态码。");
  const message = readString(record.msg) || "unknown error";
  if (status !== 0) throw mapBusinessStatus(status, message);
  return { status, message, data: (record.data ?? {}) as T };
}

function mapHttpFailure(status: number, body: unknown): ProductError {
  const record = asRecord(body);
  const errorRecord = asRecord(record?.error);
  const message = readString(errorRecord?.message) || readString(record?.msg) || `http ${status}`;
  if (status === 401) return new ProductError("AUTH_INVALID", "社区 API 签名校验失败。", message);
  if (status === 429) return new ProductError("RATE_LIMITED", "社区 API 请求过于频繁。", message);
  return new ProductError("UPSTREAM_ERROR", "社区 API 请求失败。", message);
}

function mapBusinessStatus(status: number, message: string): ProductError {
  if (status === 101) return new ProductError("AUTH_INVALID", "社区 API 签名校验失败。", message);
  return new ProductError("UPSTREAM_ERROR", "社区 API 返回业务错误。", `${status}: ${message}`);
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
