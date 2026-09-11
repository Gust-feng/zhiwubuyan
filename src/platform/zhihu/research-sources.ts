import { createHash } from "node:crypto";
import type { ResearchSource } from "../../contracts/research.ts";

/** 上游搜索结果的最小形状（知乎与全网通用）。 */
export type UpstreamSearchItem = {
  title: string;
  url: string;
  summary: string;
  authorName?: string;
  contentType?: string;
  contentId?: string;
  authorAvatarUrl?: string;
  authorBadgeIconUrl?: string;
  authorBadgeText?: string;
  rankingScore?: number;
  editTimeSeconds?: number;
  selectedComments?: string[];
  voteCount?: number;
  commentCount?: number;
  authorityLevel?: string;
  fetchedAt: string;
};

export type SourceDraftResult =
  | { kind: "accepted"; source: ResearchSource }
  | { kind: "discarded"; reason: string };

/**
 * 把上游搜索结果映射为可引用的研究来源快照。
 * 缺少稳定身份或可打开 URL 的结果不进入证据，返回剔除原因。
 * 身份规则：知乎为规范化小写内容类型 + ContentID；全网为规范化 URL。
 * 不同昵称不证明作者独立；高赞与排序分只作排序辅因。
 */
export function toResearchSourceDraft(input: {
  item: UpstreamSearchItem;
  taskId: string;
  channel: "zhihu" | "web";
}): SourceDraftResult {
  const { item, taskId, channel } = input;
  const text = item.summary.replace(/\r\n/g, "\n").trim();
  const title = item.title.trim();
  const url = item.url.trim();
  if (!title) return { kind: "discarded", reason: "missing_title" };
  if (!url || !/^https?:\/\//i.test(url)) return { kind: "discarded", reason: "missing_url" };
  if (!text) return { kind: "discarded", reason: "missing_summary" };

  const identity =
    channel === "zhihu"
      ? zhihuIdentity(item)
      : canonicalUrl(url);
  if (!identity) return { kind: "discarded", reason: "missing_identity" };

  const canonical = canonicalUrl(url);
  if (!canonical) return { kind: "discarded", reason: "missing_identity" };

  const sourceTime = item.editTimeSeconds !== undefined
    ? new Date(item.editTimeSeconds * 1000).toISOString()
    : null;
  const badges = item.authorBadgeText?.trim() ? [item.authorBadgeText.trim()] : [];
  const authorName = item.authorName?.trim();
  const source: ResearchSource = {
    id: "",
    taskId,
    channel,
    identity,
    textHash: sha256Hex(text),
    title,
    url,
    canonicalUrl: canonical,
    text,
    contentExtent: "summary",
    author: authorName
      ? {
          name: authorName,
          avatarUrl: item.authorAvatarUrl?.trim() || null,
          badgeIconUrl: item.authorBadgeIconUrl?.trim() || null,
          badges,
        }
      : null,
    sourceTime,
    timeKind: sourceTime ? "published_or_updated" : "unknown",
    retrievedAt: item.fetchedAt,
    metadata: {
      contentType: item.contentType?.trim() || null,
      contentId: item.contentId?.trim() || null,
      voteCount: item.voteCount ?? null,
      commentCount: item.commentCount ?? null,
      authorityLevel: item.authorityLevel?.trim() || null,
      rankingScore: item.rankingScore ?? null,
      selectedComments: (item.selectedComments ?? []).slice(0, 10).map((text) => ({ text })),
    },
  };
  return { kind: "accepted", source };
}

function zhihuIdentity(item: UpstreamSearchItem): string | null {
  const contentType = item.contentType?.trim().toLowerCase();
  const contentId = item.contentId?.trim();
  if (!contentType || !contentId || !/^\d+$/.test(contentId)) return null;
  return `${contentType}:${contentId}`;
}

/**
 * 规范化 URL 仅用于去重：小写协议与主机、去 hash 与 utm 参数；
 * 原始 url 字段保留完整溯源参数。
 */
export function canonicalUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
