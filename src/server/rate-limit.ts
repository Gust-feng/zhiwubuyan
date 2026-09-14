import type { KvClient } from "./session-store.ts";

/**
 * 额度保护限流：只用在登录后消耗开放平台额度的接口（直答、众声）。
 * 热榜与内容流是公开内容，靠 CDN 共享缓存，不进限流——把它们挡在登录后反而
 * 会让缓存失去共享性，是更差的保护。
 */

export type RateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export type RateLimiter = {
  /** 计数一次；超过窗口内上限时返回不允许。 */
  check(key: string): Promise<RateLimitDecision>;
};

export type RateLimitConfig = {
  /** 每个窗口允许的次数。 */
  readonly max: number;
  /** 窗口长度（秒）。 */
  readonly windowSeconds: number;
};

const DEFAULT_MAX = 20;
const DEFAULT_WINDOW_SECONDS = 60;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim());
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** 环境变量阈值；非法值一律回退默认，不因为配置写错而关掉限流。 */
export function readRateLimitConfig(env: Record<string, string | undefined>): RateLimitConfig {
  return {
    max: readPositiveInt(env.WEB_RATE_LIMIT_MAX, DEFAULT_MAX),
    windowSeconds: readPositiveInt(env.WEB_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS),
  };
}

/** 本地单进程实现：固定窗口计数，窗口滚动时清零。 */
export function createMemoryRateLimiter(config: RateLimitConfig): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async check(key) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (bucket === undefined || now >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + config.windowSeconds * 1000 });
        return { allowed: true };
      }
      if (bucket.count >= config.max) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
      }
      bucket.count += 1;
      return { allowed: true };
    },
  };
}

/**
 * Vercel serverless 实现：KV 里按窗口键自增，首次写入设置 TTL。
 * 计数接口本身失败时放行——限流是额度保护，不能把可用性押在 KV 上。
 */
export function createKvRateLimiter(kv: KvClient, config: RateLimitConfig): RateLimiter {
  return {
    async check(key) {
      const windowId = Math.floor(Date.now() / (config.windowSeconds * 1000));
      const windowKey = `rl:${key}:${windowId}`;
      try {
        // KV 子集没有 INCR，这里读改写；并发下可能少计，作为额度保护足够。
        const current = Number(await kv.get(windowKey)) || 0;
        const next = current + 1;
        await kv.set(windowKey, next, { ex: config.windowSeconds * 2 });
        if (next > config.max) {
          const elapsed = Date.now() % (config.windowSeconds * 1000);
          return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((config.windowSeconds * 1000 - elapsed) / 1000)) };
        }
        return { allowed: true };
      } catch {
        return { allowed: true };
      }
    },
  };
}

/** 限流键：优先会话，其次来源地址；两者都取不到时用统一兜底键，不静默放行全部。 */
export function rateLimitKey(scope: string, sessionId: string | undefined, request: { headers: Record<string, unknown> }): string {
  if (sessionId !== undefined && sessionId !== "") return `${scope}:sess:${sessionId}`;
  const forwarded = request.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = typeof raw === "string" ? raw.split(",")[0]?.trim() : undefined;
  return `${scope}:ip:${ip && ip !== "" ? ip : "unknown"}`;
}
