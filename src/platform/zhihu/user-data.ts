import { asArray, asRecord, readNumber, readOptionalString, readString } from "./json.ts";
import type { createOpenPlatformClient } from "./client.ts";
import type { RequestIdentity } from "./identity.ts";

export type CollectedItem = {
  id: string;
  kind: "collections";
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

export type CollectionsResult = {
  kind: "collections";
  fetchedAt: string;
  items: CollectedItem[];
};

export type CreationsResult = {
  kind: "user_contents";
  fetchedAt: string;
  hasMore?: boolean;
  items: CreationItem[];
};

export type FolloweesResult = {
  kind: "followees";
  fetchedAt: string;
  hasMore?: boolean;
  items: FolloweeItem[];
};

export type RecommendedQuestion = {
  id: string;
  kind: "question_recommendations";
  title: string;
  url: string;
};

export type QuestionRecommendationsResult = {
  kind: "question_recommendations";
  fetchedAt: string;
  items: RecommendedQuestion[];
};

export type UserDataGateway = {
  recentCollections(input?: { limit?: number }): Promise<CollectionsResult>;
  myContents(input?: { limit?: number; contentType?: string }): Promise<CreationsResult>;
  followees(input?: { limit?: number }): Promise<FolloweesResult>;
  questionRecommendations(input?: { count?: number }): Promise<QuestionRecommendationsResult>;
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
      const fetchedAt = clock().toISOString();
      return {
        kind: "collections",
        fetchedAt,
        items: mapCollected(asArray(data.Items), fetchedAt),
      };
    },
    async myContents(input = {}) {
      const envelope = await client.get("/api/v1/user/contents", identity, {
        ContentType: input.contentType ?? "all",
        Limit: clampLimit(input.limit, 10),
      });
      const data = asRecord(envelope.data) ?? {};
      const fetchedAt = clock().toISOString();
      return {
        kind: "user_contents",
        fetchedAt,
        hasMore: readBooleanField(data.HasMore),
        items: mapCreations(asArray(data.Items), fetchedAt),
      };
    },
    async followees(input = {}) {
      const envelope = await client.get("/api/v1/user/followees", identity, {
        Limit: clampLimit(input.limit, 10),
      });
      const data = asRecord(envelope.data) ?? {};
      const fetchedAt = clock().toISOString();
      return {
        kind: "followees",
        fetchedAt,
        hasMore: readBooleanField(data.HasMore),
        items: mapFollowees(asArray(data.Items), fetchedAt),
      };
    },
    // 问题推荐与收藏等用户数据同一套 Bearer 鉴权；额度在 creator 创作能力组（默认每日 100 次），
    // 所以这里只按面板需要的条数请求，不做翻页。
    async questionRecommendations(input = {}) {
      const envelope = await client.get("/api/v1/user/question_recommendations", identity, {
        Count: clampLimit(input.count, 10),
      });
      const data = asRecord(envelope.data) ?? {};
      const fetchedAt = clock().toISOString();
      return {
        kind: "question_recommendations",
        fetchedAt,
        items: mapRecommendedQuestions(asArray(data.Items), fetchedAt),
      };
    },
  };
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || limit <= 0) return fallback;
  return Math.min(limit, 50);
}

function readBooleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function fromSeconds(value: unknown): string | undefined {
  const seconds = readNumber(value);
  if (seconds === undefined || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function mapCollected(items: unknown[], fetchedAt: string): CollectedItem[] {
  return items.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = readString(record.Title).trim();
    const url = readString(record.Url).trim();
    if (!title || !url) return [];
    return [{
      id: `collections:${index + 1}`,
      kind: "collections" as const,
      contentType: readOptionalString(record.ContentType),
      title,
      url,
      summary: readString(record.Summary),
      favlistNames: readFavlistNames(record.Favlists),
      authorName: readAuthorName(record.Author),
      favTime: fromSeconds(record.FavTime) ?? fetchedAt,
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

function mapCreations(items: unknown[], fetchedAt: string): CreationItem[] {
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
      createdAt: fromSeconds(record.CreatedAt) ?? fetchedAt,
      likeCount: readNumber(record.LikeCount),
      commentCount: readNumber(record.CommentCount),
      favoriteCount: readNumber(record.FavoriteCount),
    }];
  });
}

function mapFollowees(items: unknown[], fetchedAt: string): FolloweeItem[] {
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
      headline: readString(record.Headline),
      followerCount: readNumber(record.FollowerCount),
      avatarUrl: readOptionalString(record.AvatarUrl),
    }];
  });
}

function mapRecommendedQuestions(items: unknown[], fetchedAt: string): RecommendedQuestion[] {
  return items.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = readString(record.Title).trim();
    const url = readString(record.Url).trim();
    if (!title || !url) return [];
    return [{
      id: `question_recommendations:${index + 1}`,
      kind: "question_recommendations" as const,
      title,
      url,
    }];
  });
}
