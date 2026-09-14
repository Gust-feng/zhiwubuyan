import type { SharedCache } from "../application/shared-cache.ts";

/**
 * 远端共享缓存实现（Vercel KV / Upstash Redis REST）。
 *
 * 网页端是 Serverless 多实例：进程内存里的缓存在冷启动后等于不存在，档案这类
 * 额度最重的入口会因此在每个新实例里重复全量扫描。共享缓存把「一次同步」扩展到
 * 整个部署，实例之间不再各自重扫。
 *
 * 缓存不可用时一律按未命中处理：缓存是额度保护手段，不能把可用性押在它上面。
 */

/** 只声明用到的子集，便于用测试替身驱动；@upstash/redis 的 Redis 直接满足。 */
export type RedisLike = {
  get<T = unknown>(key: string): Promise<T | null>;
  set(
    key: string,
    value: unknown,
    options?: { readonly ex?: number; readonly nx?: boolean },
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

/** Redis REST 连接信息；两套环境变量命名都接受，见 readRedisRestConfig。 */
export type RedisRestConfig = { url: string; token: string };

/**
 * 读取 Redis REST 连接信息。
 *
 * 两套命名都要认：`UPSTASH_REDIS_REST_*` 是 Upstash 集成现在注入的名字，
 * `KV_REST_API_*` 是被并入 Upstash 的旧 Vercel KV 遗留名（`@upstash/redis`
 * 自己的 fromEnv 也是这个回退顺序）。只认一套会让部署静默退回进程内存——
 * 表面上一切正常，实际每个实例各存一份会话与缓存。
 */
export function readRedisRestConfig(env: Record<string, string | undefined>): RedisRestConfig | undefined {
  const url = firstNonEmpty(env.UPSTASH_REDIS_REST_URL, env.KV_REST_API_URL);
  const token = firstNonEmpty(env.UPSTASH_REDIS_REST_TOKEN, env.KV_REST_API_TOKEN);
  if (url === undefined || token === undefined) return undefined;
  return { url, token };
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed !== "") return trimmed;
  }
  return undefined;
}

export function createKvSharedCache(redis: RedisLike): SharedCache {
  return {
    async get(key) {
      try {
        const value = await redis.get(key);
        return value === null ? undefined : value;
      } catch {
        return undefined;
      }
    },
    async set(key, value, ttlMs) {
      try {
        await redis.set(key, value, { ex: toSeconds(ttlMs) });
      } catch {
        // 写失败只影响后续请求能否复用，本次结果仍然照常返回。
      }
    },
    async delete(key) {
      try {
        await redis.del(key);
      } catch {
        // 清理失败不阻断调用方：残留条目带 TTL，会自行过期。
      }
    },
    async acquire(key, ttlMs) {
      try {
        // SET NX 由 Redis 保证原子：并发请求里只有一个拿到执行权。
        const result = await redis.set(key, "1", { nx: true, ex: toSeconds(ttlMs) });
        return result !== null;
      } catch {
        // 拿不到结论时允许执行：宁可多打一次上游，也不能把请求卡死在锁上。
        return true;
      }
    },
  };
}

/** 上游 TTL 用秒；不足一秒按一秒计，避免取整成 0 变成不设过期。 */
function toSeconds(ttlMs: number): number {
  return Math.max(1, Math.ceil(ttlMs / 1000));
}
