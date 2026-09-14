/**
 * 个人档案验证：组装层是纯函数，这里用构造快照直接驱动，
 * 覆盖同题聚合、创作年轮、反响结构、收藏时间线、关注圈层的关键规则与边界。
 * 只验证规则本身，不代表真实知乎账号数据。
 */
import {
  DEFAULT_PERSONAL_ARCHIVE_LIMITS,
  PERSONAL_ARCHIVE_SCHEMA_VERSION,
  createPersonalArchiveCommand,
  type PersonalArchiveCollection,
  type PersonalArchiveCreation,
  type PersonalArchiveFollowee,
  type PersonalArchiveSnapshot,
  type PersonalArchiveStore,
} from "../application/personal-archive.ts";
import {
  buildCollectionTimeline,
  buildCreationYear,
  buildFolloweeTiers,
  buildHeadlineKeywords,
  buildPersonalArchiveViews,
  buildQuestionClusters,
  buildResponseStructure,
  questionIdFromUrl,
} from "../application/personal-archive-views.ts";
import { createFilePersonalArchiveStore, personalArchiveDir } from "../storage/personal-archive-store.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

function creation(index: number, patch: Partial<PersonalArchiveCreation> = {}): PersonalArchiveCreation {
  return {
    id: `user_contents:${index}`,
    contentType: "answer",
    title: `创作 ${index}`,
    url: `https://www.zhihu.com/question/1000${index}/answer/${index}`,
    createdAt: "2026-09-01T00:00:00.000Z",
    likeCount: 10,
    commentCount: 1,
    favoriteCount: 1,
    ...patch,
  };
}

function collection(index: number, patch: Partial<PersonalArchiveCollection> = {}): PersonalArchiveCollection {
  return {
    id: `collections:${index}`,
    contentType: "answer",
    title: `收藏 ${index}`,
    url: `https://www.zhihu.com/question/2000${index}/answer/${index}`,
    summary: "摘要",
    favlistNames: ["默认收藏夹"],
    favTime: "2026-09-01T00:00:00.000Z",
    ...patch,
  };
}

function followee(index: number, patch: Partial<PersonalArchiveFollowee> = {}): PersonalArchiveFollowee {
  return {
    id: `followees:${index}`,
    name: `关注者 ${index}`,
    url: `https://www.zhihu.com/people/user-${index}`,
    headline: "",
    ...patch,
  };
}

function snapshot(patch: Partial<PersonalArchiveSnapshot> = {}): PersonalArchiveSnapshot {
  return {
    schemaVersion: PERSONAL_ARCHIVE_SCHEMA_VERSION,
    userIdHash: "userhash1",
    syncedAt: "2026-09-13T00:00:00.000Z",
    creations: [],
    followees: [],
    favlists: [],
    collections: [],
    truncated: { creations: false, followees: false, favlistContents: false },
    ...patch,
  };
}

// —— 同题聚合 ——
check(questionIdFromUrl("https://www.zhihu.com/question/12345/answer/678") === "12345", "应从 answer 链接抽出问题 ID");
check(questionIdFromUrl("https://zhuanlan.zhihu.com/p/999") === undefined, "文章链接没有问题 ID");
check(questionIdFromUrl("https://www.zhihu.com/question/12345?utm_source=x") === "12345", "带参链接仍应抽出问题 ID");

{
  const clusters = buildQuestionClusters({
    creations: [
      creation(1, { url: "https://www.zhihu.com/question/555/answer/1" }),
      creation(2, { url: "https://www.zhihu.com/question/777/answer/2" }),
    ],
    collections: [
      collection(1, { url: "https://www.zhihu.com/question/555/answer/9" }),
      collection(2, { url: "https://www.zhihu.com/question/555/answer/10" }),
      collection(3, { url: "https://zhuanlan.zhihu.com/p/1" }),
    ],
  });
  check(clusters.length === 1, `应只聚合出 1 个同题簇，实际 ${clusters.length}`);
  const cluster = clusters[0]!;
  check(cluster.questionId === "555", "同题簇应指向问题 555");
  check(cluster.creationCount === 1 && cluster.collectionCount === 2, "同题簇应区分创作与收藏计数");
  check(cluster.items.length === 3, "同题簇应合并三类条目");
}
{
  // 单条内容不构成「聚合」；同一 URL 被写过又收藏也只算一条。
  const single = buildQuestionClusters({
    creations: [creation(1, { url: "https://www.zhihu.com/question/555/answer/1" })],
    collections: [],
  });
  check(single.length === 0, "单条内容不应被聚合");

  const sameUrl = buildQuestionClusters({
    creations: [creation(1, { url: "https://www.zhihu.com/question/555/answer/1" })],
    collections: [collection(1, { url: "https://www.zhihu.com/question/555/answer/1" })],
  });
  check(sameUrl.length === 0, "同一 URL 写在两侧应去重后不足阈值");
}

// —— 创作年轮 ——
{
  const year = buildCreationYear([
    creation(1, { createdAt: "2026-09-01T00:00:00.000Z" }),
    creation(2, { createdAt: "2026-09-01T05:00:00.000Z", contentType: "article" }),
    creation(3, { createdAt: "2026-09-02T00:00:00.000Z" }),
    creation(4, { createdAt: "2026-09-05T00:00:00.000Z" }),
    creation(5, { createdAt: undefined }),
  ]);
  check(year.total === 4, `缺时间的创作不应计入，total 应为 4，实际 ${year.total}`);
  check(year.activeDays === 3, `应为 3 个有创作的日期，实际 ${year.activeDays}`);
  // 可视化窗口是固定 365 天的连续日期（含零值日），尺度与日历一致；
  // 只输出有创作的日期会让相邻格子把「隔了三天」画成「连着两天」。
  const first = year.buckets.find((bucket) => bucket.date === "2026-09-01");
  check(first?.count === 2 && first.byType.answer === 1 && first.byType.article === 1, "同一天应累计并区分类型");
  check(year.buckets.length === 365, `窗口应固定为 365 格，实际 ${year.buckets.length}`);
  const gap = year.buckets.filter((bucket) => bucket.date === "2026-09-03" || bucket.date === "2026-09-04");
  check(gap.length === 2 && gap.every((bucket) => bucket.count === 0), "空档日必须是零值格而不是被跳过");
  check(year.longestStreak === 2, `最长连续应为 2，实际 ${year.longestStreak}`);
  check(year.streakDays === 1, `最近连续应为 1（9-05 与 9-02 不连续），实际 ${year.streakDays}`);
  check(year.firstDate === "2026-09-01" && year.lastDate === "2026-09-05", "首末日期应正确");
  check(year.windowStart === "2025-09-06", `窗口起点应为末次创作往前 365 天，实际 ${year.windowStart}`);
  check(year.windowWeekday !== undefined && year.windowWeekday >= 0 && year.windowWeekday <= 6, "应给出窗口起点的星期");
}
{
  const empty = buildCreationYear([]);
  check(empty.total === 0 && empty.activeDays === 0 && empty.longestStreak === 0, "空创作应得到全零年轮");
  check(empty.buckets.length === 0, "空创作不应产生窗口格子");
}
{
  // 跨度超过一年时，统计仍覆盖全部创作，窗口只保留最近一年。
  const year = buildCreationYear([
    creation(1, { createdAt: "2020-01-01T00:00:00.000Z" }),
    creation(2, { createdAt: "2026-09-01T00:00:00.000Z" }),
  ]);
  check(year.activeDays === 2, "统计应覆盖窗口外的创作");
  check(year.buckets.length === 365, `窗口应固定为 365 天，实际 ${year.buckets.length}`);
  check(year.buckets[year.buckets.length - 1]!.date === "2026-09-01", "窗口应结束在最近一次创作");
}

// —— 反响结构 ——
{
  const items = buildResponseStructure([
    creation(1, { likeCount: 100, commentCount: 1, favoriteCount: 1 }),
    creation(2, { likeCount: 1, commentCount: 100, favoriteCount: 1 }),
    creation(3, { likeCount: 1, commentCount: 1, favoriteCount: 100 }),
    creation(4, { likeCount: 0, commentCount: 0, favoriteCount: 0 }),
    creation(5, { likeCount: undefined, commentCount: undefined, favoriteCount: undefined }),
  ]);
  check(items[0]!.label === "approval", "赞同占比最高应标 approval");
  check(items[1]!.label === "discussion", "评论占比最高应标 discussion");
  check(items[2]!.label === "reference", "收藏占比最高应标 reference");
  check(items[3]!.label === undefined, "无互动数据不应贴标签");
  check(items[4]!.label === undefined, "字段缺失不应贴标签");
  check(items[4]!.likeCount === 0, "缺失计数值按 0 展示");
}

// —— 收藏时间线与沉睡收藏 ——
{
  const now = new Date("2026-09-13T00:00:00.000Z");
  const view = buildCollectionTimeline([
    collection(1, { favTime: "2026-09-10T00:00:00.000Z" }),
    collection(2, { favTime: "2026-09-05T00:00:00.000Z" }),
    collection(3, { favTime: "2026-06-01T00:00:00.000Z" }),
    collection(4, { favTime: undefined }),
  ], { now, dormantDays: 30 });
  check(view.total === 4, "总数应包含全部收藏");
  check(view.buckets.length === 2, `应有 2 个月份桶，实际 ${view.buckets.length}`);
  check(view.buckets[0]!.period === "2026-09", "月份桶应倒序排列");
  check(view.dormant.length === 1 && view.dormant[0]!.id === "collections:3", "只有超过阈值的收藏进入沉睡列表");
  check(view.buckets.reduce((sum, bucket) => sum + bucket.count, 0) === 3, "缺时间的收藏不入月份桶");
}

// —— 关注圈层 ——
{
  const tiers = buildFolloweeTiers([
    followee(1, { followerCount: 500000 }),
    followee(2, { followerCount: 100000 }),
    followee(3, { followerCount: 50000 }),
    followee(4, { followerCount: 9999 }),
    followee(5, { followerCount: undefined }),
  ]);
  const byTier = Object.fromEntries(tiers.map((tier) => [tier.tier, tier.count]));
  check(byTier.large === 2, `大 V 应为 2，实际 ${byTier.large}`);
  check(byTier.peer === 1, `同行应为 1，实际 ${byTier.peer}`);
  check(byTier.niche === 2, `小众（含粉丝数缺失）应为 2，实际 ${byTier.niche}`);
  check(tiers.map((tier) => tier.tier).join(",") === "large,peer,niche", "档位顺序应稳定");
}

// —— 简介关键词 ——
{
  const keywords = buildHeadlineKeywords([
    followee(1, { name: "甲", headline: "人工智能 研究者" }),
    followee(2, { name: "乙", headline: "人工智能 从业者" }),
    followee(3, { name: "丙", headline: "独立开发者" }),
  ], { minCount: 2 });
  check(keywords.some((keyword) => keyword.keyword === "人工" && keyword.count === 2), "重复的相邻双字组合应被统计");
  check(keywords.every((keyword) => keyword.count >= 2), "低于阈值的词不应出现");
  check(keywords.every((keyword) => keyword.sampleNames.length <= 3), "示例名称应有上限");
  check(buildHeadlineKeywords([followee(1, { headline: "" })], { minCount: 1 }).length === 0, "空简介不产生关键词");
}

// —— 组合入口 ——
{
  const views = buildPersonalArchiveViews(snapshot({
    creations: [creation(1, { url: "https://www.zhihu.com/question/555/answer/1" })],
    collections: [collection(1, { url: "https://www.zhihu.com/question/555/answer/2" })],
  }), { now: new Date("2026-09-13T00:00:00.000Z") });
  check(views.questionClusters.length === 1, "组合入口应包含同题聚合");
  check(views.creationYear.total === 1, "组合入口应包含创作年轮");
  check(views.followeeTiers.length === 3, "组合入口应包含三个关注档位");
}

// —— 采集：分页、上限与并发合并 ——
function makeGateway(options: {
  creationPages: number;
  followeePages: number;
  failOnCall?: number;
  /** 模拟上游不可用：创作列表直接失败，用于验证 stale 兜底。 */
  failContents?: boolean;
}) {
  const calls: string[] = [];
  let creationPage = 0;
  let followeePage = 0;
  const pageSize = DEFAULT_PERSONAL_ARCHIVE_LIMITS.pageSize;
  const gateway = {
    async myContents(input: { offset?: number; limit?: number } = {}) {
      calls.push(`contents:${input.offset ?? 0}`);
      if (options.failContents === true) throw new Error("upstream unavailable");
      creationPage += 1;
      const isLast = creationPage >= options.creationPages;
      return {
        kind: "user_contents" as const,
        fetchedAt: "2026-09-13T00:00:00.000Z",
        hasMore: !isLast,
        // 真实上游用 Paging.NextOffset 驱动翻页；假网关必须同样给出游标，否则只能停在首页。
        paging: { isEnd: isLast, nextOffset: isLast ? undefined : String(creationPage * pageSize) },
        items: [{ ...creation(creationPage), kind: "user_contents" as const, summary: "摘要" }],
      };
    },
    async followees(input: { offset?: number; limit?: number } = {}) {
      calls.push(`followees:${input.offset ?? 0}`);
      followeePage += 1;
      const isLast = followeePage >= options.followeePages;
      return {
        kind: "followees" as const,
        fetchedAt: "2026-09-13T00:00:00.000Z",
        hasMore: !isLast,
        paging: { isEnd: isLast, nextOffset: isLast ? undefined : String(followeePage * pageSize) },
        items: [{ ...followee(followeePage), kind: "followees" as const }],
      };
    },
    async favlists() {
      calls.push("favlists");
      return { kind: "favlists" as const, fetchedAt: "2026-09-13T00:00:00.000Z", items: [] };
    },
    async recentCollections() {
      calls.push("collections");
      return {
        kind: "collections" as const,
        fetchedAt: "2026-09-13T00:00:00.000Z",
        items: [{ ...collection(1), kind: "collections" as const }],
      };
    },
    async favlistContents() {
      calls.push("favlistContents");
      return {
        kind: "favlist_contents" as const,
        fetchedAt: "2026-09-13T00:00:00.000Z",
        hasMore: false,
        items: [],
      };
    },
    async questionRecommendations() {
      return {
        kind: "question_recommendations" as const,
        fetchedAt: "2026-09-13T00:00:00.000Z",
        items: [],
      };
    },
    calls,
  };
  return gateway;
}

{
  const gateway = makeGateway({ creationPages: 1, followeePages: 1 });
  const writes: PersonalArchiveSnapshot[] = [];
  const store: PersonalArchiveStore = {
    read: async () => undefined,
    write: async (value) => {
      writes.push(value);
    },
    clear: async () => {},
  };
  const command = createPersonalArchiveCommand({ store, clock: () => new Date("2026-09-13T00:00:00.000Z") });

  const first = await command.load({ userIdHash: "userhash1", gateway });
  check(first.snapshot.truncated.creations === false, "最后一页应判定为完整");
  check(first.stale === false, "新鲜同步不应标记 stale");
  check(writes.length === 1, "同步成功应写入一次快照");

  // TTL 内重复进入不应再次扫描上游，这正是额度保护的核心。
  const second = await command.load({ userIdHash: "userhash1", gateway });
  check(second.snapshot === first.snapshot, "TTL 内应复用同一份快照");
  check(gateway.calls.filter((call) => call.startsWith("contents")).length === 1, "TTL 内不应重复拉取创作");

  // 并发进入只发一次上游请求。
  const parallelGateway = makeGateway({ creationPages: 1, followeePages: 1 });
  const parallel = createPersonalArchiveCommand({ clock: () => new Date("2026-09-13T00:00:00.000Z") });
  const [a, b] = await Promise.all([
    parallel.load({ userIdHash: "userhash1", gateway: parallelGateway }),
    parallel.load({ userIdHash: "userhash1", gateway: parallelGateway }),
  ]);
  check(a.snapshot === b.snapshot, "并发进入应共享同一次同步");
  check(parallelGateway.calls.filter((call) => call.startsWith("contents")).length === 1, "并发进入只应拉取一次创作");
}
{
  // 上游失败时复用历史快照并标记 stale；没有历史快照时才如实报错。
  const writes: PersonalArchiveSnapshot[] = [];
  const store: PersonalArchiveStore = {
    read: async () => undefined,
    write: async (value) => {
      writes.push(value);
    },
    clear: async () => {},
  };
  let now = new Date("2026-09-13T00:00:00.000Z");
  const command = createPersonalArchiveCommand({ store, clock: () => now, ttlMs: 1 });
  const healthy = makeGateway({ creationPages: 1, followeePages: 1 });
  await command.load({ userIdHash: "userhash-stale", gateway: healthy });

  // 上游开始失败：冷却窗口内不允许重复全量扫描，只能复用历史快照。
  const broken = makeGateway({ creationPages: 1, followeePages: 1, failContents: true });
  now = new Date("2026-09-13T01:00:00.000Z");
  const stale = await command.load({ userIdHash: "userhash-stale", gateway: broken });
  check(stale.stale === true, "上游失败应复用历史快照并标记 stale");
  check(stale.snapshot.creations.length > 0, "stale 快照应仍带真实内容");
  check(writes.length === 1, "stale 复用不应重复写入快照");

  // 完全没有历史快照时，失败必须如实抛出，不能编一份空档案。
  const empty = createPersonalArchiveCommand({ clock: () => now });
  let threw = false;
  await empty.load({ userIdHash: "userhash-none", gateway: broken }).catch(() => {
    threw = true;
  });
  check(threw, "没有历史快照时上游失败应抛出，而不是返回空档案");
}
{
  // 达到页数上限时如实标记截断，而不是假装数据完整。
  const gateway = makeGateway({ creationPages: 99, followeePages: 99 });
  const command = createPersonalArchiveCommand({
    clock: () => new Date("2026-09-13T00:00:00.000Z"),
    limits: { maxCreationPages: 2, maxFolloweePages: 1 },
  });
  const loaded = await command.load({ userIdHash: "userhash2", gateway });
  check(loaded.snapshot.truncated.creations === true, "到达创作页数上限应标记截断");
  check(loaded.snapshot.truncated.followees === true, "到达关注页数上限应标记截断");
  check(gateway.calls.filter((call) => call.startsWith("contents")).length === 2, "创作页数应受上限约束");
  check(gateway.calls.filter((call) => call.startsWith("followees")).length === 1, "关注页数应受上限约束");
  check(DEFAULT_PERSONAL_ARCHIVE_LIMITS.pageSize === 50, "默认页大小应为契约上限 50");
}

// —— 快照落盘：按用户隔离、损坏不可用、登出清理 ——
{
  const dir = mkdtempSync(join(tmpdir(), "personal-archive-"));
  try {
    const store = createFilePersonalArchiveStore(personalArchiveDir(dir));
    await store.write(snapshot({ creations: [creation(1)], collections: [collection(1)] }));
    const readBack = await store.read("userhash1");
    check(readBack !== undefined, "写入的快照应能读回");
    check(readBack?.creations.length === 1 && readBack?.collections.length === 1, "读回内容应与写入一致");
    check((await store.read("otherhash")) === undefined, "不同用户不应读到他人快照");

    // 非法身份键不落盘：避免拼出越界路径。
    await store.write(snapshot({ userIdHash: "../escape" }));
    check((await store.read("../escape")) === undefined, "非法身份键不应读写");

    await store.clear("userhash1");
    check((await store.read("userhash1")) === undefined, "登出清理后不应再读到快照");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: "personal-archive" }));
