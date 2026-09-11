/**
 * 知乎内容 URL 的身份解析。
 *
 * 众声要把一个议题落到真实的知乎问题上：搜索结果里的回答链接形如
 * `https://www.zhihu.com/question/{问题ID}/answer/{回答ID}`，问题 ID 嵌在路径里。
 * 这里只解析路径，不猜测、不构造 URL；解析失败返回 undefined，由调用方如实降级。
 */

const ZHIHU_HOSTS = new Set(["zhihu.com", "www.zhihu.com"]);

function zhihuPathSegments(rawUrl: string): string[] | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (!ZHIHU_HOSTS.has(url.hostname.toLowerCase())) return undefined;
  return url.pathname.split("/").filter((segment) => segment !== "");
}

function numericSegment(segment: string | undefined): string | undefined {
  return segment !== undefined && /^\d+$/.test(segment) ? segment : undefined;
}

/** 取知乎问题 ID：问题页 `/question/{id}` 与问题下的回答页都能取到，其它形态返回 undefined。 */
export function questionIdFromZhihuUrl(rawUrl: string): string | undefined {
  const segments = zhihuPathSegments(rawUrl);
  if (segments === undefined || segments[0] !== "question") return undefined;
  return numericSegment(segments[1]);
}

/** 取知乎回答 ID：接受 `/question/{qid}/answer/{aid}` 与独立 `/answer/{aid}` 两种真实形态。 */
export function answerIdFromZhihuUrl(rawUrl: string): string | undefined {
  const segments = zhihuPathSegments(rawUrl);
  if (segments === undefined) return undefined;
  if (segments[0] === "question" && segments[2] === "answer") return numericSegment(segments[3]);
  if (segments[0] === "answer") return numericSegment(segments[1]);
  return undefined;
}

/** 问题页链接，用于「该问题下的回答」来源的原文入口。 */
export function questionUrl(questionId: string): string {
  return `https://www.zhihu.com/question/${questionId}`;
}
