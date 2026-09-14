/**
 * 共享缓存端口验证：覆盖额度保护真正依赖的不变量——
 * TTL、容量上限、单飞、以及远端实现失败时按未命中处理。
 * 用内存实现与可控时钟驱动，不触网，也不代表真实上游额度行为。
 */
import { createMemorySharedCache } from "../application/shared-cache.ts";
import { createKvSharedCache, readRedisRestConfig, type RedisLike } from "../storage/kv-shared-cache.ts";

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

// —— Redis 连接信息：两套命名都要认 ——
// 这是一处曾经会静默失败的接缝：Upstash 集成注入 UPSTASH_REDIS_REST_*，
// 旧 Vercel KV 用 KV_REST_API_*；只认一套会让生产悄悄退回进程内存。
{
  const upstash = readRedisRestConfig({
    UPSTASH_REDIS_REST_URL: "https://upstash.example",
    UPSTASH_REDIS_REST_TOKEN: "tok-upstash",
  });
  check(upstash?.url === "https://upstash.example" && upstash?.token === "tok-upstash", "应识别 UPSTASH_REDIS_REST_*");

  const legacy = readRedisRestConfig({
    KV_REST_API_URL: "https://legacy.example",
    KV_REST_API_TOKEN: "tok-legacy",
  });
  check(legacy?.url === "https://legacy.example" && legacy?.token === "tok-legacy", "应识别旧 Vercel KV 命名");

  // 两套同时存在时以 Upstash 命名优先（与 @upstash/redis 的 fromEnv 一致）。
  const both = readRedisRestConfig({
    UPSTASH_REDIS_REST_URL: "https://upstash.example",
    UPSTASH_REDIS_REST_TOKEN: "tok-upstash",
    KV_REST_API_URL: "https://legacy.example",
    KV_REST_API_TOKEN: "tok-legacy",
  });
  check(both?.url === "https://upstash.example", "两套并存时应优先 Upstash 命名");

  // 空白值不算配置，避免把空字符串当成可用连接。
  const blank = readRedisRestConfig({ UPSTASH_REDIS_REST_URL: "  ", UPSTASH_REDIS_REST_TOKEN: "tok" });
  check(blank === undefined, "空白 URL 不应被当作已配置");
  check(readRedisRestConfig({}) === undefined, "无变量时应视为未配置");
}

// —— 内存实现：TTL 与容量上限 ——
{
  let now = 0;
  const cache = createMemorySharedCache({ maxEntries: 2, clock: () => now });

  await cache.set("a", { v: 1 }, 1000);
  check((await cache.get("a")) !== undefined, "写入的条目应能读回");
  now = 1001;
  check((await cache.get("a")) === undefined, "超过 TTL 应视为未命中");
}

{
  // 键可能来自用户检索词：必须靠容量上限保证长驻进程不泄漏。
  const cache = createMemorySharedCache({ maxEntries: 3 });
  for (let index = 0; index < 10; index += 1) {
    await cache.set(`topic-${index}`, index, 60_000);
  }
  check((await cache.get("topic-0")) === undefined, "超出上限应淘汰最久未使用的条目");
  check((await cache.get("topic-9")) === 9, "最新写入的条目应保留");
}

// —— 内存实现：单飞 ——
{
  const cache = createMemorySharedCache();
  check(await cache.acquire("archive:u1", 1000) === true, "首次获取应拿到执行权");
  check(await cache.acquire("archive:u1", 1000) === false, "锁未过期时不应重复拿到执行权");
}

// —— KV 实现：语义与内存实现一致，且失败时按未命中处理 ——
{
  // 只实现用到的子集，模拟 Upstash 的 SET NX 语义。
  const store = new Map<string, unknown>();
  const redis: RedisLike = {
    async get(key) {
      // 模拟网络失败：缓存不可用不能让请求失败。
      if (key === "boom") throw new Error("network down");
      return (store.get(key) as never) ?? null;
    },
    async set(key, value, options) {
      if (options?.nx === true && store.has(key)) return null;
      store.set(key, options?.nx === true ? "1" : value);
      return "OK";
    },
    async del(key) {
      store.delete(key);
      return 1;
    },
  };
  const cache = createKvSharedCache(redis);

  await cache.set("k", { v: "hello" }, 60_000);
  const read = await cache.get("k") as { v?: string } | undefined;
  check(read?.v === "hello", "KV 写入的值应能读回");

  check(await cache.acquire("lock", 60_000) === true, "KV 首次加锁应成功");
  check(await cache.acquire("lock", 60_000) === false, "KV 锁未过期时不应重复成功");

  check((await cache.get("boom")) === undefined, "KV 读取失败应按未命中处理");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: "shared-cache" }));
