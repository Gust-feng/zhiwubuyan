import { ProductError } from "../platform/zhihu/errors.ts";
import { COMMUNITY_RINGS, readCommunityRing } from "../platform/zhihu/community.ts";
import type {
  CommunityComment,
  CommunityContent,
  CommunityGateway,
  StoryDetail as PlatformStoryDetail,
  StorySummary as PlatformStorySummary,
} from "../platform/zhihu/community.ts";

/** 单个圈子一次可读取的条数上限，与上游 page_size 上限一致。 */
const PAGE_SIZE_MAX = 50;
const PAGE_SIZE_DEFAULT = 20;
/** 正文展示长度上限：只截断展示，不改变上游返回，超出时由界面如实说明是节选。 */
const POST_LENGTH = 2000;
const STORY_LENGTH = 3000;

export type CircleSummary = {
  readonly id: string;
  readonly name: string;
};

export type CircleRing = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly avatarUrl: string;
  readonly membershipCount?: number;
  readonly discussionCount?: number;
};

export type CircleComment = {
  readonly id: string;
  readonly content: string;
  readonly authorName: string;
  readonly likeCount?: number;
  readonly replyCount?: number;
  readonly publishedAt?: string;
};

export type CirclePost = {
  readonly id: string;
  /** 帖子自己的标题；上游经常留空，此时从正文首段分离而来，分离不出则不设。 */
  readonly title?: string;
  readonly content: string;
  /** 正文是否被截断；为 true 时界面必须说明这是节选。 */
  readonly truncated: boolean;
  readonly authorName: string;
  readonly imageUrls: readonly string[];
  readonly publishedAt?: string;
  /** 互动数只作中性元信息展示，不作为内容为真的依据。 */
  readonly likeCount?: number;
  readonly commentCount?: number;
  readonly favoriteCount?: number;
  readonly shareCount?: number;
  readonly comments: readonly CircleComment[];
};

export type CircleFeed = {
  readonly ring: CircleRing;
  readonly posts: readonly CirclePost[];
  readonly page: number;
  readonly fetchedAt: string;
};

export type CircleStory = {
  readonly workId: string;
  readonly title: string;
  readonly artworkUrl?: string;
  readonly tabArtworkUrl?: string;
  readonly description?: string;
  readonly labels: readonly string[];
};

export type CircleStoryDetail = {
  readonly workId: string;
  readonly chapterName?: string;
  readonly authorName?: string;
  readonly labels: readonly string[];
  readonly introduction?: string;
  readonly content: string;
  /** 上游对故事正文有长度上限（最多 3000 字），界面据此说明这是节选而非全文。 */
  readonly truncated: boolean;
};

export type ReadCircleInput = {
  ringId: string;
  page?: number;
  pageSize?: number;
};

export type ReadStoryInput = {
  workId: string;
};

/**
 * 圈子社区的只读应用命令：把社区 API 的原始响应整理成产品 DTO。
 * 上游正文是 HTML，一律在此转成纯文本，界面不接收、不执行任何上游标记。
 * 写操作（发布/评论/点赞）不在本命令范围内：它们有公开外发副作用，必须由用户显式触发。
 */
export function createCirclesCommand(input: {
  community: CommunityGateway;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());

  return {
    /** 白名单圈子列表；名称与顺序来自平台适配层，不额外请求上游。 */
    listRings(): readonly CircleSummary[] {
      return COMMUNITY_RINGS.map((ring) => ({ id: ring.id, name: ring.name }));
    },

    async readRing(request: ReadCircleInput): Promise<CircleFeed> {
      const ring = readCommunityRing(request.ringId.trim());
      if (!ring) throw new ProductError("INVALID_INPUT", "这个圈子不在可访问范围内。");
      const detail = await input.community.ringDetail({
        ringId: ring.id,
        pageSize: clampPageSize(request.pageSize),
        pageNum: clampPage(request.page),
      });
      return {
        ring: mapRing(ring.id, ring.name, detail.ring),
        posts: detail.contents.flatMap(mapPost),
        page: clampPage(request.page),
        fetchedAt: clock().toISOString(),
      };
    },

    async listStories(): Promise<readonly CircleStory[]> {
      const stories = await input.community.listStories();
      return stories.map(mapStory);
    },

    async readStory(request: ReadStoryInput): Promise<CircleStoryDetail> {
      const workId = request.workId.trim();
      if (!/^\d+$/.test(workId)) throw new ProductError("INVALID_INPUT", "故事 ID 必须是纯数字。");
      const detail = await input.community.storyDetail({ workId });
      return mapStoryDetail(detail);
    },
  };
}

function clampPageSize(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size) || size <= 0) return PAGE_SIZE_DEFAULT;
  return Math.min(Math.floor(size), PAGE_SIZE_MAX);
}

function clampPage(page: number | undefined): number {
  if (page === undefined || !Number.isFinite(page) || page <= 0) return 1;
  return Math.floor(page);
}

function mapRing(id: string, fallbackName: string, ring: { name: string; description: string; avatarUrl: string; membershipCount?: number; discussionCount?: number }): CircleRing {
  return {
    id,
    // 上游名称缺失时回落到平台侧的圈子名，避免界面出现空标题。
    name: ring.name.trim() === "" ? fallbackName : ring.name,
    description: ring.description,
    avatarUrl: ring.avatarUrl,
    membershipCount: ring.membershipCount,
    discussionCount: ring.discussionCount,
  };
}

function mapPost(content: CommunityContent): CirclePost[] {
  const id = content.pinId.trim();
  if (id === "") return [];
  const raw = htmlToText(content.content);
  const { title, body } = splitTitle(content.title, raw);
  // 既无正文又无配图的帖子不进入列表，避免出现只有作者名的空条目。
  if (body === "" && content.imageUrls.length === 0) return [];
  const truncated = body.length > POST_LENGTH;
  return [{
    id,
    title,
    content: truncated ? body.slice(0, POST_LENGTH) : body,
    truncated,
    authorName: content.authorName,
    imageUrls: content.imageUrls,
    publishedAt: content.publishedAt,
    likeCount: content.likeCount,
    commentCount: content.commentCount,
    favoriteCount: content.favoriteCount,
    shareCount: content.shareCount,
    comments: content.comments.flatMap(mapComment),
  }];
}

function mapComment(comment: CommunityComment): CircleComment[] {
  const id = comment.commentId.trim();
  if (id === "") return [];
  const content = htmlToText(comment.content);
  if (content === "") return [];
  return [{
    id,
    content,
    authorName: comment.authorName,
    likeCount: comment.likeCount,
    replyCount: comment.replyCount,
    publishedAt: comment.publishedAt,
  }];
}

function mapStory(story: PlatformStorySummary): CircleStory {
  return {
    workId: story.workId,
    title: story.title,
    artworkUrl: story.artworkUrl,
    tabArtworkUrl: story.tabArtworkUrl,
    description: story.description,
    labels: story.labels,
  };
}

function mapStoryDetail(detail: PlatformStoryDetail): CircleStoryDetail {
  const content = normalizeParagraphs(detail.content);
  return {
    workId: detail.workId,
    chapterName: detail.chapterName,
    authorName: detail.authorName,
    labels: detail.labels,
    introduction: detail.introduction,
    content,
    truncated: content.length >= STORY_LENGTH,
  };
}

/**
 * 上游圈子内容的正文是 HTML。这里只做展示所需的纯文本化：段落到换行、去掉标记、解码基础实体。
 * 任何上游标记都不会进入产品界面，也不会被当作可执行内容。
 */
function htmlToText(html: string): string {
  if (html === "") return "";
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|h[1-6]|tr)>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]*>/g, "");
  return normalizeParagraphs(decodeEntities(withoutTags));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, code: string) => safeCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&hellip;/gi, "…")
    // &amp; 必须最后解码，否则 &amp;lt; 会被二次解码成 < 。
    .replace(/&amp;/gi, "&");
}

function safeCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function normalizeParagraphs(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 上游常常把标题并进正文，形如「标题 | 正文」。标题字段本身有值时直接使用；
 * 为空时才尝试从正文首段分离，且只在首个标记之前、长度合理时才认作标题，分离不出就不设。
 */
function splitTitle(rawTitle: string | undefined, body: string): { title?: string; body: string } {
  const title = rawTitle?.trim() ?? "";
  if (title !== "") return { title, body };
  const separator = body.indexOf(" | ");
  if (separator <= 0 || separator > 60) return { body };
  const head = body.slice(0, separator).trim();
  const rest = body.slice(separator + 3).trim();
  if (head === "" || rest === "" || head.includes("\n")) return { body };
  return { title: head, body: rest };
}
