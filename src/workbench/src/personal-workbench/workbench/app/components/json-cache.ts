/**
 * 取数结果的进程内短时缓存（按路径）。
 *
 * 视图切换会卸载再挂载组件，取数 hook 因此从头开始 loading 并重新请求，
 * 表现为「每切一次视图就闪一下」。这些结果在秒级内不会变化，
 * 缓存住就能让重挂载直接命中，界面不再闪。
 *
 * 只缓存**成功**结果；失败不写，下次仍会重新尝试。范围限在浏览器标签页内。
 *
 * 缓存值的形状由写入方决定，同一个 key 只能有一处写入。启动预取
 * （见 `workbench/boot-prefetch.ts`）写入的是**原始响应体**，因此被预取的路径，
 * 其消费方也必须以原始响应体为缓存值，校验与投影在读出之后各自做。
 */

type Entry = { at: number; value: unknown };

/** 默认 30 秒：足够吸收视图切换与同屏多处重复请求，又不会让数据看起来是旧的。 */
const DEFAULT_TTL_MS = 30_000;
const MAX_ENTRIES = 50;

/**
 * 首帧取上一份结果时允许的缓存年龄。
 * 比请求侧的 30 秒 TTL 长得多：它的唯一用途是**给首帧一个初值**，把「切换视图先闪一次加载」压掉；
 * 数据本身仍按 30 秒 TTL 在后台重新取，列表也照旧显示实际获取时间，不假装是刚取到的。
 */
export const INITIAL_REUSE_TTL_MS = 5 * 60 * 1000;

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

/**
 * 接进一条**已经在途**的请求：与 `fetchJsonCached` 共用同一份单飞与缓存，
 * 消费方按同一个 key 取数就会命中它，不必知道这条请求是谁发出的。
 * 启动预取用它把 HTML 解析阶段就发出的请求交给应用。
 */
export function adoptInFlightJson(key: string, task: Promise<unknown>): void {
  if (store.has(key) || inFlight.has(key)) return;

  const tracked: Promise<unknown> = task.then((value) => {
    writeCachedJson(key, value);
    return value;
  });
  inFlight.set(key, tracked);
  // 预取的路径可能始终没有消费方（热榜取了但用户没打开探索），失败不能变成未处理拒绝。
  // 消费方拿到的是 tracked 本身，失败照常传到它自己的 catch。
  void tracked
    .catch(() => undefined)
    .finally(() => {
      if (inFlight.get(key) === tracked) inFlight.delete(key);
    });
}
