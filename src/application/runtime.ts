import { callerFromSecret } from "../platform/zhihu/identity.ts";
import { createOpenPlatformClient } from "../platform/zhihu/client.ts";
import { createContentGateway } from "../platform/zhihu/content.ts";
import { createZhidaGateway } from "../platform/zhihu/zhida.ts";
import { createUserDataGateway } from "../platform/zhihu/user-data.ts";
import {
  createCommunityClient,
  createCommunityGateway,
  readCommunityConfig,
} from "../platform/zhihu/community.ts";
import { createResearchBriefCommand } from "./research-brief.ts";
import { createVoicesCommand } from "./voices.ts";
import { createSeedQuestionsCommand } from "./seed-questions.ts";
import { createCirclesCommand } from "./circles.ts";
import { createHomeFeedCommand } from "./home-feed.ts";
import { createHomeAnswerCommand } from "./home-answer.ts";
import { createMemoryResearchSessionStore, createResearchSessionApplication } from "./research-session.ts";
import type { FetchLike } from "../platform/zhihu/client.ts";
import type { RequestIdentity, UserScope } from "../platform/zhihu/identity.ts";
import type { CommunityConfig } from "../platform/zhihu/community.ts";

export type RuntimeOptions = {
  accessSecret?: string;
  user?: UserScope;
  community?: CommunityConfig;
  fetch?: FetchLike;
  now?: () => number;
  clock?: () => Date;
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
  const communityConfig = options.community ?? readCommunityConfig(process.env);
  const community = communityConfig
    ? createCommunityGateway(createCommunityClient({ fetch: options.fetch, now: options.now }), communityConfig)
    : undefined;
  const researchSessions = createResearchSessionApplication({
    content,
    store: createMemoryResearchSessionStore(),
    clock: options.clock,
  });
  return {
    identity,
    client,
    content,
    userData,
    community,
    userDataFor(user: UserScope) {
      return createUserDataGateway(client, { caller: identity.caller, user }, options.clock);
    },
    researchBrief: createResearchBriefCommand(content, options.clock),
    researchSessions,
    voices: createVoicesCommand({ content, zhida, clock: options.clock }),
    homeFeed: createHomeFeedCommand({ content, clock: options.clock }),
    homeAnswer: createHomeAnswerCommand({ zhida, clock: options.clock }),
    seedQuestions: createSeedQuestionsCommand({ zhida, clock: options.clock }),
    // 圈子社区只读命令：缺社区凭证时不可用，路由据 undefined 给出准确提示。
    circles: community ? createCirclesCommand({ community, clock: options.clock }) : undefined,
  };
}
