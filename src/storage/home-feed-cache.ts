import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ContentSource } from "../platform/zhihu/content.ts";
import type { HomeFeedCacheStore } from "../application/home-feed.ts";
import type { SharedCache } from "../application/shared-cache.ts";

/**
 * 热榜内容的落盘缓存。热榜额度按天计且只有 100 次，
 * 进程重启后仍应能显示上一批真实获取过的内容，而不是留空。
 * 读取失败一律按没有缓存处理：缓存是加速手段，不制造内容。
 */
export function createFileHomeFeedCacheStore(filePath: string): HomeFeedCacheStore {
  return {
    async read() {
      try {
        if (!existsSync(filePath)) return undefined;
        const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
        return parseHotCache(parsed);
      } catch {
        return undefined;
      }
    },
    async write(value) {
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify(value), "utf8");
      } catch {
        // 写失败只影响下次启动的冷启动体验，不影响本次已取到的内容。
      }
    },
  };
}

/**
 * 热榜内容的共享缓存实现：网页端 Serverless 多实例共用一份远端缓存。
 * 即使函数冷启动，也能复用别的实例刚取到的一批，而不是再打一次上游。
 */
export function createSharedCacheHomeFeedCacheStore(cache: SharedCache): HomeFeedCacheStore {
  return {
    async read() {
      return parseHotCache(await cache.get(HOT_CACHE_KEY));
    },
    async write(value) {
      await cache.set(HOT_CACHE_KEY, value, HOT_CACHE_TTL_MS);
    },
  };
}

/** 远端保留窗口与热榜进程内 TTL 同量级：过期交由新鲜度判定，不靠远端自动清理。 */
const HOT_CACHE_TTL_MS = 60 * 60 * 1000;
const HOT_CACHE_KEY = "home:hot";

/** 缓存内容按来源形状校验；缺关键字段的条目丢弃，不当作可用内容。 */
function parseHotCache(value: unknown): { fetchedAt: string; items: ContentSource[] } | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const fetchedAt = typeof record.fetchedAt === "string" ? record.fetchedAt : "";
  if (fetchedAt === "" || Number.isNaN(Date.parse(fetchedAt))) return undefined;
  const items = Array.isArray(record.items) ? record.items : [];
  const valid = items.filter(isContentSource);
  if (valid.length === 0) return undefined;
  return { fetchedAt, items: valid };
}

/** 落盘内容按来源形状校验；缺关键字段的条目丢弃，不当作可用内容。 */
function isContentSource(value: unknown): value is ContentSource {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.title === "string"
    && typeof item.url === "string"
    && typeof item.summary === "string"
    && typeof item.fetchedAt === "string"
    && item.kind === "hot_list";
}

export function homeFeedCachePath(dataDir: string): string {
  return join(dataDir, "cache", "hot-list.json");
}
