import { callerFromSecret } from "../platform/zhihu/identity.ts";
import { createOpenPlatformClient } from "../platform/zhihu/client.ts";
import { createContentGateway } from "../platform/zhihu/content.ts";
import { createZhidaGateway } from "../platform/zhihu/zhida.ts";
import { createUserDataGateway } from "../platform/zhihu/user-data.ts";
import { createResearchBriefCommand } from "./research-brief.ts";
import { createVoicesCommand } from "./voices.ts";
import { createEntrySeedsCommand } from "./entry-seeds.ts";
import { createHomeFeedCommand } from "./home-feed.ts";
import { createHomeAnswerCommand } from "./home-answer.ts";
import { createResearchProCommand } from "./research-pro.ts";
import { createPersonalArchiveCommand, type PersonalArchiveStore } from "./personal-archive.ts";
import { createUserFeedCache, USER_FEED_IDS } from "./user-feed-cache.ts";
import { createMemoryResearchSessionStore, createResearchSessionApplication } from "./research-session.ts";
import type { HomeFeedCacheStore } from "./home-feed.ts";
import type { SharedCache } from "./shared-cache.ts";
import type { FetchLike } from "../platform/zhihu/client.ts";
import type { RequestIdentity, UserScope } from "../platform/zhihu/identity.ts";

export type RuntimeOptions = {
  accessSecret?: string;
  user?: UserScope;
  fetch?: FetchLike;
  now?: () => number;
  clock?: () => Date;
  /** 热榜缓存持久化：本地/桌面写文件，网页端写跨实例的远端缓存。 */
  hotCacheStore?: HomeFeedCacheStore;
  /** 个人档案快照持久化：提供时才按用户跨请求复用；缺省只在进程内缓存。 */
  personalArchiveStore?: PersonalArchiveStore;
  /** 跨实例单飞：网页端多实例并发进入同一入口时只让一个真正打上游。 */
  archiveLock?: Pick<SharedCache, "acquire">;
  /** 个人数据列表的短时缓存：网页端接共享存储，缺省只在进程内复用。 */
  userFeedCache?: SharedCache;
};

export function createRuntime(options: RuntimeOptions = {}) {
  const identity: RequestIdentity = {
    caller: callerFromSecret(options.accessSecret ?? process.env.ZHIHU_ACCESS_SECRET),
    user: options.user,
  };
  const client = createOpenPlatformClient({
    fetch: options.fetch,
    now: options.now,
  });
  const content = createContentGateway(client, identity, options.clock);
  const zhida = createZhidaGateway(client, identity);
  const userData = createUserDataGateway(client, identity, options.clock);
  const researchSessions = createResearchSessionApplication({
    content,
    store: createMemoryResearchSessionStore(),
    clock: options.clock,
  });
  return {
    identity,
    client,
    content,
    zhida,
    userData,
    userDataFor(user: UserScope) {
      return createUserDataGateway(client, { caller: identity.caller, user }, options.clock);
    },
    researchBrief: createResearchBriefCommand(content, options.clock),
    researchSessions,
    voices: createVoicesCommand({ content, zhida, clock: options.clock }),
    homeFeed: createHomeFeedCommand({ content, clock: options.clock, cacheStore: options.hotCacheStore }),
    homeAnswer: createHomeAnswerCommand({ zhida, clock: options.clock }),
    /** 网页端的深度研究 Pro：单次直答，不落库。自研 Ultra 引擎由本机运行面单独承接。 */
    researchPro: createResearchProCommand({ zhida, clock: options.clock }),
    /** 入口种子：深度研究与众声共用，素材是登录用户自己的收藏标题。 */
    entrySeeds: createEntrySeedsCommand({ zhida, clock: options.clock }),
    personalArchive: createPersonalArchiveCommand({
      store: options.personalArchiveStore,
      lock: options.archiveLock,
      clock: options.clock,
    }),
    /** 「我的知乎」摘要列表：按会话用户做短时缓存，刷新与切页不重复消耗额度。 */
    userFeeds: createUserFeedCache({
      cache: options.userFeedCache,
      clock: options.clock,
      feeds: USER_FEED_IDS,
    }),
  };
}
