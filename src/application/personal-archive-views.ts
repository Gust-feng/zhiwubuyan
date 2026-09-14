import type {
  PersonalArchiveCollection,
  PersonalArchiveCreation,
  PersonalArchiveFollowee,
  PersonalArchiveSnapshot,
} from "./personal-archive.ts";

/**
 * 个人档案的组装层：把一份快照派生为可展示的视图。
 *
 * 这一层是纯函数——不读文件、不发请求、不调模型，只做集合运算、时间分桶、URL 解析和字符串统计。
 * 每个视图的措辞都对应一种可验证的规则，而不是对用户内容的判断：这里是「同题」「比例」「天数」
 * 「粉丝数分层」「关键词命中」，不是「立场」「质量」或「画像」。
 */

/** 短链形态的知乎问题 URL 都是 `/question/{数字ID}`；抽不出 ID 的内容不参与同题聚合。 */
const QUESTION_PATH = /\/question\/(\d+)/;

export function questionIdFromUrl(url: string): string | undefined {
  return QUESTION_PATH.exec(url)?.[1];
}

export type QuestionClusterItem = {
  title: string;
  url: string;
  kind: "creation" | "collection";
  contentType?: string;
  createdAt?: string;
  favTime?: string;
  likeCount?: number;
  commentCount?: number;
  favoriteCount?: number;
};

export type QuestionCluster = {
  questionId: string;
  questionUrl: string;
  creationCount: number;
  collectionCount: number;
  total: number;
  items: readonly QuestionClusterItem[];
};

/**
 * 同题聚合：找出「同一个问题下你既写过又收藏过」的内容簇。
 * 只保留同题条目 ≥ 2 的组——单条内容没有「聚合」可言，列出来只是重复原有列表。
 */
export function buildQuestionClusters(
  input: { creations: readonly PersonalArchiveCreation[]; collections: readonly PersonalArchiveCollection[] },
  options: { minItems?: number } = {},
): QuestionCluster[] {
  const minItems = options.minItems ?? 2;
  const groups = new Map<string, QuestionClusterItem[]>();

  for (const creation of input.creations) {
    const questionId = questionIdFromUrl(creation.url);
    if (questionId === undefined) continue;
    push(groups, questionId, {
      title: creation.title,
      url: creation.url,
      kind: "creation",
      contentType: creation.contentType,
      createdAt: creation.createdAt,
      likeCount: creation.likeCount,
      commentCount: creation.commentCount,
      favoriteCount: creation.favoriteCount,
    });
  }
  for (const collection of input.collections) {
    const questionId = questionIdFromUrl(collection.url);
    if (questionId === undefined) continue;
    push(groups, questionId, {
      title: collection.title,
      url: collection.url,
      kind: "collection",
      contentType: collection.contentType,
      favTime: collection.favTime,
    });
  }

  const clusters: QuestionCluster[] = [];
  for (const [questionId, items] of groups) {
    if (items.length < minItems) continue;
    // 同一篇内容可能同时被写过又收藏；按 URL 去重后再计数，避免把一条内容算两次。
    const unique = dedupeByUrl(items);
    if (unique.length < minItems) continue;
    clusters.push({
      questionId,
      questionUrl: `https://www.zhihu.com/question/${questionId}`,
      creationCount: unique.filter((item) => item.kind === "creation").length,
      collectionCount: unique.filter((item) => item.kind === "collection").length,
      total: unique.length,
      items: unique,
    });
  }
  return clusters.sort((a, b) => b.total - a.total || a.questionId.localeCompare(b.questionId));
}

function push<T>(groups: Map<string, T[]>, key: string, item: T): void {
  const bucket = groups.get(key);
  if (bucket === undefined) groups.set(key, [item]);
  else bucket.push(item);
}

export type CreationDayBucket = {
  date: string;
  count: number;
  byType: Readonly<Record<string, number>>;
};

export type CreationYearView = {
  /**
   * 可视化窗口内的连续日期（含没有创作的零值日）。
   * 只输出有创作的日期会让相邻格子被误读成连续两天，进而把创作节奏画得比真实更密。
   */
  buckets: readonly CreationDayBucket[];
  total: number;
  activeDays: number;
  /** 从最近一个有创作的日子往回数的连续天数。 */
  streakDays: number;
  longestStreak: number;
  firstDate?: string;
  lastDate?: string;
  /** 可视化窗口起点；窗口固定为最近一年，超出部分只进统计、不入图。 */
  windowStart?: string;
  /** 窗口起点是星期几（0=周日），供日历按周对齐。 */
  windowWeekday?: number;
};

/** 可视化窗口长度：超出后只保留最近一年，避免长历史把图拉成一条细线。 */
const CREATION_WINDOW_DAYS = 365;

/**
 * 创作年轮：按天分桶出日历热力图与连续创作天数。
 * 日期取 ISO 字符串的 UTC 日部分——跨时区的用户看到的「天」可能与本地日历差一天，
 * 因此这里只用于呈现节奏，不作为任何精确到日的结论。
 */
export function buildCreationYear(creations: readonly PersonalArchiveCreation[]): CreationYearView {
  const byDate = new Map<string, { count: number; byType: Map<string, number> }>();
  for (const creation of creations) {
    const date = dayOf(creation.createdAt);
    if (date === undefined) continue;
    const bucket = byDate.get(date) ?? { count: 0, byType: new Map<string, number>() };
    bucket.count += 1;
    const type = creation.contentType ?? "unknown";
    bucket.byType.set(type, (bucket.byType.get(type) ?? 0) + 1);
    byDate.set(date, bucket);
  }

  const dates = [...byDate.keys()].sort();
  const lastDate = dates[dates.length - 1];
  const windowStart = lastDate === undefined ? undefined : addDays(lastDate, -(CREATION_WINDOW_DAYS - 1));

  const buckets: CreationDayBucket[] = [];
  if (windowStart !== undefined && lastDate !== undefined) {
    for (let day = dayNumber(windowStart); day <= dayNumber(lastDate); day += 1) {
      const date = fromDayNumber(day);
      const bucket = byDate.get(date);
      buckets.push({
        date,
        count: bucket?.count ?? 0,
        byType: bucket === undefined
          ? {}
          : Object.fromEntries([...bucket.byType.entries()].sort(([a], [b]) => a.localeCompare(b))),
      });
    }
  }

  return {
    buckets,
    total: [...byDate.values()].reduce((sum, bucket) => sum + bucket.count, 0),
    activeDays: dates.length,
    streakDays: currentStreak(dates),
    longestStreak: longestStreak(dates),
    firstDate: dates[0],
    lastDate,
    windowStart,
    windowWeekday: windowStart === undefined ? undefined : new Date(`${windowStart}T00:00:00Z`).getUTCDay(),
  };
}

function dayOf(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return undefined;
  return new Date(time).toISOString().slice(0, 10);
}

/** 相邻两天按 UTC 日序号相差 1 判定；只有真正连续的日期才计入 streak。 */
function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function fromDayNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function addDays(date: string, delta: number): string {
  return fromDayNumber(dayNumber(date) + delta);
}

function longestStreak(sortedDates: readonly string[]): number {
  let longest = 0;
  let run = 0;
  let previous: number | undefined;
  for (const date of sortedDates) {
    const current = dayNumber(date);
    run = previous !== undefined && current - previous === 1 ? run + 1 : 1;
    previous = current;
    if (run > longest) longest = run;
  }
  return longest;
}

/** 当前 streak 只在「最近创作日就是最新日」时有意义；这里给出从最后一天往回数的长度。 */
function currentStreak(sortedDates: readonly string[]): number {
  let run = 0;
  let previous: number | undefined;
  for (let index = sortedDates.length - 1; index >= 0; index -= 1) {
    const current = dayNumber(sortedDates[index]!);
    if (previous === undefined) run = 1;
    else if (previous - current === 1) run += 1;
    else break;
    previous = current;
  }
  return run;
}

export type ResponseLabel = "discussion" | "reference" | "approval";

export type ResponseStructureItem = {
  title: string;
  url: string;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
  label?: ResponseLabel;
};

/**
 * 反响结构：按 赞同 / 评论 / 收藏 三者中占比最高的一项给内容贴结构标签。
 * 这是**互动比例描述**，不是内容质量评价——评论居多只说明讨论多，不代表内容更好。
 * 三项都为 0（或无数据）时不贴标签。
 */
export function buildResponseStructure(creations: readonly PersonalArchiveCreation[]): ResponseStructureItem[] {
  return creations.map((creation) => {
    const likeCount = creation.likeCount ?? 0;
    const commentCount = creation.commentCount ?? 0;
    const favoriteCount = creation.favoriteCount ?? 0;
    return {
      title: creation.title,
      url: creation.url,
      likeCount,
      commentCount,
      favoriteCount,
      label: labelOf(likeCount, commentCount, favoriteCount),
    };
  });
}

function labelOf(likeCount: number, commentCount: number, favoriteCount: number): ResponseLabel | undefined {
  const total = likeCount + commentCount + favoriteCount;
  if (total === 0) return undefined;
  // 严格大于才判给该维度；并列时回落到赞同，避免同一份数据随遍历顺序改标签。
  if (commentCount > likeCount && commentCount > favoriteCount) return "discussion";
  if (favoriteCount > likeCount && favoriteCount > commentCount) return "reference";
  return "approval";
}

export type CollectionPeriodBucket = {
  period: string;
  count: number;
  items: readonly PersonalArchiveCollection[];
};

export type CollectionTimelineView = {
  buckets: readonly CollectionPeriodBucket[];
  total: number;
  /** 收藏时间早于阈值的内容；缺收藏时间的条目不参与判断，也不计入。 */
  dormant: readonly PersonalArchiveCollection[];
};

/**
 * 收藏时间线：按月份分桶，并单独挑出「收藏较早」的条目供重温。
 * 只说「收藏超过 N 天」——平台没有浏览数据，不能说「你一直没再看」。
 */
export function buildCollectionTimeline(
  collections: readonly PersonalArchiveCollection[],
  options: { now?: Date; dormantDays?: number } = {},
): CollectionTimelineView {
  const now = options.now ?? new Date();
  const dormantDays = options.dormantDays ?? 30;
  const cutoff = now.getTime() - dormantDays * 86_400_000;

  const byPeriod = new Map<string, PersonalArchiveCollection[]>();
  const dormant: PersonalArchiveCollection[] = [];
  for (const item of collections) {
    const time = item.favTime === undefined ? Number.NaN : Date.parse(item.favTime);
    if (!Number.isNaN(time)) {
      const period = new Date(time).toISOString().slice(0, 7);
      const bucket = byPeriod.get(period);
      if (bucket === undefined) byPeriod.set(period, [item]);
      else bucket.push(item);
      if (time < cutoff) dormant.push(item);
    }
  }

  const buckets: CollectionPeriodBucket[] = [...byPeriod.entries()]
    .sort(([a], [b]) => (a > b ? -1 : a < b ? 1 : 0))
    .map(([period, items]) => ({ period, count: items.length, items }));

  return {
    buckets,
    total: collections.length,
    dormant: dormant.sort((a, b) => compareTime(a.favTime, b.favTime)),
  };
}

export type FolloweeTier = "large" | "peer" | "niche";

export type FolloweeTierView = {
  tier: FolloweeTier;
  count: number;
  items: readonly PersonalArchiveFollowee[];
};

const LARGE_FOLLOWER_THRESHOLD = 100_000;
const PEER_FOLLOWER_THRESHOLD = 10_000;

/**
 * 关注圈层：按粉丝数把关注对象分三层。
 * 这是**粉丝数分层**，不是兴趣画像；粉丝数缺失的按最小档处理，并保留在列表里。
 */
export function buildFolloweeTiers(followees: readonly PersonalArchiveFollowee[]): FolloweeTierView[] {
  const tiers: Record<FolloweeTier, PersonalArchiveFollowee[]> = { large: [], peer: [], niche: [] };
  for (const followee of followees) {
    tiers[tierOf(followee.followerCount)].push(followee);
  }
  return (["large", "peer", "niche"] as const).map((tier) => ({
    tier,
    count: tiers[tier].length,
    items: tiers[tier],
  }));
}

function tierOf(followerCount: number | undefined): FolloweeTier {
  if (followerCount === undefined) return "niche";
  if (followerCount >= LARGE_FOLLOWER_THRESHOLD) return "large";
  if (followerCount >= PEER_FOLLOWER_THRESHOLD) return "peer";
  return "niche";
}

export type HeadlineKeyword = {
  keyword: string;
  count: number;
  sampleNames: readonly string[];
};

/**
 * 一句话介绍里的高频词：ASCII 词按空白与非字母数字切分，中文取相邻双字组合。
 * 这是粗糙的字符串统计（不做分词、不调模型），只作为「大家常提到什么」的线索，
 * 不能当成兴趣归类结论。
 */
export function buildHeadlineKeywords(
  followees: readonly PersonalArchiveFollowee[],
  options: { limit?: number; minCount?: number } = {},
): HeadlineKeyword[] {
  const limit = options.limit ?? 12;
  const minCount = options.minCount ?? 2;
  const hits = new Map<string, Set<string>>();
  const counts = new Map<string, number>();

  for (const followee of followees) {
    const seen = new Set<string>();
    for (const token of tokenize(followee.headline)) {
      if (seen.has(token)) continue;
      seen.add(token);
      counts.set(token, (counts.get(token) ?? 0) + 1);
      const names = hits.get(token);
      if (names === undefined) hits.set(token, new Set([followee.name]));
      else names.add(followee.name);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([keyword, count]) => ({
      keyword,
      count,
      sampleNames: [...(hits.get(keyword) ?? [])].slice(0, 3),
    }));
}

const ASCII_WORD = /[A-Za-z0-9]{2,}/g;

function tokenize(headline: string): string[] {
  if (headline.trim() === "") return [];
  // 显式标注：`match` 的空值回退会让 `?? []` 推断成 never[]。
  const tokens: string[] = headline.match(ASCII_WORD) ?? [];
  const cjk = headline.replace(/[^\u4e00-\u9fff]/g, "");
  // 中文没有词边界，退化为相邻双字组合；单字噪声太大，不单独成词。
  for (let index = 0; index + 1 < cjk.length; index += 1) {
    tokens.push(cjk.slice(index, index + 2));
  }
  return tokens;
}

export type PersonalArchiveViews = {
  questionClusters: readonly QuestionCluster[];
  creationYear: CreationYearView;
  responseStructure: readonly ResponseStructureItem[];
  collectionTimeline: CollectionTimelineView;
  followeeTiers: readonly FolloweeTierView[];
  headlineKeywords: readonly HeadlineKeyword[];
};

/** 一次性从快照派生全部视图；每个视图都可由调用方单独复用。 */
export function buildPersonalArchiveViews(
  snapshot: PersonalArchiveSnapshot,
  options: { now?: Date; dormantDays?: number } = {},
): PersonalArchiveViews {
  return {
    questionClusters: buildQuestionClusters({
      creations: snapshot.creations,
      collections: snapshot.collections,
    }),
    creationYear: buildCreationYear(snapshot.creations),
    responseStructure: buildResponseStructure(snapshot.creations),
    collectionTimeline: buildCollectionTimeline(snapshot.collections, {
      now: options.now,
      dormantDays: options.dormantDays,
    }),
    followeeTiers: buildFolloweeTiers(snapshot.followees),
    headlineKeywords: buildHeadlineKeywords(snapshot.followees),
  };
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

function compareTime(a: string | undefined, b: string | undefined): number {
  const left = a === undefined ? Number.POSITIVE_INFINITY : Date.parse(a);
  const right = b === undefined ? Number.POSITIVE_INFINITY : Date.parse(b);
  if (Number.isNaN(left) && Number.isNaN(right)) return 0;
  if (Number.isNaN(left)) return 1;
  if (Number.isNaN(right)) return -1;
  return left - right;
}
