/**
 * 取数结果的进程内短时缓存（按路径）。
 *
 * 视图切换会卸载再挂载组件，取数 hook 因此从头开始 loading 并重新请求，
 * 表现为「每切一次视图就闪一下」。这些结果在秒级内不会变化，
 * 缓存住就能让重挂载直接命中，界面不再闪。
 *
 * 只缓存**成功**结果；失败不写，下次仍会重新尝试。
 * 与 `loadSurfaceCapabilities` 的模块级缓存同一思路，范围限在浏览器标签页内。
 */

type Entry = { at: number; value: unknown };

/** 默认 30 秒：足够吸收视图切换与同屏多处重复请求，又不会让数据看起来是旧的。 */
const DEFAULT_TTL_MS = 30_000;
const MAX_ENTRIES = 50;

const store = new Map<string, Entry>();

/** 读取仍有效的结果；过期的顺手丢掉。 */
export function readCachedJson<T>(key: string, ttlMs = DEFAULT_TTL_MS, now = Date.now()): T | undefined {
  const entry = store.get(key);
  if (entry === undefined) return undefined;
  if (now - entry.at >= ttlMs) {
    store.delete(key);
    return undefined;
  }
  // 命中即提到队尾，淘汰时从队首取最久未用的。
  store.delete(key);
  store.set(key, entry);
  return entry.value as T;
}

export function writeCachedJson(key: string, value: unknown, now = Date.now()): void {
  store.delete(key);
  store.set(key, { at: now, value });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done === true) break;
    store.delete(oldest.value);
  }
}

/** 用户显式刷新或登出时清空，避免拿到上一状态的数据。 */
export function clearJsonCache(): void {
  store.clear();
}

/**
 * 按同一 key 合并并发请求：同屏多处请求同一路径时只发一次。
 * 结果写入短时缓存，供后续重挂载直接命中。
 */
const inFlight = new Map<string, Promise<unknown>>();

export async function fetchJsonCached<T>(
  key: string,
  load: () => Promise<T>,
  options: { ttlMs?: number; force?: boolean } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (options.force !== true) {
    const cached = readCachedJson<T>(key, ttlMs);
    if (cached !== undefined) return cached;
  } else {
    store.delete(key);
  }

  const running = inFlight.get(key);
  if (running !== undefined) return running as Promise<T>;

  const task = load()
    .then((value) => {
      writeCachedJson(key, value);
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, task);
  return task;
}
