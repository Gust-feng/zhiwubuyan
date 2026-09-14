import type { IncomingMessage, ServerResponse } from "node:http";
import { isProductError, ProductError } from "../platform/zhihu/errors.ts";
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  readAuthorizationCode,
} from "../platform/zhihu/oauth.ts";
import type { OAuthAppConfig, OAuthToken } from "../platform/zhihu/oauth.ts";
import { fetchAuthorizedUserProfile, type AuthorizedUserProfile } from "../platform/zhihu/user-profile.ts";
import type { UserDataGateway } from "../platform/zhihu/user-data.ts";
import { buildPersonalArchiveViews } from "../application/personal-archive-views.ts";
import { ENTRY_SEED_KINDS, SEED_TOPIC_LIMIT, type EntrySeedKind } from "../application/entry-seeds.ts";
import type { createRuntime } from "../application/runtime.ts";
import type { RateLimiter } from "./rate-limit.ts";
import { rateLimitKey } from "./rate-limit.ts";
import type { SessionStore } from "./session-store.ts";
import {
  clearedSessionCookie,
  isSecureRequest,
  readJson,
  readOptionalInt,
  readOptionalString,
  readRequiredString,
  readSessionId,
  redirect,
  sessionCookie,
  asRequest,
  writeJson,
} from "./http-utils.ts";

export type ZhihuApiDeps = {
  runtime: ReturnType<typeof createRuntime> | undefined;
  oauthConfig: OAuthAppConfig | undefined;
  sessions: SessionStore;
  /** 仅本地开发预览启用：未登录时使用当前项目的 ACS 调用方身份读取个人数据。 */
  developerUserDataEnabled?: boolean;
  /** /api/status 对外声明的能力集，按运行面（本地/网页）传入。 */
  capabilities: readonly string[];
  /** 运行面：网页端要求登录知乎账号，本地预览不要求。 */
  surface?: "desktop" | "web";
  /** 网页端热榜走 CDN 共享缓存（如 "public, s-maxage=3600"）；本地不传。 */
  hotCacheControl?: string;
  /** 网页端额度保护：登录后消耗额度的接口计数；不传则不限流。 */
  rateLimiter?: RateLimiter;
  /** 登录尚未接通时缺少的配置项名称（只回名称）；无则登录可用。 */
  oauthMissingConfig?: readonly string[];
  /** 应用固定回调地址；只要公开来源可推导就给，用于未接通时展示待登记地址。 */
  oauthRedirectUri?: string;
  /**
   * 是否承接深度研究 Pro（单次知乎直答）。网页端开启：Pro 不依赖长驻引擎，
   * 是次秒级单次调用。自研 Ultra 引擎仍只在本地/桌面运行面承接。
   */
  researchProEnabled?: boolean;
  /**
   * 成象（概念动画）路由。网页端传入共享路由实现，本处负责登录门槛、限流，
   * 并把会话派生的用户 scope 交给它——避免共享路由再实现一套身份解析。
   */
  conceptAnimation?: {
    handle(scope: string, url: URL, request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  };
  /**
   * 会话与缓存实际落在哪里（"redis" / "memory"）。只用于 /api/status 的运维可见性：
   * 线上若显示 memory，说明共享存储没接上，登录会在多实例间随机失效——
   * 只看「登录后又要求登录」这个现象无法区分是配置没生效还是代码问题，所以如实暴露。
   */
  sessionStorage?: "redis" | "memory";
};

/**
 * 知乎系共享路由：本地服务器与 Vercel 函数共用同一实现。
 * 只依赖知乎开放平台，不触碰深度研究后端；命中返回 true，未命中返回 false。
 */
export function createZhihuApiHandler(deps: ZhihuApiDeps) {
  const { runtime, oauthConfig, sessions, developerUserDataEnabled = false, surface = "web" } = deps;
  const oauthCallback = oauthConfig ? callbackUrl(oauthConfig) : undefined;

  const profileCache = new Map<string, { profile: AuthorizedUserProfile | undefined; expiresAt: number }>();
  const PROFILE_TTL_MS = 5 * 60 * 1000;
  // 会话已解析出的快照身份键：登出时据此清理该用户的档案，不必再打一次上游换资料。
  const sessionArchiveKeys = new Map<string, string>();
  // 长驻进程的上限：键按 token/会话增长，不设上限会随使用时长一路涨。
  const PROFILE_CACHE_MAX_ENTRIES = 500;
  const SESSION_ARCHIVE_KEYS_MAX_ENTRIES = 500;

  /** 写入带容量上限的缓存；超出时淘汰最早插入的条目。 */
  function remember<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > maxEntries) {
      const oldest = map.keys().next();
      if (oldest.done === true) break;
      map.delete(oldest.value);
    }
  }

  /** 顺带回收已过期的档案键，避免登出后长期不用时残留。 */
  function pruneProfileCache(now: number): void {
    for (const [key, entry] of profileCache) {
      if (entry.expiresAt > now) break;
      profileCache.delete(key);
    }
  }

  async function activeSession(request: IncomingMessage): Promise<OAuthToken | undefined> {
    return sessions.read(readSessionId(request), Date.now());
  }

  /**
   * 展示用的昵称与头像来自没有正式契约的基础信息端点；读取失败或字段缺失时
   * 返回 undefined，让界面回退到无资料形态，绝不因此中断会话或用户数据接口。
   */
  async function loadProfile(token: OAuthToken): Promise<AuthorizedUserProfile | undefined> {
    const now = Date.now();
    pruneProfileCache(now);
    const cached = profileCache.get(token.accessToken);
    if (cached !== undefined && cached.expiresAt > now) return cached.profile;
    let profile: AuthorizedUserProfile | undefined;
    try {
      profile = await fetchAuthorizedUserProfile(token.accessToken);
    } catch {
      profile = undefined;
    }
    // 失败也缓存，避免侧栏与个人页在短时间各打一次上游。
    remember(profileCache, token.accessToken, {
      profile,
      expiresAt: Math.min(now + PROFILE_TTL_MS, token.expiresAt),
    }, PROFILE_CACHE_MAX_ENTRIES);
    return profile;
  }

  async function withAuthorizedUser<T>(
    request: IncomingMessage,
    response: ServerResponse,
    run: (userData: UserDataGateway) => Promise<T>,
  ): Promise<T> {
    const active = requireRuntime();
    const session = await activeSession(request);
    if (!session && !developerUserDataEnabled) {
      throw new ProductError("AUTH_REQUIRED", "请先使用知乎账号登录。");
    }
    try {
      return await run(session
        ? active.userDataFor({ kind: "authorized_user", accessToken: session.accessToken })
        : active.userData);
    } catch (error) {
      if (session && isProductError(error) && error.code === "AUTH_INVALID") {
        await sessions.drop(readSessionId(request));
        response.setHeader("Set-Cookie", clearedSessionCookie(isSecureRequest(request)));
        throw new ProductError("AUTH_REQUIRED", "登录已过期，请重新登录。");
      }
      throw error;
    }
  }

  function requireRuntime() {
    if (!runtime) throw new ProductError("AUTH_REQUIRED", "尚未配置知乎开放平台凭证。");
    return runtime;
  }

  /**
   * 「我的知乎」摘要列表的取数：按会话用户做短时缓存后走统一授权取数。
   *
   * 缓存键用**会话标识**而不是 access token——token 会随时间更换，
   * 用它当键会让同一用户每次换令牌都拿不到上一份缓存。会话标识只用于
   * 区分用户，不参与任何对外请求。
   */
  async function cachedUserFeed<T>(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    feed: string,
    run: (userData: UserDataGateway) => Promise<T>,
  ): Promise<T> {
    const active = requireRuntime();
    const sessionId = readSessionId(request);
    const force = url.searchParams.get("refresh") === "1";
    // 未登录（仅开发者模式）时没有稳定身份，直接取数，不写缓存。
    if (sessionId === undefined || force) {
      return await withAuthorizedUser(request, response, run);
    }
    return await active.userFeeds.load({
      userId: sessionId,
      feed,
      load: () => withAuthorizedUser(request, response, run),
    });
  }

  /**
   * 个人档案：一次同步采集登录用户自己的创作/关注/收藏，再派生组装视图。
   * 快照的身份键取 `/user` 的 `hash_id`；取不到时降级为会话内临时档案（不落盘），
   * 并如实告诉前端本次档案不跨会话保存，而不是编一个键把它写进磁盘。
   */
  async function loadPersonalArchive(request: IncomingMessage, response: ServerResponse, force = false) {
    const active = requireRuntime();
    const session = await activeSession(request);
    if (!session && !developerUserDataEnabled) {
      throw new ProductError("AUTH_REQUIRED", "请先使用知乎账号登录。");
    }
    const profile = session ? await loadProfile(session) : undefined;
    const userIdHash = profile?.hashId;
    const persistent = userIdHash !== undefined;
    // 没有稳定身份键时用会话/开发者身份做进程内键；persist=false 保证不落盘也不跨用户复用。
    const cacheKey = userIdHash ?? (session ? `session:${session.accessToken.slice(0, 12)}` : "caller");
    const sessionId = readSessionId(request);
    if (session !== undefined && sessionId !== undefined) {
      remember(sessionArchiveKeys, sessionId, cacheKey, SESSION_ARCHIVE_KEYS_MAX_ENTRIES);
    }

    const snapshot = await active.personalArchive.load({
      userIdHash: cacheKey,
      gateway: session
        ? active.userDataFor({ kind: "authorized_user", accessToken: session.accessToken })
        : active.userData,
      profile,
      persist: persistent,
      force,
    }).catch(async (error: unknown) => {
      // 与既有用户数据路由一致：令牌失效时销毁会话并要求重新登录，不回退到凭证所属账号。
      if (session && isProductError(error) && error.code === "AUTH_INVALID") {
        await sessions.drop(readSessionId(request));
        response.setHeader("Set-Cookie", clearedSessionCookie(isSecureRequest(request)));
        throw new ProductError("AUTH_REQUIRED", "登录已过期，请重新登录。");
      }
      throw error;
    });

    return {
      syncedAt: snapshot.snapshot.syncedAt,
      persistent,
      // 上游不可用时复用上一份快照：如实告诉前端这是旧的，不冒充刚同步的数据。
      stale: snapshot.stale,
      truncated: snapshot.snapshot.truncated,
      profile: snapshot.snapshot.profile,
      counts: {
        creations: snapshot.snapshot.creations.length,
        followees: snapshot.snapshot.followees.length,
        favlists: snapshot.snapshot.favlists.length,
        collections: snapshot.snapshot.collections.length,
      },
      views: buildPersonalArchiveViews(snapshot.snapshot),
    };
  }

  /**
   * 网页端消耗调用方额度的功能一律要求登录：额度挂在部署方账号上，不能让匿名访客直接消耗。
   * 桌面端用用户自己填写的调用凭证，不强制 OAuth（登录仍可用，个人数据走授权用户身份）。
   * 本地开发预览（developerUserDataEnabled）保持免登录，与用户数据接口的既有约定一致。
   */
  async function requireWebLogin(request: IncomingMessage): Promise<void> {
    if (surface !== "web") return;
    if (developerUserDataEnabled && runtime !== undefined) return;
    const session = await activeSession(request);
    if (!session) throw new ProductError("AUTH_REQUIRED", "请先使用知乎账号登录。");
  }

  /** 额度保护：超过窗口上限时返回 429，由前端如实提示而不是静默重试。 */
  async function enforceRateLimit(request: IncomingMessage, response: ServerResponse, scope: string): Promise<void> {
    if (!deps.rateLimiter) return;
    const decision = await deps.rateLimiter.check(rateLimitKey(scope, readSessionId(request), request));
    if (decision.allowed) return;
    response.setHeader("Retry-After", String(decision.retryAfterSeconds));
    throw new ProductError("RATE_LIMITED", "请求过于频繁，请稍后再试。");
  }

  /**
   * 成象记录的隔离键：优先 `/user` 的 hash_id（稳定、跨会话一致），
   * 拿不到时退回会话内临时键——与个人档案同一策略，绝不把不同用户混进同一 scope。
   */
  async function conceptAnimationScope(request: IncomingMessage): Promise<string> {
    const session = await activeSession(request);
    if (session === undefined) return "caller";
    const profile = await loadProfile(session);
    return profile?.hashId ?? `session:${session.accessToken.slice(0, 12)}`;
  }

  async function handleOAuthCallback(url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!oauthConfig || !oauthCallback) throw new ProductError("AUTH_REQUIRED", "知乎账号登录尚未配置。");
    const landing = `${oauthCallback.origin}/`;
    const code = readAuthorizationCode(url.searchParams);
    if (!code) {
      return redirect(response, 302, `${landing}?login_error=missing_code`);
    }
    try {
      const token = await exchangeAuthorizationCode(oauthConfig, code);
      const sessionId = await sessions.create(token);
      const maxAge = Math.max(1, Math.round((token.expiresAt - Date.now()) / 1000));
      response.setHeader("Set-Cookie", sessionCookie(sessionId, maxAge, isSecureRequest(request)));
      return redirect(response, 302, landing);
    } catch (error) {
      if (isProductError(error)) {
        return redirect(response, 302, `${landing}?login_error=${encodeURIComponent(error.code)}`);
      }
      throw error;
    }
  }

  return async function handleZhihuApi(
    url: URL,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    try {
      if (url.pathname === "/api/status" && request.method === "GET") {
        return writeJson(response, 200, {
          configured: runtime !== undefined,
          // 能力集同时是前端判定服务端承接能力的依据：声明了才启用，未声明时如实显示未接通。
          capabilities: deps.capabilities,
          // 登录形态按运行面区分：网页端走应用内弹窗，本地/桌面预览走独立登录窗口。
          surface,
          // 会话落在哪：线上显示 memory 就说明共享存储没接上（登录会随机失效）。
          ...(deps.sessionStorage === undefined ? {} : { sessionStorage: deps.sessionStorage }),
          auth: {
            oauthEnabled: oauthConfig !== undefined,
            loginRequired: surface === "desktop",
            // 未接通时列出缺少的配置项名称，前端据此如实说明；不回传任何值。
            missingConfig: deps.oauthMissingConfig ?? [],
            // 应用固定的回调地址；已配置公开来源时就能给出，未接通也如实展示待登记地址。
            redirectUri: oauthConfig?.redirectUri ?? deps.oauthRedirectUri,
          },
        });
      }
      if (url.pathname === "/api/auth/session" && request.method === "GET") {
        const session = await activeSession(request);
        // 会话状态是**按 cookie** 变化的个人响应：绝不能被 CDN 或浏览器当公共资源缓存，
        // 否则「刚登录却仍被要求登录」这类现象会随缓存出现且难以复现。
        response.setHeader("Cache-Control", "private, no-store");
        response.setHeader("Vary", "Cookie");
        return writeJson(response, 200, {
          oauthEnabled: oauthConfig !== undefined,
          authenticated: session !== undefined || (developerUserDataEnabled && runtime !== undefined),
          developerMode: developerUserDataEnabled && runtime !== undefined,
          expiresAt: session ? new Date(session.expiresAt).toISOString() : undefined,
          profile: session ? await loadProfile(session) : undefined,
          surface,
        });
      }
      if (url.pathname === "/api/auth/authorize" && request.method === "GET") {
        if (!oauthConfig) throw new ProductError("AUTH_REQUIRED", "知乎账号登录尚未配置。");
        redirect(response, 302, buildAuthorizeUrl(oauthConfig));
        return true;
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const sessionId = readSessionId(request);
        if (sessionId !== undefined) {
          const archiveKey = sessionArchiveKeys.get(sessionId);
          if (archiveKey !== undefined) {
            await runtime?.personalArchive.clear(archiveKey);
            sessionArchiveKeys.delete(sessionId);
          }
          // 摘要列表按会话隔离，登出必须清掉，避免残留给下一个使用者。
          await runtime?.userFeeds.clear(sessionId);
        }
        await sessions.drop(sessionId);
        response.setHeader("Set-Cookie", clearedSessionCookie(isSecureRequest(request)));
        return writeJson(response, 200, { ok: true });
      }
      if (oauthCallback && url.pathname === oauthCallback.pathname && request.method === "GET") {
        await handleOAuthCallback(url, request, response);
        return true;
      }
      if (url.pathname === "/api/hot" && request.method === "GET") {
        const active = requireRuntime();
        // 与首页内容流共用同一份热榜缓存：额度只有 100 次/天，不能两条路径各打一次上游。
        const feed = await active.homeFeed.feed({});
        if (deps.hotCacheControl) response.setHeader("Cache-Control", deps.hotCacheControl);
        return writeJson(response, 200, {
          kind: "hot_list",
          fetchedAt: feed.fetchedAt,
          items: feed.items,
          stale: feed.stale,
        });
      }
      // 首页内容流：不带 topic 时是热榜种子；带 topic 时是用户主动发起的主题检索。
      if (url.pathname === "/api/home/feed" && request.method === "GET") {
        const active = requireRuntime();
        const topic = readOptionalString(url.searchParams.get("topic"));
        // 热榜是公开内容且匿名响应才能被 CDN 共享缓存，不要求登录；
        // 主题检索由用户主动发起、逐次消耗搜索额度，网页端要求登录。
        if (topic !== undefined) await requireWebLogin(request);
        const feed = await active.homeFeed.feed({
          topic,
          scope: url.searchParams.get("scope") === "web" ? "web" : "zhihu",
          type: readHomeFeedType(url.searchParams.get("type")),
          limit: readOptionalInt(url.searchParams.get("limit"), 20),
        });
        // 热榜结果可以短时共享；主题检索带用户输入，不做下游缓存。
        if (feed.channel === "hot" && deps.hotCacheControl) {
          response.setHeader("Cache-Control", deps.hotCacheControl);
        }
        return writeJson(response, 200, feed);
      }
      // 首页问答：直答快答（fast/thinking），不取证、不产生来源引用。
      if (url.pathname === "/api/home/answer" && request.method === "POST") {
        await requireWebLogin(request);
        await enforceRateLimit(request, response, "home-answer");
        const active = requireRuntime();
        const body = asRequest(await readJson(request));
        const answer = await active.homeAnswer.execute({
          question: readRequiredString(body.question, "问题不能为空。"),
          tier: readHomeAnswerTier(body.tier),
        });
        return writeJson(response, 200, answer);
      }
      // 「我的知乎」三张摘要列表：数据不会分钟级变化，而每次刷新页面都会重新问一次知乎。
      // 按会话用户做短时缓存（见 user-feed-cache），刷新与切页复用同一份；
      // `?refresh=1` 表示用户显式要求新数据，跳过缓存。
      if (url.pathname === "/api/user/collections" && request.method === "GET") {
        const result = await cachedUserFeed(request, response, url, "collections", (userData) =>
          userData.recentCollections({ limit: 10 }));
        return writeJson(response, 200, result);
      }
      if (url.pathname === "/api/user/contents" && request.method === "GET") {
        const result = await cachedUserFeed(request, response, url, "contents", (userData) =>
          userData.myContents({ limit: 10 }));
        return writeJson(response, 200, result);
      }
      if (url.pathname === "/api/user/followees" && request.method === "GET") {
        const result = await cachedUserFeed(request, response, url, "followees", (userData) =>
          userData.followees({ limit: 10 }));
        return writeJson(response, 200, result);
      }
      if (url.pathname === "/api/user/archive" && request.method === "GET") {
        // 一次同步会翻页取全创作/关注/收藏，是额度最重的入口；网页端必须先过限流。
        await enforceRateLimit(request, response, "user-archive");
        // `refresh=1` 是用户显式要求重新同步：跳过服务端 TTL，其余情况一律走缓存。
        const force = url.searchParams.get("refresh") === "1";
        return writeJson(response, 200, await loadPersonalArchive(request, response, force));
      }
      if (url.pathname === "/api/research/voices" && request.method === "POST") {
        await requireWebLogin(request);
        await enforceRateLimit(request, response, "voices");
        const active = requireRuntime();
        const body = asRequest(await readJson(request));
        const voices = await active.voices.execute({
          issue: readRequiredString(body.issue, "议题不能为空。"),
          anchorQuestionId: readOptionalString(body.anchorQuestionId),
          scope: readVoicesScope(body.scope),
          recency: readVoicesRecency(body.recency),
        });
        return writeJson(response, 200, voices);
      }
      // 入口种子：素材按入口各取各的，成品都由直答提炼成该入口能直接用的内容。
      //   深度研究——登录用户自己的收藏标题（user_data 额度组），要登录才读得到；
      //   众声——知乎热榜（公开内容），与身份无关，因此不要求登录。
      // 提炼走 zhida_openai 组；素材全在服务端取，前端只说明自己是哪个入口。
      if (url.pathname === "/api/research/seeds" && request.method === "GET") {
        const kind = readEntrySeedKind(url.searchParams.get("kind"));
        // 两个入口各自计数：一个入口被刷爆不该连带另一个也用不了。
        await enforceRateLimit(request, response, `entry-seeds:${kind}`);
        const active = requireRuntime();
        if (kind === "voices") {
          // 热榜对所有用户是同一批，提炼结果因此可跨用户复用——服务端缓存足以吸收重复请求。
          const feed = await active.homeFeed.feed({ limit: SEED_TOPIC_LIMIT });
          return writeJson(response, 200, await active.entrySeeds.execute({
            kind,
            topics: feed.items.map((item) => item.title),
          }));
        }
        await requireWebLogin(request);
        const seeds = await withAuthorizedUser(request, response, async (userData) => {
          const collections = await userData.recentCollections({ limit: SEED_TOPIC_LIMIT });
          return active.entrySeeds.execute({
            kind,
            topics: collections.items.map((item) => item.title),
          });
        });
        return writeJson(response, 200, seeds);
      }
      // 深度研究（网页端）：只承接 Pro 单次直答。Ultra 由自研引擎在本机运行面执行，
      // 本侧不承接时如实拒绝，而不是静默降级成 Pro 或返回注定失败的 202。
      if (deps.researchProEnabled === true && url.pathname === "/api/research-tasks" && request.method === "POST") {
        await requireWebLogin(request);
        await enforceRateLimit(request, response, "research-pro");
        const active = requireRuntime();
        const body = asRequest(await readJson(request));
        const tier = readResearchTier(body.tier);
        if (tier !== "pro") {
          throw new ProductError(
            "RESEARCH_TIER_UNAVAILABLE",
            tier === "ultra"
              ? "Ultra 研究不在网页端运行，请改用 Pro。"
              : "该研究档位不可用，请改用 Pro。",
          );
        }
        const result = await active.researchPro.execute({
          requestId: readRequiredString(body.requestId, "缺少请求标识。"),
          question: readRequiredString(body.question, "研究问题不能为空。"),
        });
        return writeJson(response, 200, { ok: true, data: result.detail });
      }
      // 网页端任务列表：服务端不落库，因此没有可恢复的历史。
      // 返回空列表而不是 404——前端刷新时会用它尝试恢复上一次研究，404 会被当成错误展示。
      if (deps.researchProEnabled === true && url.pathname === "/api/research-tasks" && request.method === "GET") {
        return writeJson(response, 200, { ok: true, data: { items: [], hasMore: false } });
      }
      // 成象（概念动画）：生成同时消耗知乎搜索与模型两类额度，网页端要求登录；
      // 生成请求额外限流（读取历史不烧额度，不放限流）。记录按会话用户 scope 隔离。
      if (deps.conceptAnimation && isConceptAnimationPath(url.pathname)) {
        await requireWebLogin(request);
        if (url.pathname === "/api/concept-animation" && request.method === "POST") {
          await enforceRateLimit(request, response, "concept-animation");
        }
        const scope = await conceptAnimationScope(request);
        return await deps.conceptAnimation.handle(scope, url, request, response);
      }
      return false;
    } catch (error) {
      if (isProductError(error)) {
        const status = error.code === "AUTH_REQUIRED" || error.code === "AUTH_INVALID" ? 401 : 400;
        return writeJson(response, status, { code: error.code, message: error.message, detail: error.detail });
      }
      throw error;
    }
  };
}

function callbackUrl(config: OAuthAppConfig): URL {
  try {
    return new URL(config.redirectUri);
  } catch {
    throw new ProductError("INVALID_INPUT", "ZHIHU_OAUTH_REDIRECT_URI 不是合法地址。");
  }
}

/** 研究档位：非法值按不可用处理，交给调用方如实拒绝，不猜一个默认档位。 */
function readResearchTier(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 成象相关路径：生成、历史列表与单条记录。 */
function isConceptAnimationPath(pathname: string): boolean {
  return pathname === "/api/concept-animation" || pathname === "/api/concept-animations" || pathname.startsWith("/api/concept-animations/");
}

/** 入口类型：只认已知的两个入口，其余（含缺失）按深度研究处理——
 *  老客户端与手写请求不必都带上这个参数。 */
function readEntrySeedKind(value: string | null): EntrySeedKind {
  const matched = ENTRY_SEED_KINDS.find((kind) => kind === value);
  return matched ?? "research";
}

/** 众声的检索范围与时间范围是预置选项，非法值一律按默认处理，不做自由填写。 */
function readVoicesScope(value: unknown): "zhihu" | "web" {
  return value === "web" ? "web" : "zhihu";
}
/** 首页内容流的类型筛选项，非法值按「全部」。 */
function readHomeFeedType(value: string | null): "all" | "answer" | "article" {
  return value === "answer" || value === "article" ? value : "all";
}

/** 首页问答只有两档：快速与深度思考。 */
function readHomeAnswerTier(value: unknown): "fast" | "thinking" {
  return value === "thinking" ? "thinking" : "fast";
}

function readVoicesRecency(value: unknown): "any" | "7d" | "1m" | "3m" {
  return value === "7d" || value === "1m" || value === "3m" ? value : "any";
}
