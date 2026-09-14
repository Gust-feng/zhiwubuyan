import { nextOffsetQuery, type Paging } from "../platform/zhihu/paging.ts";
import type { AuthorizedUserProfile } from "../platform/zhihu/user-profile.ts";
import type { SharedCache } from "./shared-cache.ts";
import type {
  CollectedItem,
  CreationItem,
  FavlistItem,
  FolloweeItem,
  UserDataGateway,
} from "../platform/zhihu/user-data.ts";

/**
 * 个人档案采集：把登录用户自己的创作、关注与收藏取全并整理成一份快照。
 *
 * 快照是所有组装视图的唯一数据来源，也是本能力的持久化 owner。采集有副作用且消耗
 * `user_data` 额度（额度按 Access Secret 所属账号汇总，多用户共享同一池），因此
 * 进入页面不直接全量扫描：命令按用户做 TTL 缓存并合并并发请求，做到「一次同步、多次组装」。
 */

export const PERSONAL_ARCHIVE_SCHEMA_VERSION = 1;

export type PersonalArchiveProfile = {
  fullname: string;
  avatarUrl?: string;
  headline?: string;
};

export type PersonalArchiveTruncation = {
  creations: boolean;
  followees: boolean;
  favlistContents: boolean;
};

export type PersonalArchiveCreation = {
  id: string;
  contentType?: string;
  title: string;
  url: string;
  createdAt?: string;
  likeCount?: number;
  commentCount?: number;
  favoriteCount?: number;
};

export type PersonalArchiveFollowee = {
  id: string;
  name: string;
  url: string;
  headline: string;
  followerCount?: number;
  avatarUrl?: string;
};

export type PersonalArchiveFavlist = {
  urlToken: string;
  title: string;
  description: string;
  isPublic: boolean;
  url: string;
};

export type PersonalArchiveCollection = {
  id: string;
  contentType?: string;
  title: string;
  url: string;
  summary: string;
  favlistNames: readonly string[];
  authorName?: string;
  favTime?: string;
};

export type PersonalArchiveSnapshot = {
  schemaVersion: number;
  userIdHash: string;
  syncedAt: string;
  profile?: PersonalArchiveProfile;
  creations: readonly PersonalArchiveCreation[];
  followees: readonly PersonalArchiveFollowee[];
  favlists: readonly PersonalArchiveFavlist[];
  collections: readonly PersonalArchiveCollection[];
  truncated: PersonalArchiveTruncation;
};

/**
 * 快照持久化由存储模块实现；应用层只声明需要的读写语义。
 * 端口按异步声明：本地/桌面用同进程文件，网页端用跨实例的远端缓存，
 * 两者语义一致，落地方式的差异只体现在实现里。
 */
export type PersonalArchiveStore = {
  read(userIdHash: string): Promise<PersonalArchiveSnapshot | undefined>;
  write(snapshot: PersonalArchiveSnapshot): Promise<void>;
  clear(userIdHash: string): Promise<void>;
};

/** 一次读取的结果：stale 表示上游不可用，复用的是上一份快照而不是刚同步的数据。 */
export type PersonalArchiveLoad = {
  snapshot: PersonalArchiveSnapshot;
  stale: boolean;
};

export type PersonalArchiveLimits = {
  pageSize: number;
  maxCreationPages: number;
  maxFolloweePages: number;
  maxFavlists: number;
  maxFavlistContentPages: number;
};

/**
 * 页数上限是「宁可少取也不失控」的闸门：达到上限时快照标记 truncated，
 * 界面如实说明覆盖范围，不把被截断的列表当成完整数据展示。
 */
export const DEFAULT_PERSONAL_ARCHIVE_LIMITS: PersonalArchiveLimits = {
  pageSize: 50,
  maxCreationPages: 20,
  maxFolloweePages: 10,
  maxFavlists: 50,
  maxFavlistContentPages: 3,
};

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export type CollectPersonalArchiveInput = {
  gateway: UserDataGateway;
  userIdHash: string;
  profile?: AuthorizedUserProfile;
  limits?: Partial<PersonalArchiveLimits>;
  clock?: () => Date;
};

/** 逐页取全一个列表；返回是否因页数上限被截断。 */
export async function collectPersonalArchive(input: CollectPersonalArchiveInput): Promise<PersonalArchiveSnapshot> {
  const clock = input.clock ?? (() => new Date());
  const limits = { ...DEFAULT_PERSONAL_ARCHIVE_LIMITS, ...input.limits };
  const { gateway } = input;

  const creations = await collectPages(
    (offset, limit) => gateway.myContents({ limit, offset }),
    limits.pageSize,
    limits.maxCreationPages,
  );
  const followees = await collectPages(
    (offset, limit) => gateway.followees({ limit, offset }),
    limits.pageSize,
    limits.maxFolloweePages,
  );
  const favlistsResult = await gateway.favlists({ limit: limits.pageSize });
  const collections = await gateway.recentCollections({ limit: limits.pageSize });

  const favlistContents = await collectFavlistContents(gateway, favlistsResult.items, limits);

  return {
    schemaVersion: PERSONAL_ARCHIVE_SCHEMA_VERSION,
    userIdHash: input.userIdHash,
    syncedAt: clock().toISOString(),
    profile: toProfile(input.profile),
    creations: dedupeByUrl(creations.items.map(toCreation)),
    followees: dedupeByUrl(followees.items.map(toFollowee)),
    favlists: favlistsResult.items,
    collections: dedupeCollected(collections.items),
    truncated: {
      creations: creations.truncated,
      followees: followees.truncated,
      favlistContents: favlistContents.truncated,
    },
  };
}

export type PersonalArchiveCommand = {
  /**
   * 取当前用户的快照：TTL 内直接复用，过期才同步；同一用户并发只发一次上游请求。
   * `persist: false` 用于取不到稳定身份键的会话（不落盘，只在本次会话内存活）。
   * 上游不可用且手上有历史快照时返回 stale 结果，不把页面变成空白。
   */
  load(request: {
    userIdHash: string;
    gateway: UserDataGateway;
    profile?: AuthorizedUserProfile;
    persist?: boolean;
    force?: boolean;
  }): Promise<PersonalArchiveLoad>;
  clear(userIdHash: string): Promise<void>;
};

/** 采集失败后的短时冷却：避免额度耗尽或上游抖动时被连续触发全量重扫。 */
const DEFAULT_FAILURE_COOLDOWN_MS = 60 * 1000;
/** 进程内快照条数上限：按用户增长，超出时淘汰最久未访问的。 */
const DEFAULT_MAX_ENTRIES = 200;

export function createPersonalArchiveCommand(input: {
  store?: PersonalArchiveStore;
  /** 跨实例单飞：同一用户在多个实例上并发进入时只让一个真正扫描。 */
  lock?: Pick<SharedCache, "acquire">;
  clock?: () => Date;
  ttlMs?: number;
  failureCooldownMs?: number;
  maxEntries?: number;
  limits?: Partial<PersonalArchiveLimits>;
} = {}): PersonalArchiveCommand {
  const clock = input.clock ?? (() => new Date());
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const failureCooldownMs = input.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS;
  const maxEntries = Math.max(1, input.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const limits = { ...DEFAULT_PERSONAL_ARCHIVE_LIMITS, ...input.limits };
  const cache = new Map<string, { at: number; snapshot: PersonalArchiveSnapshot }>();
  const inFlight = new Map<string, Promise<PersonalArchiveLoad>>();
  const failedAt = new Map<string, number>();

  function isFresh(at: number): boolean {
    return clock().getTime() - at < ttlMs;
  }

  function remember(key: string, snapshot: PersonalArchiveSnapshot): void {
    cache.delete(key);
    cache.set(key, { at: clock().getTime(), snapshot });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next();
      if (oldest.done === true) break;
      cache.delete(oldest.value);
    }
  }

  /** 失败时尽量给出历史快照；给出时必须标记 stale，不冒充刚同步的数据。 */
  async function fallback(key: string, persist: boolean): Promise<PersonalArchiveLoad | undefined> {
    const inMemory = cache.get(key);
    if (inMemory !== undefined) return { snapshot: inMemory.snapshot, stale: true };
    if (!persist) return undefined;
    const persisted = await input.store?.read(key).catch(() => undefined);
    if (persisted === undefined) return undefined;
    remember(key, persisted);
    return { snapshot: persisted, stale: true };
  }

  return {
    async load(request) {
      const key = request.userIdHash;
      const persist = request.persist !== false;

      const cached = cache.get(key);
      if (!request.force && cached !== undefined && isFresh(cached.at)) {
        return { snapshot: cached.snapshot, stale: false };
      }

      // 采集刚失败过：短时间内直接复用历史快照或如实报错，不再重复全量扫描。
      if (!request.force) {
        const lastFailure = failedAt.get(key);
        if (lastFailure !== undefined && clock().getTime() - lastFailure < failureCooldownMs) {
          const staleResult = await fallback(key, persist);
          if (staleResult !== undefined) return staleResult;
        }
      }

      // 进程重启后第一次进入：先用落盘快照判断是否仍在 TTL 内，避免无谓的全量同步。
      if (!request.force && cached === undefined && persist) {
        const persisted = await input.store?.read(key).catch(() => undefined);
        if (persisted !== undefined) {
          const at = Date.parse(persisted.syncedAt);
          remember(key, persisted);
          if (isFresh(at)) return { snapshot: persisted, stale: false };
        }
      }

      // 并发进入只发一次上游：重复扫描既慢又按账号额度重复计费。
      const running = inFlight.get(key);
      if (running !== undefined) return running;

      const task = (async (): Promise<PersonalArchiveLoad> => {
        // 跨实例单飞：拿不到执行权说明别的实例正在做同一件事，先看历史快照，
        // 没有历史快照时才接下这次扫描，避免把请求直接失败掉。
        if (input.lock !== undefined && !request.force) {
          const acquired = await input.lock.acquire(`archive:${key}`, failureCooldownMs).catch(() => true);
          if (!acquired) {
            const staleResult = await fallback(key, persist);
            if (staleResult !== undefined) return staleResult;
          }
        }
        try {
          const snapshot = await collectPersonalArchive({
            gateway: request.gateway,
            userIdHash: key,
            profile: request.profile,
            limits,
            clock,
          });
          remember(key, snapshot);
          failedAt.delete(key);
          if (persist) await input.store?.write(snapshot).catch(() => undefined);
          return { snapshot, stale: false };
        } catch (error) {
          failedAt.set(key, clock().getTime());
          const staleResult = await fallback(key, persist);
          if (staleResult !== undefined) return staleResult;
          throw error;
        }
      })().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, task);
      return task;
    },
    async clear(userIdHash) {
      cache.delete(userIdHash);
      inFlight.delete(userIdHash);
      failedAt.delete(userIdHash);
      await input.store?.clear(userIdHash).catch(() => undefined);
    },
  };
}

type PageResult<T> = { items: readonly T[]; paging?: Paging; hasMore?: boolean };

/** 分页终止判定：优先用游标；上游说还有更多却给不出游标时，按截断如实上报。 */
function nextOffsetOf<T>(result: PageResult<T>): { next?: number; complete: boolean } {
  const fromPaging = nextOffsetQuery(result.paging);
  if (fromPaging !== undefined) return { next: fromPaging, complete: false };
  if (result.hasMore === true) return { next: undefined, complete: false };
  return { next: undefined, complete: true };
}

async function collectPages<T>(
  load: (offset: number, limit: number) => Promise<PageResult<T>>,
  pageSize: number,
  maxPages: number,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await load(offset, pageSize);
    items.push(...result.items);
    const { next, complete } = nextOffsetOf(result);
    if (complete) return { items, truncated: false };
    if (next === undefined) return { items, truncated: true };
    offset = next;
  }
  return { items, truncated: true };
}

async function collectFavlistContents(
  gateway: UserDataGateway,
  favlists: readonly FavlistItem[],
  limits: PersonalArchiveLimits,
): Promise<{ items: PersonalArchiveCollection[]; truncated: boolean }> {
  const items: CollectedItem[] = [];
  let truncated = favlists.length > limits.maxFavlists;
  for (const favlist of favlists.slice(0, limits.maxFavlists)) {
    const page = await collectPages(
      (offset, limit) => gateway.favlistContents({ favlistUrlToken: favlist.urlToken, limit, offset }),
      limits.pageSize,
      limits.maxFavlistContentPages,
    );
    items.push(...page.items);
    if (page.truncated) truncated = true;
  }
  return { items: dedupeCollected(items), truncated };
}

function toProfile(profile: AuthorizedUserProfile | undefined): PersonalArchiveProfile | undefined {
  if (profile === undefined) return undefined;
  return {
    fullname: profile.fullname,
    avatarUrl: profile.avatarUrl,
    headline: profile.headline,
  };
}

function toCreation(item: CreationItem): PersonalArchiveCreation {
  return {
    id: item.id,
    contentType: item.contentType,
    title: item.title,
    url: item.url,
    createdAt: item.createdAt,
    likeCount: item.likeCount,
    commentCount: item.commentCount,
    favoriteCount: item.favoriteCount,
  };
}

function toFollowee(item: FolloweeItem): PersonalArchiveFollowee {
  return {
    id: item.id,
    name: item.name,
    url: item.url,
    headline: item.headline,
    followerCount: item.followerCount,
    avatarUrl: item.avatarUrl,
  };
}

/** 同一条内容可能同时出现在多个收藏夹；按 Url 收敛为一条，避免重复计数。 */
function dedupeCollected(items: readonly CollectedItem[]): PersonalArchiveCollection[] {
  const merged = new Map<string, PersonalArchiveCollection>();
  for (const item of items) {
    const existing = merged.get(item.url);
    if (existing === undefined) {
      merged.set(item.url, {
        id: item.id,
        contentType: item.contentType,
        title: item.title,
        url: item.url,
        summary: item.summary,
        favlistNames: item.favlistNames,
        authorName: item.authorName,
        favTime: item.favTime,
      });
      continue;
    }
    const names = new Set([...existing.favlistNames, ...item.favlistNames]);
    merged.set(item.url, { ...existing, favlistNames: [...names] });
  }
  return [...merged.values()];
}

function dedupeByUrl<T extends { url: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    result.push(item);
  }
  return result;
}
