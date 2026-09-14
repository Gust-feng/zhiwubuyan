import type { IncomingMessage, ServerResponse } from "node:http";
import { Redis } from "@upstash/redis";
import { createRuntime } from "../application/runtime.ts";
import { createMemorySharedCache, type SharedCache } from "../application/shared-cache.ts";
import { readOAuthAppConfig, missingOAuthConfig, oauthRedirectUri } from "../platform/zhihu/oauth.ts";
import { createKvSharedCache, readRedisRestConfig } from "../storage/kv-shared-cache.ts";
import { createSharedCacheHomeFeedCacheStore } from "../storage/home-feed-cache.ts";
import { createSharedCachePersonalArchiveStore } from "../storage/personal-archive-store.ts";
import { createZhihuApiHandler } from "./zhihu-api.ts";
import { createKvSessionStore, createMemorySessionStore, type SessionStore } from "./session-store.ts";
import {
  createKvRateLimiter,
  createMemoryRateLimiter,
  readRateLimitConfig,
  type RateLimiter,
} from "./rate-limit.ts";
import { writeJson } from "./http-utils.ts";

/**
 * 网页面（Vercel 函数）的服务端装配。
 *
 * Vercel 的 `api/` 目录是**按文件路由**：每个文件对应一条路径。实测根级
 * catch-all（`api/[...path].ts`）只匹配单层路径，多段路径会先被平台 404 拦掉，
 * 因此各条路由由 `api/**` 下的显式文件声明，这里只提供它们共用的处理函数。
 */

// 共用的 KV 连接：登录会话、限流与缓存都走同一份。
// 未配置时退回进程内存，只在本地单实例联调成立——生产未配置等于每个实例各存一份，
// 登录会随机失效、缓存与单飞失效，因此这里读的变量名必须与集成实际注入的一致。
const redisConfig = readRedisRestConfig(process.env);
const redis = redisConfig === undefined ? undefined : new Redis(redisConfig);

// 知乎 OAuth token 只存服务端 KV；未配置时退回进程内存（单实例，仅供联调）。
// 生产必须配置：Serverless 实例之间不共享内存，否则登录会话会随机丢失。
function createSessions(): SessionStore {
  return redis === undefined ? createMemorySessionStore() : createKvSessionStore(redis);
}

// 限流与登录会话用同一份 KV：免费部署也按会话/来源地址计数，保住调用方额度。
function createRateLimiter(): RateLimiter {
  const config = readRateLimitConfig(process.env);
  return redis === undefined ? createMemoryRateLimiter(config) : createKvRateLimiter(redis, config);
}

const accessSecret = process.env.ZHIHU_ACCESS_SECRET?.trim();
// 缓存与登录会话共用 KV：热榜与个人档案在实例之间复用，冷启动不再重复消耗上游额度。
// 个人档案一次同步最坏上百次上游调用，是额度最重的入口；共享缓存 + 单飞把它收敛为一次。
// 未配置 KV 时退回进程内缓存：不改变行为，只是失去跨实例复用。
const sharedCache: SharedCache = redis === undefined ? createMemorySharedCache() : createKvSharedCache(redis);
const runtime = accessSecret
  ? createRuntime({
      accessSecret,
      hotCacheStore: createSharedCacheHomeFeedCacheStore(sharedCache),
      personalArchiveStore: createSharedCachePersonalArchiveStore(sharedCache),
      archiveLock: sharedCache,
    })
  : undefined;

// 网页端承接知乎 API 面（热榜、我的知乎、众声、首页直答）与深度研究 Pro。
// Pro 是单次知乎直答调用，不依赖长驻研究引擎；自研 Ultra 引擎只在本地/桌面运行面承接，
// 因此这里声明 research（前端据此启用研究入口）但不声明 research_ultra（档位菜单只剩 Pro）。
const handleZhihuApi = createZhihuApiHandler({
  runtime,
  oauthConfig: readOAuthAppConfig(process.env),
  oauthMissingConfig: missingOAuthConfig(process.env),
  oauthRedirectUri: oauthRedirectUri(process.env),
  sessions: createSessions(),
  capabilities: ["zhihu_search", "global_search", "hot_list", "user_data", "voices", "research"],
  surface: "web",
  researchProEnabled: true,
  hotCacheControl: "public, s-maxage=3600, stale-while-revalidate=300",
  rateLimiter: createRateLimiter(),
});

/** 各 `api/**` 入口共用的处理函数；未命中的路径回落到本函数的 404。 */
export default async function webApiHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", `https://${request.headers.host ?? "localhost"}`);
  if (await handleZhihuApi(url, request, response)) return;
  writeJson(response, 404, { code: "NOT_FOUND", message: "接口不存在。" });
}
