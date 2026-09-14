/**
 * 个人档案端到端验证：用假上游（接管全局 fetch）与内存会话真实驱动
 * `createZhihuApiHandler` 的 HTTP 路由，覆盖「取档案 → 派生视图 → 登出清理」整条链路。
 * 假上游按开放平台外壳返回，验证的是产品的取数与组装行为，不代表真实知乎账号数据。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRuntime } from "../application/runtime.ts";
import { createZhihuApiHandler } from "../server/zhihu-api.ts";
import { createMemorySessionStore } from "../server/session-store.ts";
import { SESSION_COOKIE } from "../server/http-utils.ts";
import { createFilePersonalArchiveStore, personalArchiveDir } from "../storage/personal-archive-store.ts";

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

// —— 假上游：按路径返回开放平台外壳 ——
const calls: string[] = [];

function envelope(data: unknown): string {
  return JSON.stringify({ Code: 0, Message: "success", Data: data });
}

const creationPages = [
  {
    Items: [
      { ContentType: "answer", Title: "创作甲", Url: "https://www.zhihu.com/question/555/answer/1", CreatedAt: 1_756_684_800, LikeCount: 10, CommentCount: 1, FavoriteCount: 1, Summary: "摘要" },
      { ContentType: "article", Title: "创作乙", Url: "https://zhuanlan.zhihu.com/p/1", CreatedAt: 1_756_598_400, LikeCount: 3, CommentCount: 9, FavoriteCount: 1, Summary: "摘要" },
    ],
    Paging: { IsEnd: true },
  },
];
const followeePage = {
  Items: [
    { Fullname: "大 V", Url: "https://www.zhihu.com/people/big", UrlToken: "big", Headline: "人工智能 研究者", FollowerCount: 500000 },
    { Fullname: "同行", Url: "https://www.zhihu.com/people/peer", UrlToken: "peer", Headline: "人工智能 从业者", FollowerCount: 50000 },
  ],
  Paging: { IsEnd: true },
};
const favlistsPage = { Items: [{ UrlToken: "123456789", Title: "默认收藏夹", Description: "", IsPublic: true }] };
// 沉睡阈值是相对「现在」判断的，收藏时间必须相对当前时间生成，写死时间戳会随时间漂移。
const nowSeconds = Math.floor(Date.now() / 1000);
const collectionsPage = {
  Items: [
    { ContentType: "answer", Title: "最近收藏", Url: "https://www.zhihu.com/question/555/answer/2", FavTime: nowSeconds - 5 * 86_400, Summary: "摘要", Favlists: [{ Title: "默认收藏夹" }] },
    { ContentType: "answer", Title: "很久以前收藏", Url: "https://www.zhihu.com/question/999/answer/3", FavTime: nowSeconds - 400 * 86_400, Summary: "摘要" },
  ],
};

const profile = { uid: 9_695_700_477_102_162_00, hash_id: "stable-hash-1", fullname: "测试用户", avatar_path: "https://picx.zhimg.com/x.jpg", headline: "一句话介绍" };

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  calls.push(url);
  const respond = (body: string, status = 200) => new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
  if (url.includes("openapi.zhihu.com/user")) return respond(JSON.stringify(profile));
  if (url.includes("/api/v1/user/contents")) {
    const offset = Number(new URL(url).searchParams.get("Offset") ?? "0");
    const page = creationPages[Math.floor(offset / 50)] ?? { Items: [], Paging: { IsEnd: true } };
    return respond(envelope(page));
  }
  if (url.includes("/api/v1/user/followees")) return respond(envelope(followeePage));
  if (url.includes("/api/v1/user/favlists")) return respond(envelope(favlistsPage));
  if (url.includes("/api/v1/user/favlist_contents")) return respond(envelope({ Items: [], Paging: { IsEnd: true } }));
  if (url.includes("/api/v1/user/collections")) return respond(envelope(collectionsPage));
  return respond(JSON.stringify({ Code: 10001, Message: `unexpected ${url}`, Data: {} }), 200);
}) as typeof globalThis.fetch;

// —— 假请求/响应：只需要 handler 真正读取到的字段 ——
type Captured = { status?: number; body?: unknown; headers?: Record<string, string> };

function makeRequest(cookie?: string, path = "/api/user/archive", method = "GET"): IncomingMessage {
  return {
    method,
    url: path,
    headers: cookie === undefined ? {} : { cookie },
  } as unknown as IncomingMessage;
}

function makeResponse(): { response: ServerResponse; captured: Captured } {
  const captured: Captured = { headers: {} };
  const response = {
    setHeader(name: string, value: string) {
      captured.headers![name] = value;
    },
    writeHead(status: number) {
      captured.status = status;
    },
    end(body?: string) {
      captured.body = body === undefined ? undefined : JSON.parse(body);
      return this;
    },
  } as unknown as ServerResponse;
  return { response, captured };
}

const dir = mkdtempSync(join(tmpdir(), "personal-archive-e2e-"));
try {
  const sessions = createMemorySessionStore();
  const sessionId = await sessions.create({ accessToken: "oauth-token-1", tokenType: "Bearer", expiresAt: Date.now() + 3600_000 });
  const runtime = createRuntime({
    accessSecret: "test-secret",
    personalArchiveStore: createFilePersonalArchiveStore(personalArchiveDir(dir)),
  });
  const handle = createZhihuApiHandler({ runtime, oauthConfig: undefined, sessions, capabilities: ["user_data"], surface: "web" });

  const { response, captured } = makeResponse();
  const handled = await handle(new URL("https://example.test/api/user/archive"), makeRequest(`${SESSION_COOKIE}=${sessionId}`), response);

  check(handled === true, "档案路由应被处理");
  check(captured.status === 200, `档案路由应返回 200，实际 ${captured.status}`);
  const body = captured.body as {
    persistent?: boolean;
    counts?: Record<string, number>;
    profile?: { fullname?: string };
    views?: {
      questionClusters?: { questionId: string; total: number }[];
      creationYear?: { total: number };
      collectionTimeline?: { dormant: { title: string }[] };
      followeeTiers?: { tier: string; count: number }[];
      headlineKeywords?: { keyword: string }[];
    };
  } | undefined;

  check(body?.persistent === true, "有 hash_id 时应为可持久档案");
  check(body?.profile?.fullname === "测试用户", "档案应带上昵称");
  check(body?.counts?.creations === 2, `应采集到 2 篇创作，实际 ${body?.counts?.creations}`);
  check(body?.counts?.followees === 2, `应采集到 2 位关注，实际 ${body?.counts?.followees}`);
  check(body?.counts?.collections === 2, `应采集到 2 条收藏，实际 ${body?.counts?.collections}`);

  // 同题聚合：问题 555 下有一条创作、一条收藏。
  const clusters = body?.views?.questionClusters ?? [];
  check(clusters.length === 1 && clusters[0]!.questionId === "555" && clusters[0]!.total === 2, "同题聚合应命中问题 555 的 2 条");

  check(body?.views?.creationYear?.total === 2, "创作年轮应统计 2 篇");

  // 沉睡收藏：1700000000（2023 年）早于 30 天阈值。
  const dormant = body?.views?.collectionTimeline?.dormant ?? [];
  check(dormant.length === 1 && dormant[0]!.title === "很久以前收藏", "沉睡收藏应只包含较早的一条");

  const tiers = body?.views?.followeeTiers ?? [];
  check(tiers.find((tier) => tier.tier === "large")?.count === 1, "应有一位十万粉以上的关注");
  check(tiers.find((tier) => tier.tier === "peer")?.count === 1, "应有一位一万至十万粉的关注");

  const keywords = body?.views?.headlineKeywords ?? [];
  check(keywords.some((keyword) => keyword.keyword === "人工" && (keyword as { count?: number }).count === 2), "简介关键词应统计出重复的相邻双字组合");

  // 第二次请求应命中 TTL 缓存，不再重复扫描上游。
  const before = calls.filter((url) => url.includes("/api/v1/user/contents")).length;
  const second = makeResponse();
  await handle(new URL("https://example.test/api/user/archive"), makeRequest(`${SESSION_COOKIE}=${sessionId}`), second.response);
  const after = calls.filter((url) => url.includes("/api/v1/user/contents")).length;
  check(after === before, "TTL 内再次取档案不应重复扫描上游");

  // refresh=1 是用户显式要求重新同步，应跳过 TTL 再扫一次。
  const forced = makeResponse();
  await handle(new URL("https://example.test/api/user/archive?refresh=1"), makeRequest(`${SESSION_COOKIE}=${sessionId}`, "/api/user/archive?refresh=1"), forced.response);
  const afterForce = calls.filter((url) => url.includes("/api/v1/user/contents")).length;
  check(afterForce > after, "refresh=1 应跳过 TTL 重新同步");

  // 并发进入档案只应触发一次同步（服务端合并并发）。
  const parallelBefore = calls.filter((url) => url.includes("/api/v1/user/followees")).length;
  const [ra, rb] = [makeResponse(), makeResponse()];
  await Promise.all([
    handle(new URL("https://example.test/api/user/archive?refresh=1"), makeRequest(`${SESSION_COOKIE}=${sessionId}`, "/api/user/archive?refresh=1"), ra.response),
    handle(new URL("https://example.test/api/user/archive?refresh=1"), makeRequest(`${SESSION_COOKIE}=${sessionId}`, "/api/user/archive?refresh=1"), rb.response),
  ]);
  const parallelAfter = calls.filter((url) => url.includes("/api/v1/user/followees")).length;
  check(parallelAfter - parallelBefore === 1, `并发同步只应拉取一次关注，实际 ${parallelAfter - parallelBefore}`);

  // 登出应清理该用户的快照。
  const logout = makeResponse();
  await handle(new URL("https://example.test/api/auth/logout"), makeRequest(`${SESSION_COOKIE}=${sessionId}`, "/api/auth/logout", "POST"), logout.response);
  check(logout.captured.status === 200, "登出应返回 200");
  const store = createFilePersonalArchiveStore(personalArchiveDir(dir));
  check((await store.read("stable-hash-1")) === undefined, "登出后应清理该用户快照");

  // 未登录访问应被拒绝，而不是回退到凭证所属账号。
  const anonymous = makeResponse();
  await handle(new URL("https://example.test/api/user/archive"), makeRequest(), anonymous.response);
  check(anonymous.captured.status === 401, `未登录访问档案应返回 401，实际 ${anonymous.captured.status}`);
  check((anonymous.captured.body as { code?: string } | undefined)?.code === "AUTH_REQUIRED", "未登录访问档案应以 AUTH_REQUIRED 拒绝");
} finally {
  globalThis.fetch = originalFetch;
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: "personal-archive-e2e" }));
