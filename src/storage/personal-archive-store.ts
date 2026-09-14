import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SharedCache } from "../application/shared-cache.ts";
import {
  PERSONAL_ARCHIVE_SCHEMA_VERSION,
  type PersonalArchiveCollection,
  type PersonalArchiveCreation,
  type PersonalArchiveFavlist,
  type PersonalArchiveFollowee,
  type PersonalArchiveProfile,
  type PersonalArchiveSnapshot,
  type PersonalArchiveStore,
  type PersonalArchiveTruncation,
} from "../application/personal-archive.ts";

/**
 * 个人档案快照的落盘实现。
 *
 * 快照按用户隔离，键是 `/user` 的 `hash_id`，不是 access token——token 每小时作废，
 * 拿它当键会让每次重新授权都产生一份孤儿档案。读取失败一律按没有快照处理：
 * 档案是组装视图的输入，损坏的快照不能当作真实内容展示。
 */
export function createFilePersonalArchiveStore(dir: string): PersonalArchiveStore {
  return {
    async read(userIdHash) {
      const key = safeKey(userIdHash);
      if (key === undefined) return undefined;
      try {
        const filePath = snapshotPath(dir, key);
        if (!existsSync(filePath)) return undefined;
        return parseSnapshot(JSON.parse(readFileSync(filePath, "utf8")));
      } catch {
        return undefined;
      }
    },
    async write(snapshot) {
      const key = safeKey(snapshot.userIdHash);
      if (key === undefined) return;
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(snapshotPath(dir, key), JSON.stringify(snapshot), "utf8");
      } catch {
        // 写失败只影响下次进入页面时的冷启动，本次已取得的快照仍在内存中可用。
      }
    },
    async clear(userIdHash) {
      const key = safeKey(userIdHash);
      if (key === undefined) return;
      try {
        rmSync(snapshotPath(dir, key), { force: true });
      } catch {
        // 清理失败不阻断登出：残留快照按用户隔离，不会被其他身份读到。
      }
    },
  };
}

/**
 * 快照的共享缓存实现：网页端 Serverless 多实例共用一份远端缓存。
 *
 * 与文件实现语义一致，区别在没有本地磁盘可依赖：读失败按没有快照处理，
 * 写失败只影响跨实例复用，不允许把可用性押在缓存上。
 */
export function createSharedCachePersonalArchiveStore(cache: SharedCache): PersonalArchiveStore {
  return {
    async read(userIdHash) {
      const key = safeKey(userIdHash);
      if (key === undefined) return undefined;
      const value = await cache.get(archiveCacheKey(key));
      return value === undefined ? undefined : parseSnapshot(value);
    },
    async write(snapshot) {
      const key = safeKey(snapshot.userIdHash);
      if (key === undefined) return;
      // 存活时间取快照自己的 TTL 量级：过期快照仍可被读取作 stale 兜底，
      // 这里只决定它在远端留多久，不决定新鲜度判定（新鲜度由 syncedAt 决定）。
      await cache.set(archiveCacheKey(key), snapshot, ARCHIVE_CACHE_TTL_MS);
    },
    async clear(userIdHash) {
      const key = safeKey(userIdHash);
      if (key === undefined) return;
      await cache.delete(archiveCacheKey(key));
    },
  };
}

/** 远端保留窗口：比 TTL 长，保证过期后仍有历史快照可作 stale 兜底。 */
const ARCHIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function archiveCacheKey(userIdHash: string): string {
  return `archive:${userIdHash}`;
}

export function personalArchiveDir(dataDir: string): string {
  return join(dataDir, "personal-archive");
}

function snapshotPath(dir: string, key: string): string {
  return join(dir, `${key}.json`);
}

/** 身份键进入文件名前收敛为安全字符集；不合法时宁可不落盘，也不拼出越界路径。 */
function safeKey(userIdHash: string): string | undefined {
  const key = userIdHash.trim();
  if (key === "" || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) return undefined;
  return key;
}

function parseSnapshot(value: unknown): PersonalArchiveSnapshot | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== PERSONAL_ARCHIVE_SCHEMA_VERSION) return undefined;
  const userIdHash = typeof record.userIdHash === "string" ? record.userIdHash : "";
  const syncedAt = typeof record.syncedAt === "string" ? record.syncedAt : "";
  if (userIdHash === "" || syncedAt === "" || Number.isNaN(Date.parse(syncedAt))) return undefined;
  return {
    schemaVersion: PERSONAL_ARCHIVE_SCHEMA_VERSION,
    userIdHash,
    syncedAt,
    profile: readProfile(record.profile),
    creations: readArray(record.creations, readCreation),
    followees: readArray(record.followees, readFollowee),
    favlists: readArray(record.favlists, readFavlist),
    collections: readArray(record.collections, readCollection),
    truncated: readTruncation(record.truncated),
  };
}

function readArray<T>(value: unknown, read: (item: Record<string, unknown>) => T | undefined): T[] {
  if (!Array.isArray(value)) return [];
  const items: T[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = read(raw as Record<string, unknown>);
    if (item !== undefined) items.push(item);
  }
  return items;
}

function readProfile(value: unknown): PersonalArchiveProfile | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const fullname = readText(record.fullname);
  if (fullname === undefined) return undefined;
  return {
    fullname,
    avatarUrl: readText(record.avatarUrl),
    headline: readText(record.headline),
  };
}

function readCreation(record: Record<string, unknown>): PersonalArchiveCreation | undefined {
  const id = readText(record.id);
  const title = readText(record.title);
  const url = readText(record.url);
  if (id === undefined || title === undefined || url === undefined) return undefined;
  return {
    id,
    contentType: readText(record.contentType),
    title,
    url,
    createdAt: readText(record.createdAt),
    likeCount: readCount(record.likeCount),
    commentCount: readCount(record.commentCount),
    favoriteCount: readCount(record.favoriteCount),
  };
}

function readFollowee(record: Record<string, unknown>): PersonalArchiveFollowee | undefined {
  const id = readText(record.id);
  const name = readText(record.name);
  const url = readText(record.url);
  if (id === undefined || name === undefined || url === undefined) return undefined;
  return {
    id,
    name,
    url,
    headline: readText(record.headline) ?? "",
    followerCount: readCount(record.followerCount),
    avatarUrl: readText(record.avatarUrl),
  };
}

function readFavlist(record: Record<string, unknown>): PersonalArchiveFavlist | undefined {
  const urlToken = readText(record.urlToken);
  const title = readText(record.title);
  if (urlToken === undefined || title === undefined) return undefined;
  return {
    urlToken,
    title,
    description: readText(record.description) ?? "",
    isPublic: record.isPublic === true,
    url: readText(record.url) ?? "",
  };
}

function readCollection(record: Record<string, unknown>): PersonalArchiveCollection | undefined {
  const id = readText(record.id);
  const title = readText(record.title);
  const url = readText(record.url);
  if (id === undefined || title === undefined || url === undefined) return undefined;
  const names = Array.isArray(record.favlistNames)
    ? record.favlistNames.filter((name): name is string => typeof name === "string" && name !== "")
    : [];
  return {
    id,
    contentType: readText(record.contentType),
    title,
    url,
    summary: readText(record.summary) ?? "",
    favlistNames: names,
    authorName: readText(record.authorName),
    favTime: readText(record.favTime),
  };
}

function readTruncation(value: unknown): PersonalArchiveTruncation {
  const record = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    creations: record.creations === true,
    followees: record.followees === true,
    favlistContents: record.favlistContents === true,
  };
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

function readCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
