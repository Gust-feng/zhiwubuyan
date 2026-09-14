import { asArray, asRecord, readBoolean, readNumber, readOptionalString, readString } from "./json.ts";
import { readPaging, type Paging } from "./paging.ts";
import type { createOpenPlatformClient } from "./client.ts";
import type { RequestIdentity } from "./identity.ts";

export type CollectedItem = {
  id: string;
  kind: "collections" | "favlist_contents";
  contentType?: string;
  title: string;
  url: string;
  summary: string;
  favlistNames: readonly string[];
  authorName?: string;
  favTime?: string;
};

export type CreationItem = {
  id: string;
  kind: "user_contents";
  contentType?: string;
  title: string;
  url: string;
  summary: string;
  createdAt?: string;
  likeCount?: number;
  commentCount?: number;
  favoriteCount?: number;
};

export type FolloweeItem = {
  id: string;
  kind: "followees";
  name: string;
  url: string;
  headline: string;
  followerCount?: number;
  avatarUrl?: string;
};

export type FavlistItem = {
  urlToken: string;
  title: string;
  description: string;
  isPublic: boolean;
  url: string;
};

export type CollectionsResult = {
  kind: "collections";
  fetchedAt: string;
  items: CollectedItem[];
};

export type CreationsResult = {
  kind: "user_contents";
  fetchedAt: string;
  hasMore?: boolean;
  paging?: Paging;
  items: CreationItem[];
};

export type FolloweesResult = {
  kind: "followees";
  fetchedAt: string;
  hasMore?: boolean;
  paging?: Paging;
  items: FolloweeItem[];
};

export type FavlistsResult = {
  kind: "favlists";
  fetchedAt: string;
  items: FavlistItem[];
};

export type FavlistContentsResult = {
  kind: "favlist_contents";
  fetchedAt: string;
  hasMore?: boolean;
  paging?: Paging;
  items: CollectedItem[];
};

/**
 * 用户数据能力门面。所有列表都只返回上游当页数据；翻页由应用层按 `paging`/`hasMore`
 * 驱动，适配层不替调用方决定取多少页，也不吞掉游标。
 * 收藏夹列表与近期收藏按契约没有 `Offset`，不提供分页入参。
 */
export type UserDataGateway = {
  recentCollections(input?: { limit?: number }): Promise<CollectionsResult>;
  myContents(input?: { limit?: number; contentType?: string; offset?: number }): Promise<CreationsResult>;
  followees(input?: { limit?: number; offset?: number }): Promise<FolloweesResult>;
  favlists(input?: { limit?: number }): Promise<FavlistsResult>;
  favlistContents(input: { favlistUrlToken: string; limit?: number; offset?: number }): Promise<FavlistContentsResult>;
};

type Client = ReturnType<typeof createOpenPlatformClient>;

export function createUserDataGateway(
  client: Client,
  identity: RequestIdentity,
  clock: () => Date = () => new Date(),
): UserDataGateway {
  return {
    async recentCollections(input = {}) {
      const envelope = await client.get("/api/v1/user/collections", identity, {
        Limit: clampLimit(input.limit, 10),
      });
      const data = asRecord(envelope.data) ?? {};
      return {
        kind: "collections",
        fetchedAt: clock().toISOString(),
        items: mapCollected(asArray(data.Items), "collections"),
      };
    },
    async myContents(input = {}) {
      const envelope = await client.get("/api/v1/user/contents", identity, {
        ContentType: input.contentType ?? "all",
        Limit: clampLimit(input.limit, 10),
        Offset: readOffset(input.offset),
      });
      const data = asRecord(envelope.data) ?? {};
      return {
        kind: "user_contents",
        fetchedAt: clock().toISOString(),
        hasMore: readBooleanField(data.HasMore),
        paging: readPaging(data.Paging),
        items: mapCreations(asArray(data.Items)),
      };
    },
    async followees(input = {}) {
      const envelope = await client.get("/api/v1/user/followees", identity, {
        Limit: clampLimit(input.limit, 10),
        Offset: readOffset(input.offset),
      });
      const data = asRecord(envelope.data) ?? {};
      return {
        kind: "followees",
        fetchedAt: clock().toISOString(),
        hasMore: readBooleanField(data.HasMore),
        paging: readPaging(data.Paging),
        items: mapFollowees(asArray(data.Items)),
      };
    },
    async favlists(input = {}) {
      const envelope = await client.get("/api/v1/user/favlists", identity, {
        Limit: clampLimit(input.limit, 20),
      });
      const data = asRecord(envelope.data) ?? {};
      const fetchedAt = clock().toISOString();
      return {
        kind: "favlists",
        fetchedAt,
        items: mapFavlists(asArray(data.Items)),
      };
    },
    async favlistContents(input) {
      const envelope = await client.get("/api/v1/user/favlist_contents", identity, {
        FavlistUrlToken: input.favlistUrlToken,
        Limit: clampLimit(input.limit, 20),
        Offset: readOffset(input.offset),
      });
      const data = asRecord(envelope.data) ?? {};
      const fetchedAt = clock().toISOString();
      return {
        kind: "favlist_contents",
        fetchedAt,
        hasMore: readBooleanField(data.HasMore),
        paging: readPaging(data.Paging),
        items: mapCollected(asArray(data.Items), "favlist_contents"),
      };
    },
  };
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || limit <= 0) return fallback;
  return Math.min(limit, 50);
}

/** 偏移量只接受非负安全整数；非法值按 0 处理，不把畸形游标透传给上游。 */
function readOffset(offset: number | undefined): number | undefined {
  if (offset === undefined) return undefined;
  if (!Number.isSafeInteger(offset) || offset < 0) return undefined;
  return offset;
}

function readBooleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function fromSeconds(value: unknown): string | undefined {
  const seconds = readNumber(value);
  if (seconds === undefined || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function mapCollected(items: unknown[], kind: "collections" | "favlist_contents"): CollectedItem[] {
  return items.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = readString(record.Title).trim();
    const url = readString(record.Url).trim();
    if (!title || !url) return [];
    return [{
      id: `${kind}:${index + 1}`,
      kind,
      contentType: readOptionalString(record.ContentType),
      title,
      url,
      summary: readString(record.Summary),
      favlistNames: readFavlistNames(record.Favlists),
      authorName: readAuthorName(record.Author),
      // 收藏时间缺失就保持缺省：用抓取时间回填会把旧收藏显示成「刚收藏」，污染时间线判断。
      favTime: fromSeconds(record.FavTime),
    }];
  });
}

function readFavlistNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const raw of value) {
    const record = asRecord(raw);
    if (!record) continue;
    const title = readString(record.Title).trim();
    if (title !== "") names.push(title);
  }
  return names;
}

function readAuthorName(value: unknown): string | undefined {
  const record = asRecord(value);
  return record === undefined ? undefined : readOptionalString(record.Name);
}

function mapCreations(items: unknown[]): CreationItem[] {
  return items.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = readString(record.Title).trim();
    const url = readString(record.Url).trim();
    if (!title || !url) return [];
    return [{
      id: `user_contents:${index + 1}`,
      kind: "user_contents" as const,
      contentType: readOptionalString(record.ContentType),
      title,
      url,
      summary: readString(record.Summary),
      createdAt: fromSeconds(record.CreatedAt),
      likeCount: readNumber(record.LikeCount),
      commentCount: readNumber(record.CommentCount),
      favoriteCount: readNumber(record.FavoriteCount),
    }];
  });
}

function mapFollowees(items: unknown[]): FolloweeItem[] {
  return items.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const name = readString(record.Fullname).trim();
    const url = readString(record.Url).trim();
    if (!name || !url) return [];
    return [{
      id: `followees:${readOptionalString(record.UrlToken) ?? String(index + 1)}`,
      kind: "followees" as const,
      name,
      url,
      headline: decodeHtmlEntities(readString(record.Headline)),
      followerCount: readNumber(record.FollowerCount),
      avatarUrl: readOptionalString(record.AvatarUrl),
    }];
  });
}

/** 收藏夹列表用 `UrlToken` 关联夹内内容；缺失标识的条目无法继续查询，按不可用丢弃。 */
function mapFavlists(items: unknown[]): FavlistItem[] {
  return items.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const urlToken = readString(record.UrlToken).trim();
    const title = readString(record.Title).trim();
    if (!urlToken || !title) return [];
    return [{
      urlToken,
      title,
      description: readString(record.Description),
      isPublic: readBoolean(record.IsPublic),
      url: readString(record.Url),
    }];
  });
}

const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (match) => NAMED_HTML_ENTITIES[match] ?? match);
}
