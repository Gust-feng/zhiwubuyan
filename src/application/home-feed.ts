import type { ContentGateway, ContentSource } from "../platform/zhihu/content.ts";

/**
 * 首页内容流：热榜是默认的问题种子，主题检索是用户主动发起的补充。
 * 热榜每天仅 100 次额度，因此这里持有进程内共享缓存并合并并发请求；
 * 额度耗尽或限流时继续用上一批并标注 stale，不把首页变成空白。
 */

const HOT_CACHE_TTL_MS = 60 * 60 * 1000;
const HOT_LIMIT = 20;
/** 主题检索：知乎单页上限 10；补充全网时留固定名额，合计不超出一屏可读的量。 */
const TOPIC_ZHIHU_COUNT = 10;
const TOPIC_WEB_COUNT = 6;
const TOPIC_CACHE_TTL_MS = 15 * 60 * 1000;
const FEED_LIMIT_MAX = 30;

export type HomeFeedScope = "zhihu" | "web";
export type HomeFeedType = "all" | "answer" | "article";
export type HomeFeedChannel = "hot" | "topic";

export type HomeFeed = {
  channel: HomeFeedChannel;
  /** 主题检索的检索词；热榜频道不带。 */
  topic?: string;
  fetchedAt: string;
  items: ContentSource[];
  /** 上游给出的空结果原因，用于区分「没有结果」和「请求失败」。 */
  emptyReason?: string;
  /** 热榜上游失败、返回的是缓存内容时为 true，界面据此说明这批内容的时间。 */
  stale?: boolean;
};

export type HomeFeedInput = {
  topic?: string;
  scope?: HomeFeedScope;
  type?: HomeFeedType;
  limit?: number;
};

/**
 * 热榜缓存的持久化适配器：额度只有 100 次/天，进程重启不该把上一批内容丢掉。
 * 只存已经成功获取过的内容，读取失败一律当没有缓存，不编造。
 * 端口按异步声明：本地/桌面写文件，网页端写跨实例的远端缓存。
 */
export type HomeFeedCacheStore = {
  read(): Promise<{ fetchedAt: string; items: ContentSource[] } | undefined>;
  write(value: { fetchedAt: string; items: ContentSource[] }): Promise<void>;
};

/** 主题检索缓存条数上限：键含用户检索词，必须设上限才不会随使用时长增长。 */
const TOPIC_CACHE_MAX_ENTRIES = 200;

export function createHomeFeedCommand(input: {
  content: ContentGateway;
  clock?: () => Date;
  cacheStore?: HomeFeedCacheStore;
}) {
  const clock = input.clock ?? (() => new Date());

  let hotCache: { at: number; fetchedAt: string; items: ContentSource[] } | undefined;
  let hotInFlight: Promise<{ fetchedAt: string; items: ContentSource[]; stale: boolean }> | undefined;
  const topicCache = new Map<string, { at: number; feed: HomeFeed }>();
  const topicInFlight = new Map<string, Promise<HomeFeed>>();

  function rememberTopic(key: string, feed: HomeFeed): void {
    // 命中即提到队尾；淘汰从队首取最久未用的。
    topicCache.delete(key);
    topicCache.set(key, { at: clock().getTime(), feed });
    while (topicCache.size > TOPIC_CACHE_MAX_ENTRIES) {
      const oldest = topicCache.keys().next();
      if (oldest.done === true) break;
      topicCache.delete(oldest.value);
    }
  }

  // 进程内没有就把上次成功的一批读回来；它有真实获取时间，界面会据此标注时效。
  async function persistedHot(): Promise<{ at: number; fetchedAt: string; items: ContentSource[] } | undefined> {
    if (hotCache) return hotCache;
    const stored = await input.cacheStore?.read().catch(() => undefined);
    if (!stored) return undefined;
    const at = Date.parse(stored.fetchedAt);
    if (Number.isNaN(at)) return undefined;
    hotCache = { at, fetchedAt: stored.fetchedAt, items: stored.items };
    return hotCache;
  }

  async function loadHot(): Promise<{ fetchedAt: string; items: ContentSource[]; stale: boolean }> {
    const now = clock().getTime();
    const cached = await persistedHot();
    if (cached && now - cached.at < HOT_CACHE_TTL_MS) {
      return { fetchedAt: cached.fetchedAt, items: cached.items, stale: false };
    }
    if (!hotInFlight) {
      hotInFlight = (async () => {
        try {
          const result = await input.content.listHotContent({ limit: HOT_LIMIT });
          hotCache = { at: clock().getTime(), fetchedAt: result.fetchedAt, items: result.items };
          await input.cacheStore?.write({ fetchedAt: result.fetchedAt, items: result.items }).catch(() => undefined);
          return { fetchedAt: result.fetchedAt, items: result.items, stale: false };
        } catch (error) {
          // 上游不可用时继续用上一批，并如实标注它不是刚获取的。
          if (cached) return { fetchedAt: cached.fetchedAt, items: cached.items, stale: true };
          throw error;
        }
      })().finally(() => {
        hotInFlight = undefined;
      });
    }
    return hotInFlight;
  }

  async function compose(request: HomeFeedInput): Promise<HomeFeed> {
    const topic = request.topic?.trim();
    if (!topic) {
      const hot = await loadHot();
      return {
        channel: "hot",
        fetchedAt: hot.fetchedAt,
        items: hot.items.slice(0, clampLimit(request.limit)),
        stale: hot.stale || undefined,
      };
    }

    const type = request.type ?? "all";
    const zhihu = await input.content.searchZhihu({ query: topic, count: TOPIC_ZHIHU_COUNT });
    const web = request.scope === "web"
      ? await input.content.searchGlobal({ query: topic, count: TOPIC_WEB_COUNT })
      : undefined;
    // 站内优先、全网补充；同一链接只出现一次，去重不修改保存的原始地址。
    const items = dedupe([...zhihu.items, ...(web?.items ?? [])])
      .filter((item) => matchesType(item, type))
      .slice(0, clampLimit(request.limit));
    return {
      channel: "topic",
      topic,
      fetchedAt: zhihu.fetchedAt,
      items,
      emptyReason: zhihu.emptyReason,
    };
  }

  return {
    async feed(request: HomeFeedInput): Promise<HomeFeed> {
      const topic = request.topic?.trim();
      if (!topic) return await compose(request);
      const scope = request.scope ?? "zhihu";
      const type = request.type ?? "all";
      const limit = clampLimit(request.limit);
      const key = `${topic}\u0000${scope}\u0000${type}\u0000${limit}`;

      const cached = topicCache.get(key);
      if (cached && clock().getTime() - cached.at < TOPIC_CACHE_TTL_MS) {
        // 命中即刷新使用顺序，配合上限做 LRU 淘汰。
        rememberTopic(key, cached.feed);
        return cached.feed;
      }

      const running = topicInFlight.get(key);
      if (running) return running;

      const task = compose({ topic, scope, type, limit })
        .then((feed) => {
          rememberTopic(key, feed);
          return feed;
        })
        .finally(() => {
          topicInFlight.delete(key);
        });
      topicInFlight.set(key, task);
      return task;
    },
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || limit <= 0) return HOT_LIMIT;
  return Math.min(limit, FEED_LIMIT_MAX);
}

/** 内容类型筛选只作用于主题检索：热榜不返回类型，界面对热榜频道不提供筛选。 */
function matchesType(item: ContentSource, type: HomeFeedType): boolean {
  if (type === "all") return true;
  return (item.contentType ?? "").toLowerCase() === type;
}

function dedupe(items: ContentSource[]): ContentSource[] {
  const seen = new Set<string>();
  const result: ContentSource[] = [];
  for (const item of items) {
    const key = item.url || item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
