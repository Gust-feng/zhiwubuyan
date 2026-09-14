/**
 * 共享缓存端口：跨请求、跨实例复用上游结果，保护按账号汇总的开放平台额度。
 *
 * 语义由应用层声明，实现按运行面选择：单进程（本地/桌面）用有界内存，
 * 网页端用远端 KV。端口是异步的——远端实现天然异步，本地实现同步返回即可，
 * 不让调用方为运行面差异分叉。
 */

export type SharedCache = {
  /** 命中返回已存的值；缺失或已过期返回 undefined，不做任何猜测。 */
  get(key: string): Promise<unknown>;
  /** 写入并设置存活时间；ttlMs 必须为正，缓存是加速手段，不允许写永久数据。 */
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * 单飞：同一键在 ttlMs 内只允许一个持有者。
   * 返回 true 表示本次拿到执行权，false 表示已有并发请求/其他实例在做同一件事。
   */
  acquire(key: string, ttlMs: number): Promise<boolean>;
};

export type MemorySharedCacheOptions = {
  /** 条目上限；超出时先淘汰最久未使用的，保证长驻进程不会因用户输入无界增长。 */
  maxEntries?: number;
  clock?: () => number;
};

const DEFAULT_MAX_ENTRIES = 500;

/**
 * 单进程实现：带 TTL 与容量上限的 LRU。
 * 键可能来自用户输入（检索词），因此必须同时有 TTL 和条数上限，缺一都会随使用时长泄漏。
 */
export function createMemorySharedCache(options: MemorySharedCacheOptions = {}): SharedCache {
  const clock = options.clock ?? Date.now;
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const values = new Map<string, { value: unknown; expiresAt: number }>();
  const locks = new Map<string, number>();

  function readLive(key: string): { value: unknown; expiresAt: number } | undefined {
    const entry = values.get(key);
    if (entry === undefined) return undefined;
    if (clock() >= entry.expiresAt) {
      values.delete(key);
      return undefined;
    }
    // 命中即提到队尾：Map 迭代顺序即使用顺序，淘汰时从队首取最久未用的。
    values.delete(key);
    values.set(key, entry);
    return entry;
  }

  function evict(): void {
    const now = clock();
    for (const [key, entry] of values) {
      if (now < entry.expiresAt) break;
      values.delete(key);
    }
    while (values.size > maxEntries) {
      const oldest = values.keys().next();
      if (oldest.done === true) break;
      values.delete(oldest.value);
    }
  }

  return {
    async get(key) {
      return readLive(key)?.value;
    },
    async set(key, value, ttlMs) {
      if (!(ttlMs > 0)) return;
      values.delete(key);
      values.set(key, { value, expiresAt: clock() + ttlMs });
      evict();
    },
    async delete(key) {
      values.delete(key);
    },
    async acquire(key, ttlMs) {
      const now = clock();
      const held = locks.get(key);
      if (held !== undefined && now < held) return false;
      if (held !== undefined) locks.delete(key);
      locks.set(key, now + ttlMs);
      // 顺带回收过期锁，避免锁表本身无界。
      for (const [lockKey, expiresAt] of locks) {
        if (now < expiresAt) break;
        locks.delete(lockKey);
      }
      return true;
    },
  };
}
