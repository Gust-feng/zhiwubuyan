import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { createRuntime } from "../application/runtime.ts";
import { createMemorySharedCache } from "../application/shared-cache.ts";
import { isProductError, ProductError } from "../platform/zhihu/errors.ts";
import { readOAuthAppConfig, missingOAuthConfig, oauthRedirectUri } from "../platform/zhihu/oauth.ts";
import { startResearchBackend, type ResearchBackend } from "../backend/index.ts";
import { CreateResearchTaskInput, type CreateResearchTaskInput as CreateResearchTaskInputType } from "../contracts/research.ts";
import { ResearchApiError } from "../application/deep-research.ts";
import { openZhihuCredentialStore } from "../storage/zhihu-credential-store.ts";
import { createMemorySessionStore } from "./session-store.ts";
import { createZhihuApiHandler } from "./zhihu-api.ts";
import { createFileHomeFeedCacheStore, homeFeedCachePath } from "../storage/home-feed-cache.ts";
import { createFilePersonalArchiveStore, personalArchiveDir } from "../storage/personal-archive-store.ts";
import {
  asRequest,
  readJson,
  readJsonLimited,
  readOptionalInt,
  readRequiredString,
  writeJson,
} from "./http-utils.ts";

export type LocalServerOptions = {
  host: string;
  /** 传 0 由操作系统分配端口：桌面端多实例并行时不能抢占固定端口。 */
  port: number;
  dataDir: string;
  webRoot: string;
};

export type LocalServer = {
  /** 实际监听端口（port=0 时为系统分配值）。 */
  readonly port: number;
  readonly research: ResearchBackend;
  close(): Promise<void>;
};

/**
 * 本地全量服务器：深度研究 + 知乎系接口 + 轻简报 + 工作台静态资源。
 * dev 入口（http-server.ts）与桌面端入口（desktop-server.ts）共用，差异只在端口与数据目录。
 * 环境变量由调用方先行加载（.env 解析属于入口职责）。
 */
export async function startLocalServer(options: LocalServerOptions): Promise<LocalServer> {
  const { host, dataDir, webRoot } = options;
  const desktopEdition = process.env.KANSHAN_EDITION?.trim() === "desktop";
  // 知乎调用凭证由本机数据目录中的配置文件或环境变量提供，进程启动时解析一次。
  const credentials = openZhihuCredentialStore(dataDir, process.env.ZHIHU_ACCESS_SECRET ?? null);
  const hotCacheStore = createFileHomeFeedCacheStore(homeFeedCachePath(dataDir));
  const personalArchiveStore = createFilePersonalArchiveStore(personalArchiveDir(dataDir));
  // 单进程运行面：单飞用进程内实现即可；档案落盘由文件实现承担。
  const archiveLock = createMemorySharedCache();
  const sessions = createMemorySessionStore();
  const developerUserDataEnabled =
    process.env.NODE_ENV === "development"
    && process.env.ZHIHU_DEV_USER_DATA?.trim() === "1"
    && !desktopEdition;

  // 调用凭证在网关创建时固化在 identity 里；进程启动时读取一次即可。
  const accessSecret = credentials.read();
  const runtime = accessSecret === null || accessSecret === ""
    ? undefined
    : createRuntime({ accessSecret, hotCacheStore, personalArchiveStore, archiveLock });
  const handleZhihuApi = createZhihuApiHandler({
    runtime,
    oauthConfig: readOAuthAppConfig(process.env),
    oauthMissingConfig: missingOAuthConfig(process.env),
    oauthRedirectUri: oauthRedirectUri(process.env),
    sessions,
    developerUserDataEnabled,
    // 本机运行面同时承接 Pro 与自研 Ultra 引擎，因此额外声明 research_ultra；
    // 网页端只声明 research（Pro 单次直答），档位菜单据此不列出 Ultra。
    capabilities: ["zhihu_search", "global_search", "hot_list", "user_data", "research_brief", "voices", "research", "research_ultra"],
    // 运行面同时决定登录形态：桌面端独立窗口，网页端应用内弹窗。
    surface: desktopEdition ? "desktop" : "web",
  });

  // 深度研究后端：目录独占 + 产品库 + 启动收敛。无模型凭证时仅本地读取可用。
  const research = await startResearchBackend({
    dataDir,
    zhihuAccessSecret: () => credentials.read(),
    model:
      process.env.MODEL_API_KEY?.trim() && process.env.MODEL_API_BASE_URL?.trim() && process.env.MODEL_PROFILE_MODEL_ID?.trim()
        ? {
            baseUrl: process.env.MODEL_API_BASE_URL.trim(),
            modelId: process.env.MODEL_PROFILE_MODEL_ID.trim(),
            apiKey: process.env.MODEL_API_KEY.trim(),
          }
        : null,
    modelProviderLabel: process.env.MODEL_PROVIDER?.trim() || "openai-compatible",
  });
  if (research.recoveredTaskIds.length > 0) {
    console.log(`[research] 重启收敛：${research.recoveredTaskIds.length} 个未完成任务标记为 interrupted。`);
  }

  const requireRuntime = () => {
    if (!runtime) throw new ProductError("AUTH_REQUIRED", "尚未配置知乎开放平台凭证。");
    return runtime;
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
      if (await handleResearchRoutes(research, url, request, response)) {
        return;
      }
      if (await handleZhihuApi(url, request, response)) {
        return;
      }
      // 轻研究简报（内存两步会话）只在本地长驻进程可用，不上网页端。
      if (url.pathname === "/api/research/sessions" && request.method === "POST") {
        const active = requireRuntime();
        const body = asRequest(await readJson(request));
        const session = await active.researchSessions.begin({
          question: readRequiredString(body.question, "研究问题不能为空。"),
          includeGlobal: body.includeGlobal !== false,
          includeHot: body.includeHot === true,
        });
        return writeJson(response, 200, session);
      }
      if (url.pathname === "/api/research/brief" && request.method === "POST") {
        const active = requireRuntime();
        const body = asRequest(await readJson(request));
        const selectedIds = Array.isArray(body.selectedIds)
          ? body.selectedIds.filter((value): value is string => typeof value === "string")
          : [];
        const brief = active.researchSessions.buildBrief({
          sessionId: readRequiredString(body.sessionId, "缺少研究会话。"),
          selectedIds,
        });
        return writeJson(response, 200, brief);
      }
      if (url.pathname.startsWith("/api/")) {
        return writeJson(response, 404, { code: "NOT_FOUND", message: "接口不存在。" });
      }
      return serveWeb(webRoot, url.pathname, response);
    } catch (error) {
      if (isProductError(error)) {
        const status = error.code === "AUTH_REQUIRED" || error.code === "AUTH_INVALID" ? 401 : 400;
        return writeJson(response, status, { code: error.code, message: error.message, detail: error.detail });
      }
      console.error(error);
      return writeJson(response, 500, { code: "INTERNAL_ERROR", message: "服务暂时不可用。" });
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;

  let closePromise: Promise<void> | undefined;
  return {
    port,
    research,
    close: () => {
      closePromise ??= new Promise<void>((resolveClose) => {
        server.close(async () => {
          await research.close();
          resolveClose();
        });
      });
      return closePromise;
    },
  };
}

// ---------------------------------------------------------------------------
// 深度研究路由：薄路由只做解析、调用一个应用命令、映射响应。
// ---------------------------------------------------------------------------

const RESEARCH_TASK_PREFIX = "/api/research-tasks/";

async function handleResearchRoutes(
  research: ResearchBackend,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const pathname = url.pathname;
  const engine = research.engine;
  try {
    if (pathname === "/api/research-tasks" && request.method === "POST") {
      const body = (await readJsonLimited(request, 16 * 1024)) as Record<string, unknown>;
      const normalized = {
        ...(body as object),
        question: typeof (body as Record<string, unknown>).question === "string"
          ? ((body as Record<string, unknown>).question as string).trim()
          : (body as Record<string, unknown>).question,
      };
      const input: CreateResearchTaskInputType = CreateResearchTaskInput.parse(normalized);
      const { detail, accepted } = await engine.createResearchTask(input);
      // 202 表示已受理异步执行；同步完成的快答与幂等重放返回 200。
      const httpStatus = detail.status === "completed" || detail.status === "failed" ? 200 : accepted ? 202 : 200;
      return writeJson(response, httpStatus, { ok: true, data: detail });
    }
    if (pathname === "/api/research-tasks" && request.method === "GET") {
      const limit = readOptionalInt(url.searchParams.get("limit"), 20);
      const offset = readOptionalInt(url.searchParams.get("offset"), 0);
      const result = await engine.listResearchTasks({ limit, offset });
      return writeJson(response, 200, { ok: true, data: result });
    }
    if (pathname.startsWith(RESEARCH_TASK_PREFIX)) {
      const rest = pathname.slice(RESEARCH_TASK_PREFIX.length);
      const [taskId, action] = rest.split("/");
      if (!taskId) return false;
      if (!action && request.method === "GET") {
        const detail = await engine.getResearchTaskDetail(taskId);
        return writeJson(response, 200, { ok: true, data: detail });
      }
      if (action === "cancel" && request.method === "POST") {
        await readJsonLimited(request, 16 * 1024);
        const { detail, httpStatus } = await engine.cancelResearchTask(taskId);
        return writeJson(response, httpStatus, { ok: true, data: detail });
      }
      if (action === "sources" && request.method === "GET") {
        const result = await engine.listResearchSources(taskId);
        return writeJson(response, 200, { ok: true, data: result });
      }
      if (action === "report" && request.method === "GET") {
        const report = await engine.getResearchReport(taskId);
        return writeJson(response, 200, { ok: true, data: report });
      }
      if (action === "report.md" && request.method === "GET") {
        const markdown = await engine.exportResearchReportMarkdown(taskId);
        response.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
        response.end(markdown);
        return true;
      }
    }
    return false;
  } catch (error) {
    if (error instanceof ResearchApiError) {
      return writeJson(response, error.status, {
        ok: false,
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
      });
    }
    if (error instanceof Error && error.name === "ZodError") {
      return writeJson(response, 400, {
        ok: false,
        error: { code: "INVALID_INPUT", message: "请求参数不符合契约。" },
      });
    }
    throw error;
  }
}

function serveWeb(webRoot: string, pathname: string, response: ServerResponse, label = "前端"): void {
  if (!existsSync(webRoot)) {
    return void writeJson(response, 503, { code: "WEB_NOT_BUILT", message: `${label}尚未构建，请运行 pnpm build。` });
  }
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let file = join(webRoot, safe);
  if (!file.startsWith(webRoot) || !isFile(file)) file = join(webRoot, "index.html");
  if (!isFile(file)) {
    return void writeJson(response, 503, { code: "WEB_NOT_BUILT", message: `${label}尚未构建，请运行 pnpm build。` });
  }
  // 构建中产物可能被整体替换（emptyOutDir），stat 与流打开之间存在竞态，流错误必须兜底而非打挂进程。
  const stream = createReadStream(file);
  stream.on("error", () => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    writeJson(response, 500, { code: "INTERNAL_ERROR", message: "资源读取失败，请重试。" });
  });
  response.writeHead(200, { "Content-Type": contentType(file) });
  stream.pipe(response);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".gif": return "image/gif";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}
