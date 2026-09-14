import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SharedCache } from "../application/shared-cache.ts";
import {
  ANIMATION_RECORDS_MAX,
  type AnimationRecordStore,
  toAnimationSummary,
} from "../application/animation-records.ts";
import {
  AnimationRecord,
  AnimationSummary,
  type AnimationSummaryList,
} from "../contracts/concept-animation.ts";

/**
 * 成象记录的落盘实现：本机 long-running 运行面用文件。
 *
 * 每个 scope 一个子目录：`index.json` 存摘要列表（按时间倒序），每条记录单独一个
 * `<id>.json`——列表不必读回全部动画正文，详情按 id 精确取。
 * 读取失败一律按"没有这条记录"处理：损坏的记录不能当作真实产物展示。
 */
export function createFileAnimationStore(dir: string): AnimationRecordStore {
  return {
    async list(scope, options) {
      const safe = safeScope(scope);
      if (safe === undefined) return emptyList();
      const summaries = readIndex(indexPath(dir, safe));
      return slice(summaries, options);
    },
    async get(scope, id) {
      const safe = safeScope(scope);
      if (safe === undefined || !isSafeId(id)) return undefined;
      try {
        const file = recordPath(dir, safe, id);
        if (!existsSync(file)) return undefined;
        return parseRecord(JSON.parse(readFileSync(file, "utf8")));
      } catch {
        return undefined;
      }
    },
    async save(scope, record) {
      const safe = safeScope(scope);
      if (safe === undefined) return;
      try {
        mkdirSync(scopeDir(dir, safe), { recursive: true });
        writeFileSync(recordPath(dir, safe, record.id), JSON.stringify(record), "utf8");
        const summaries = readIndex(indexPath(dir, safe));
        const next = [toAnimationSummary(record), ...summaries.filter((item) => item.id !== record.id)]
          .slice(0, ANIMATION_RECORDS_MAX);
        writeFileSync(indexPath(dir, safe), JSON.stringify(next), "utf8");
        pruneRecords(dir, safe, next);
      } catch {
        // 写失败只影响历史留存，本次生成结果已经在响应里返回。
      }
    },
    async remove(scope, id) {
      const safe = safeScope(scope);
      if (safe === undefined || !isSafeId(id)) return false;
      try {
        const summaries = readIndex(indexPath(dir, safe));
        const next = summaries.filter((item) => item.id !== id);
        if (next.length === summaries.length) return false;
        writeFileSync(indexPath(dir, safe), JSON.stringify(next), "utf8");
        rmSync(recordPath(dir, safe, id), { force: true });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * 成象记录的共享缓存实现：网页端 Serverless 多实例共用一份远端存储。
 *
 * 与文件实现语义一致，区别是没有本地磁盘可依赖。远端只保留最近一批，
 * 并用较长的保留窗口替代"永久":产物体积可观，历史按窗口收敛而非无界增长。
 */
export function createSharedCacheAnimationStore(cache: SharedCache): AnimationRecordStore {
  return {
    async list(scope, options) {
      const safe = safeScope(scope);
      if (safe === undefined) return emptyList();
      const summaries = readSummaryList(await cache.get(indexKey(safe)));
      return slice(summaries, options);
    },
    async get(scope, id) {
      const safe = safeScope(scope);
      if (safe === undefined || !isSafeId(id)) return undefined;
      return parseRecord(await cache.get(recordKey(safe, id)));
    },
    async save(scope, record) {
      const safe = safeScope(scope);
      if (safe === undefined) return;
      const summaries = readSummaryList(await cache.get(indexKey(safe)));
      const next = [toAnimationSummary(record), ...summaries.filter((item) => item.id !== record.id)]
        .slice(0, ANIMATION_RECORDS_MAX);
      await cache.set(recordKey(safe, record.id), record, RETENTION_MS);
      await cache.set(indexKey(safe), next, RETENTION_MS);
    },
    async remove(scope, id) {
      const safe = safeScope(scope);
      if (safe === undefined || !isSafeId(id)) return false;
      const summaries = readSummaryList(await cache.get(indexKey(safe)));
      const next = summaries.filter((item) => item.id !== id);
      if (next.length === summaries.length) return false;
      await cache.set(indexKey(safe), next, RETENTION_MS);
      await cache.delete(recordKey(safe, id));
      return true;
    },
  };
}

/** 远端保留窗口：半年。历史是产物留存而非缓存，窗口用于收敛存储增长。 */
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export function animationStoreDir(dataDir: string): string {
  return join(dataDir, "concept-animation");
}

function emptyList(): AnimationSummaryList {
  return { items: [], total: 0 };
}

function slice(summaries: readonly AnimationSummary[], options: { limit: number; offset: number }): AnimationSummaryList {
  const offset = Math.max(0, options.offset);
  const limit = Math.max(0, options.limit);
  return { items: summaries.slice(offset, offset + limit), total: summaries.length };
}

function scopeDir(root: string, scope: string): string {
  return join(root, scope);
}

function indexPath(root: string, scope: string): string {
  return join(scopeDir(root, scope), "index.json");
}

function recordPath(root: string, scope: string, id: string): string {
  return join(scopeDir(root, scope), `${id}.json`);
}

function readIndex(file: string): AnimationSummary[] {
  try {
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return readSummaryList(parsed);
  } catch {
    return [];
  }
}

/** 索引损坏时按空处理；单条摘要字段不合法就丢弃，不把半条记录当有效项。 */
function readSummaryList(value: unknown): AnimationSummary[] {
  if (!Array.isArray(value)) return [];
  const items: AnimationSummary[] = [];
  for (const raw of value) {
    const parsed = AnimationSummary.safeParse(raw);
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

function parseRecord(value: unknown): AnimationRecord | undefined {
  const parsed = AnimationRecord.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** 删除索引外残留的记录文件；只清理本 scope 目录下形如 <id>.json 的文件。 */
function pruneRecords(root: string, scope: string, keep: readonly AnimationSummary[]): void {
  const dir = scopeDir(root, scope);
  const keepIds = new Set(keep.map((item) => item.id));
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "index.json" || !name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (keepIds.has(id)) continue;
    rmSync(join(dir, name), { force: true });
  }
}

function indexKey(scope: string): string {
  return `imagery:v1:${scope}:index`;
}

function recordKey(scope: string, id: string): string {
  return `imagery:v1:${scope}:record:${id}`;
}

/** 身份/范围键进入文件名与缓存键前收敛为安全字符集；不合法时宁可不读写。 */
function safeScope(scope: string): string | undefined {
  const key = scope.trim();
  if (key === "" || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) return undefined;
  return key;
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
