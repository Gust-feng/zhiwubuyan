import type { SharedCache } from "./shared-cache.ts";

/**
 * 个人数据列表的短时缓存（创作 / 收藏 / 关注这类「我的知乎」摘要）。
 *
 * 这些接口必须带用户自己的 OAuth token，每次刷新页面都会重新问一次知乎。
 * 数据本身不会分钟级变化，因此按**会话用户**隔离做短时缓存：
 * 刷新与页面切换复用同一份结果，额度只花在真正需要新数据的时候
 * （与 docs/开放平台能力清单.md「个人数据最小读取」一致）。
 *
 * 两条硬约束：
 * 1. **按用户隔离**：缓存键必须含用户身份，绝不能让一个用户读到另一个用户的数据。
 * 2. **只缓存成功结果**：失败不写缓存，避免把一次抖动放大成一段时间不可用。
 */

/** 默认 10 分钟：足够吸收刷新与页面切换，又不会让数据看起来是旧的。 */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export type UserFeedCache = {
  /**
   * 取一份按用户隔离的列表结果：TTL 内直接复用，过期才真正取数。
   * 同一用户并发只发一次（进程内合并），跨实例由共享缓存承担。
   */
  load<T>(request: {
    /** 用户身份标识（会话标识即可，不需要可读性）。 */
    userId: string;
    /** 列表标识，用于区分同一用户的创作 / 收藏 / 关注。 */
    feed: string;
    load: () => Promise<T>;
  }): Promise<T>;
  /** 登出时清理该用户的全部缓存，避免残留快照。 */
  clear(userId: string): Promise<void>;
};

export function createUserFeedCache(input: {
  cache?: SharedCache;
  clock?: () => Date;
  ttlMs?: number;
  feeds?: readonly string[];
} = {}): UserFeedCache {
  const clock = input.clock ?? (() => new Date());
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const feeds = input.feeds ?? [];
  const inFlight = new Map<string, Promise<unknown>>();

  function keyOf(userId: string, feed: string): string {
    return `userfeed:${feed}:${userId}`;
  }

  return {
    async load<T>(request: { userId: string; feed: string; load: () => Promise<T> }): Promise<T> {
      // 没有用户身份就不缓存：宁可不省额度，也不能把结果写到别人可能读到的键上。
      if (request.userId === "") return request.load();

      const cacheKey = keyOf(request.userId, request.feed);

      if (input.cache !== undefined) {
        const cached = await input.cache.get(cacheKey).catch(() => undefined);
        if (cached !== undefined && cached !== null) return cached as T;
      }

      // 同一实例内的并发只取一次；跨实例的重复由共享缓存的 TTL 挡住大部分。
      const running = inFlight.get(cacheKey);
      if (running !== undefined) return running as Promise<T>;

      const task = request.load()
        .then(async (value) => {
          await input.cache?.set(cacheKey, value, ttlMs).catch(() => undefined);
          return value;
        })
        .finally(() => {
          inFlight.delete(cacheKey);
        });
      inFlight.set(cacheKey, task);
      return task as Promise<T>;
    },

    async clear(userId: string): Promise<void> {
      if (input.cache === undefined || userId === "") return;
      for (const feed of feeds) {
        inFlight.delete(keyOf(userId, feed));
        await input.cache.delete(keyOf(userId, feed)).catch(() => undefined);
      }
      // 未登记的列表键无法枚举删除；它们带 TTL，会自行过期。
    },
  };
}

/** 本命令负责的列表标识；登出清理据此逐键删除。 */
export const USER_FEED_IDS = ["contents", "collections", "followees"] as const;
