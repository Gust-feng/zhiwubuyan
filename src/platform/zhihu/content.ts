import { ProductError } from "./errors.ts";
import { asArray, asRecord, readNumber, readOptionalString, readString } from "./json.ts";
import type { createOpenPlatformClient } from "./client.ts";
import type { RequestIdentity } from "./identity.ts";
import { readPaging, type Paging } from "./paging.ts";
import { questionIdFromZhihuUrl } from "./urls.ts";

export type ContentSourceKind = "zhihu_search" | "global_search" | "hot_list" | "question_answers";

export type ContentSource = {
  id: string;
  kind: ContentSourceKind;
  title: string;
  url: string;
  summary: string;
  authorName?: string;
  contentType?: string;
  contentId?: string;
  /** 该来源所属的知乎问题 ID；回答链接里嵌的问题段解析而来，解析不出则不设。 */
  questionId?: string;
  thumbnailUrl?: string;
  voteCount?: number;
  commentCount?: number;
  authorityLevel?: string;
  /** 上游真实元数据：头像、认证图标/文案、排序分、秒级 EditTime 与精选评论。 */
  authorAvatarUrl?: string;
  authorBadgeIconUrl?: string;
  authorBadgeText?: string;
  rankingScore?: number;
  /** EditTime 的 Unix 秒时间戳；上游语义兼有发布与最后更新，不猜测区分。 */
  editTimeSeconds?: number;
  selectedComments?: string[];
  fetchedAt: string;
};

export type SearchResult = {
  kind: ContentSourceKind;
  query?: string;
  fetchedAt: string;
  emptyReason?: string;
  hasMore?: boolean;
  searchHashId?: string;
  paging?: Paging;
  items: ContentSource[];
};

export type ContentGateway = {
  searchZhihu(input: { query: string; count?: number; signal?: AbortSignal }): Promise<SearchResult>;
  searchGlobal(input: {
    query: string;
    count?: number;
    searchDb?: string;
    filter?: string;
    signal?: AbortSignal;
  }): Promise<SearchResult>;
  listHotContent(input?: { limit?: number }): Promise<SearchResult>;
  /**
   * 读取指定知乎问题下的回答。上游只返回内容摘要、类型、链接与内容 token，
   * 不提供作者与互动数；问题标题由调用方带入，用于标记这些说法的来路。
   */
  listQuestionAnswers(input: {
    questionId: string;
    questionTitle?: string;
    count?: number;
    signal?: AbortSignal;
  }): Promise<SearchResult>;
};

type Client = ReturnType<typeof createOpenPlatformClient>;

export function createContentGateway(
  client: Client,
  identity: RequestIdentity,
  clock: () => Date = () => new Date(),
): ContentGateway {
  return {
    async searchZhihu(input) {
      const query = requireQuery(input.query);
      const envelope = await client.get("/api/v1/content/zhihu_search", identity, {
        Query: query,
        Count: clampCount(input.count, 10),
      }, input.signal);
      const data = asRecord(envelope.data) ?? {};
      const fetchedAt = clock().toISOString();
      return {
        kind: "zhihu_search",
        query,
        fetchedAt,
        emptyReason: readOptionalString(data.EmptyReason),
        hasMore: typeof data.HasMore === "boolean" ? data.HasMore : undefined,
        searchHashId: readOptionalString(data.SearchHashId),
        paging: readPaging(data.Paging),
        items: mapSearchItems(asArray(data.Items), "zhihu_search", fetchedAt),
      };
    },
    async searchGlobal(input) {
      const query = requireQuery(input.query);
      const envelope = await client.get("/api/v1/content/global_search", identity, {
        Query: query,
        Count: clampCount(input.count, 20),
        SearchDB: input.searchDb,
        Filter: input.filter,
      }, input.signal);
      const data = asRecord(envelope.data) ?? {};
      const fetchedAt = clock().toISOString();
      return {
        kind: "global_search",
        query,
        fetchedAt,
        hasMore: typeof data.HasMore === "boolean" ? data.HasMore : undefined,
        paging: readPaging(data.Paging),
        items: mapSearchItems(asArray(data.Items), "global_search", fetchedAt),
      };
    },
    async listHotContent(input = {}) {
      const envelope = await client.get("/api/v1/content/hot_list", identity, {
        Limit: clampHotLimit(input.limit),
      });
      const data = asRecord(envelope.data) ?? {};
      const fetchedAt = clock().toISOString();
      return {
        kind: "hot_list",
        fetchedAt,
        items: mapHotItems(asArray(data.Items), fetchedAt),
      };
    },
    async listQuestionAnswers(input) {
      const questionId = requireQuestionId(input.questionId);
      const envelope = await client.get("/api/v1/content/question_answers", identity, {
        QuestionUrl: `https://www.zhihu.com/question/${questionId}`,
        Limit: clampAnswerLimit(input.count),
      }, input.signal);
      const data = asRecord(envelope.data) ?? {};
      const fetchedAt = clock().toISOString();
      return {
        kind: "question_answers",
        fetchedAt,
        paging: readPaging(data.Paging),
        items: mapAnswerItems(asArray(data.Items), fetchedAt, questionId, input.questionTitle),
      };
    },
  };
}

function requireQuery(query: string): string {
  const value = query.trim();
  if (!value) {
    throw new ProductError("INVALID_INPUT", "检索词不能为空。");
  }
  return value;
}

function clampCount(count: number | undefined, max: number): number {
  if (count === undefined || count <= 0) return Math.min(10, max);
  return Math.min(count, max);
}

function clampHotLimit(limit: number | undefined): number {
  if (limit === undefined || limit <= 0 || limit > 30) return 30;
  return limit;
}

function requireQuestionId(questionId: string): string {
  const value = questionId.trim();
  if (!/^\d+$/.test(value)) {
    throw new ProductError("INVALID_INPUT", "知乎问题 ID 必须是纯数字。");
  }
  return value;
}

/** 上游问题回答单页上限 50，默认取 30 条，既够形成立场也不过度消耗额度。 */
function clampAnswerLimit(count: number | undefined): number {
  if (count === undefined || count <= 0) return 30;
  return Math.min(count, 50);
}

function mapSearchItems(items: unknown[], kind: ContentSourceKind, fetchedAt: string): ContentSource[] {
  return items.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = readString(record.Title).trim();
    const url = readString(record.Url).trim();
    if (!title || !url) return [];
    const contentId = readOptionalString(record.ContentID);
    const editTime = readNumber(record.EditTime);
    return [{
      id: `${kind}:${contentId ?? String(index)}`,
      kind,
      title,
      url,
      summary: stripHighlight(readString(record.ContentText)),
      authorName: readOptionalString(record.AuthorName),
      contentType: readOptionalString(record.ContentType),
      contentId,
      questionId: questionIdFromZhihuUrl(url),
      voteCount: readNumber(record.VoteUpCount),
      commentCount: readNumber(record.CommentCount),
      authorityLevel: readOptionalString(record.AuthorityLevel),
      authorAvatarUrl: readOptionalString(record.AuthorAvatar),
      authorBadgeIconUrl: readOptionalString(record.AuthorBadge),
      authorBadgeText: readOptionalString(record.AuthorBadgeText),
      rankingScore: readNumber(record.RankingScore),
      editTimeSeconds: editTime !== undefined && Number.isInteger(editTime) && editTime > 0 ? editTime : undefined,
      selectedComments: asArray(record.CommentInfoList).flatMap((comment) => {
        const text = readString(asRecord(comment)?.Content).trim();
        return text ? [text] : [];
      }),
      fetchedAt,
    }];
  });
}

function mapHotItems(items: unknown[], fetchedAt: string): ContentSource[] {
  return items.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = readString(record.Title).trim();
    const url = readString(record.Url).trim();
    if (!title || !url) return [];
    return [{
      id: `hot_list:${index + 1}`,
      kind: "hot_list",
      title,
      url,
      summary: readString(record.Summary),
      thumbnailUrl: readOptionalString(record.ThumbnailUrl),
      fetchedAt,
    }];
  });
}

function stripHighlight(text: string): string {
  return text.replace(/<\/?em>/g, "");
}

/**
 * 问题下的回答：上游只给内容 token、摘要、链接与类型，没有标题、作者和互动数。
 * 回答本身没有标题，用问题标题标明来路；摘要为空或链接无效的条目不进入结果。
 */
function mapAnswerItems(
  items: unknown[],
  fetchedAt: string,
  questionId: string,
  questionTitle?: string,
): ContentSource[] {
  const label = questionTitle?.trim();
  return items.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const url = readString(record.Url).trim();
    const summary = readString(record.Summary).trim();
    if (!url || !summary) return [];
    const token = readOptionalString(record.ContentToken);
    return [{
      id: `question_answers:${token ?? `${questionId}-${index + 1}`}`,
      kind: "question_answers" as const,
      title: label && label !== "" ? label : "知乎回答",
      url,
      summary,
      contentType: readOptionalString(record.ContentType),
      contentId: token,
      questionId,
      fetchedAt,
    }];
  });
}

