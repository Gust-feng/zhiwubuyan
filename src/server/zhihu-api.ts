import type { IncomingMessage, ServerResponse } from "node:http";
import { isProductError, ProductError } from "../platform/zhihu/errors.ts";
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  readAuthorizationCode,
} from "../platform/zhihu/oauth.ts";
import type { OAuthAppConfig, OAuthToken } from "../platform/zhihu/oauth.ts";
import type { UserDataGateway } from "../platform/zhihu/user-data.ts";
import type { createRuntime } from "../application/runtime.ts";
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
  /** 网页端热榜走 CDN 共享缓存（如 "public, s-maxage=3600"）；本地不传。 */
  hotCacheControl?: string;
};

/**
 * 知乎系共享路由：本地服务器与 Vercel 函数共用同一实现。
 * 只依赖知乎开放平台，不触碰深度研究后端；命中返回 true，未命中返回 false。
 */
export function createZhihuApiHandler(deps: ZhihuApiDeps) {
  const { runtime, oauthConfig, sessions, developerUserDataEnabled = false } = deps;
  const oauthCallback = oauthConfig ? callbackUrl(oauthConfig) : undefined;

  async function activeSession(request: IncomingMessage): Promise<OAuthToken | undefined> {
    return sessions.read(readSessionId(request), Date.now());
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

  /** 圈子社区走独立的 app_key/app_secret 签名，与开放平台凭证不共用。 */
  function requireCircles() {
    const active = requireRuntime();
    if (!active.circles) throw new ProductError("AUTH_REQUIRED", "尚未配置知乎社区 API 凭证。");
    return active.circles;
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
          capabilities: deps.capabilities,
          auth: { oauthEnabled: oauthConfig !== undefined },
        });
      }
      if (url.pathname === "/api/auth/session" && request.method === "GET") {
        const session = await activeSession(request);
        return writeJson(response, 200, {
          oauthEnabled: oauthConfig !== undefined,
          authenticated: session !== undefined || (developerUserDataEnabled && runtime !== undefined),
          developerMode: developerUserDataEnabled && runtime !== undefined,
          expiresAt: session ? new Date(session.expiresAt).toISOString() : undefined,
        });
      }
      if (url.pathname === "/api/auth/authorize" && request.method === "GET") {
        if (!oauthConfig) throw new ProductError("AUTH_REQUIRED", "知乎账号登录尚未配置。");
        redirect(response, 302, buildAuthorizeUrl(oauthConfig));
        return true;
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        await sessions.drop(readSessionId(request));
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
        const feed = await active.homeFeed.feed({
          topic: readOptionalString(url.searchParams.get("topic")),
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
        const active = requireRuntime();
        const body = asRequest(await readJson(request));
        const answer = await active.homeAnswer.execute({
          question: readRequiredString(body.question, "问题不能为空。"),
          tier: readHomeAnswerTier(body.tier),
        });
        return writeJson(response, 200, answer);
      }
      if (url.pathname === "/api/user/collections" && request.method === "GET") {
        const result = await withAuthorizedUser(request, response, (userData) => userData.recentCollections({ limit: 10 }));
        return writeJson(response, 200, result);
      }
      if (url.pathname === "/api/user/contents" && request.method === "GET") {
        const result = await withAuthorizedUser(request, response, (userData) => userData.myContents({ limit: 10 }));
        return writeJson(response, 200, result);
      }
      if (url.pathname === "/api/user/followees" && request.method === "GET") {
        const result = await withAuthorizedUser(request, response, (userData) => userData.followees({ limit: 10 }));
        return writeJson(response, 200, result);
      }
      // 官方「问题路由」：按当前账号画像推荐适合回答的问题（creator 额度组，每日有限）。
      if (url.pathname === "/api/user/recommendations" && request.method === "GET") {
        const result = await withAuthorizedUser(request, response, (userData) => userData.questionRecommendations({ count: 10 }));
        return writeJson(response, 200, result);
      }
      if (url.pathname === "/api/research/voices" && request.method === "POST") {
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
      // 主题由前端传入（就是它屏幕上正在展示的那几条收藏标题）：
      // 后端不再读一次用户数据，路由本身只做「主题 → 研究问题」这一步提炼。
      if (url.pathname === "/api/research/seed-questions" && request.method === "POST") {
        const active = requireRuntime();
        const body = asRequest(await readJson(request));
        const raw = Array.isArray(body.topics) ? body.topics : [];
        const seeds = await active.seedQuestions.execute({
          topics: raw.filter((topic): topic is string => typeof topic === "string"),
        });
        return writeJson(response, 200, seeds);
      }
      // 圈子社区：只读浏览白名单圈子的内容流与黑客松故事；写操作不在本路由范围内。
      if (url.pathname === "/api/circles" && request.method === "GET") {
        return writeJson(response, 200, { rings: requireCircles().listRings() });
      }
      if (url.pathname === "/api/circles/posts" && request.method === "GET") {
        const feed = await requireCircles().readRing({
          ringId: readRequiredString(url.searchParams.get("ringId"), "请指定要查看的圈子。"),
          page: readOptionalInt(url.searchParams.get("page"), 1),
          pageSize: readOptionalInt(url.searchParams.get("pageSize"), 20),
        });
        return writeJson(response, 200, feed);
      }
      if (url.pathname === "/api/circles/stories" && request.method === "GET") {
        return writeJson(response, 200, { stories: await requireCircles().listStories() });
      }
      if (url.pathname === "/api/circles/story" && request.method === "GET") {
        const story = await requireCircles().readStory({
          workId: readRequiredString(url.searchParams.get("workId"), "请指定要阅读的故事。"),
        });
        return writeJson(response, 200, story);
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
