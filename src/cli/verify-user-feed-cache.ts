/**
 * 「我的知乎」摘要列表缓存验证：覆盖额度保护依赖的不变量——
 * 按用户隔离、TTL 内复用、并发合并、失败不写缓存、登出清理。
 * 用内存共享缓存与可控时钟驱动，不触网，不代表真实上游数据。
 */
import { createUserFeedCache, USER_FEED_IDS } from "../application/user-feed-cache.ts";
import { createMemorySharedCache } from "../application/shared-cache.ts";

const failures: string[] = [];
const check = (c: unknown, m: string) => { if (!c) failures.push(m); };

// —— 按用户隔离：绝不能串号 ——
{
  const cache = createUserFeedCache({ cache: createMemorySharedCache() });
  await cache.load({ userId: "userA", feed: "contents", load: async () => ["A的创作"] });
  await cache.load({ userId: "userB", feed: "contents", load: async () => ["B的创作"] });

  const readA = await cache.load({ userId: "userA", feed: "contents", load: async () => ["不该被调用"] });
  const readB = await cache.load({ userId: "userB", feed: "contents", load: async () => ["不该被调用"] });
  check(JSON.stringify(readA) === JSON.stringify(["A的创作"]), "A 应读到自己那份缓存");
  check(JSON.stringify(readB) === JSON.stringify(["B的创作"]), "B 应读到自己那份缓存");
}

// —— 同一用户的不同列表不互相覆盖 ——
{
  const cache = createUserFeedCache({ cache: createMemorySharedCache() });
  await cache.load({ userId: "u", feed: "contents", load: async () => "创作" });
  await cache.load({ userId: "u", feed: "followees", load: async () => "关注" });
  const c = await cache.load({ userId: "u", feed: "contents", load: async () => "不该被调用" });
  const f = await cache.load({ userId: "u", feed: "followees", load: async () => "不该被调用" });
  check(c === "创作", "创作列表不应被关注列表覆盖");
  check(f === "关注", "关注列表应独立缓存");
}

// —— TTL：窗口内复用，过期后重新取数（这正是省额度的关键） ——
{
  let now = 0;
  const cache = createUserFeedCache({
    cache: createMemorySharedCache({ clock: () => now }),
    clock: () => new Date(now),
    ttlMs: 1000,
  });
  let calls = 0;
  const load = async () => { calls += 1; return `第${calls}次`; };
  await cache.load({ userId: "u", feed: "contents", load });
  await cache.load({ userId: "u", feed: "contents", load });
  check(calls === 1, `TTL 内应复用缓存，实际取数 ${calls} 次`);
  now = 2000;
  await cache.load({ userId: "u", feed: "contents", load });
  check(calls === 2, `TTL 过后应重新取数，实际 ${calls} 次`);
}

// —— 并发只取一次（同一实例内） ——
{
  const cache = createUserFeedCache({ cache: createMemorySharedCache() });
  let calls = 0;
  const load = async () => { calls += 1; return "v"; };
  await Promise.all([
    cache.load({ userId: "u", feed: "contents", load }),
    cache.load({ userId: "u", feed: "contents", load }),
    cache.load({ userId: "u", feed: "contents", load }),
  ]);
  check(calls === 1, `并发进入应只取一次，实际 ${calls} 次`);
}

// —— 失败不写缓存：一次抖动不该被记成一段时间的结果 ——
{
  const shared = createMemorySharedCache();
  const cache = createUserFeedCache({ cache: shared });
  let calls = 0;
  const failing = async () => { calls += 1; throw new Error("upstream down"); };
  await cache.load({ userId: "u", feed: "contents", load: failing }).catch(() => {});
  const ok = await cache.load({ userId: "u", feed: "contents", load: async () => "恢复" });
  check(ok === "恢复" && calls === 1, "失败不应写缓存，下次应能取到新结果");
}

// —— 没有用户身份就不缓存（宁可不省额度，也不冒串号风险） ——
{
  const cache = createUserFeedCache({ cache: createMemorySharedCache() });
  let calls = 0;
  const load = async () => { calls += 1; return "v"; };
  await cache.load({ userId: "", feed: "contents", load });
  await cache.load({ userId: "", feed: "contents", load });
  check(calls === 2, "无用户身份时不应缓存");
}

// —— 登出清理：登记的列表都要删掉 ——
{
  const shared = createMemorySharedCache();
  const cache = createUserFeedCache({ cache: shared, feeds: USER_FEED_IDS });
  for (const feed of USER_FEED_IDS) await cache.load({ userId: "u", feed, load: async () => feed });
  await cache.clear("u");
  let calls = 0;
  for (const feed of USER_FEED_IDS) {
    await cache.load({ userId: "u", feed, load: async () => { calls += 1; return "new"; } });
  }
  check(calls === USER_FEED_IDS.length, `登出后每个列表都应重新取数，实际 ${calls} 次`);
}

if (failures.length) { for (const f of failures) console.error("✗ " + f); process.exit(1); }
console.log(JSON.stringify({ ok: true, checks: "user-feed-cache" }));
