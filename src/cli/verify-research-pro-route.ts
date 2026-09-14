/**
 * 网页面深度研究 Pro 的路由级验证：用假上游（接管全局 fetch）与内存会话真实驱动
 * `createZhihuApiHandler`，覆盖「Pro 单次直答 → 终端结果」「Ultra 如实拒绝」
 * 「任务列表为空」「未登录拒绝」四条边界。
 *
 * 假上游按知乎直答的 OpenAI 兼容外壳返回；验证的是产品的承接与拒绝规则，
 * 不代表真实直答内容质量，也不消耗真实额度。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRuntime } from "../application/runtime.ts";
import { createZhihuApiHandler } from "../server/zhihu-api.ts";
import { createMemorySessionStore } from "../server/session-store.ts";
import { SESSION_COOKIE } from "../server/http-utils.ts";

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

const calls: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  calls.push(url);
  const body = typeof init?.body === "string" ? init.body : "";
  if (url.includes("/v1/chat/completions")) {
    const parsed = JSON.parse(body) as { model?: string };
    return new Response(
      JSON.stringify({
        model: parsed.model,
        choices: [{ message: { role: "assistant", content: "直答正文。", }, finish_reason: "stop" }],
        usage: { prompt_tokens: 7, completion_tokens: 11 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ Code: 10001, Message: `unexpected ${url}`, Data: {} }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof globalThis.fetch;

type Captured = { status?: number; body?: unknown; headers?: Record<string, string> };

function makeRequest(cookie: string | undefined, path: string, method: string, body?: unknown): IncomingMessage {
  return {
    method,
    url: path,
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body), "utf8");
    },
  } as unknown as IncomingMessage;
}

function makeResponse(): { response: ServerResponse; captured: Captured } {
  const captured: Captured = { headers: {} };
  const response = {
    setHeader(name: string, value: string) {
      captured.headers![name] = value;
    },
    writeHead(status: number) {
      captured.status = status;
    },
    end(body?: string) {
      captured.body = body === undefined ? undefined : JSON.parse(body);
      return this;
    },
  } as unknown as ServerResponse;
  return { response, captured };
}

try {
  const sessions = createMemorySessionStore();
  const sessionId = await sessions.create({
    accessToken: "oauth-token-pro",
    tokenType: "Bearer",
    expiresAt: Date.now() + 3600_000,
  });
  const runtime = createRuntime({ accessSecret: "test-secret" });
  const handle = createZhihuApiHandler({
    runtime,
    oauthConfig: undefined,
    sessions,
    capabilities: ["user_data", "research"],
    surface: "web",
    researchProEnabled: true,
  });

  // —— Pro：单次直答，返回终端 TaskDetail ——
  const pro = makeResponse();
  const proHandled = await handle(
    new URL("https://example.test/api/research-tasks"),
    makeRequest(`${SESSION_COOKIE}=${sessionId}`, "/api/research-tasks", "POST", {
      requestId: "11111111-1111-4111-8111-111111111111",
      question: "为什么要给上游调用做缓存？",
      allowWebSupplement: false,
      tier: "pro",
    }),
    pro.response,
  );
  check(proHandled === true, "网页端应承接 /api/research-tasks");
  check(pro.captured.status === 200, `Pro 提交应返回 200，实际 ${pro.captured.status}`);
  const envelope = pro.captured.body as { ok?: boolean; data?: { status?: string; tier?: string; answer?: { content?: string } | null; sourceCount?: number } } | undefined;
  check(envelope?.ok === true, "响应应使用 {ok,data} 外壳");
  check(envelope?.data?.status === "completed", "Pro 应在创建时即为 completed（无需轮询）");
  check(envelope?.data?.tier === "pro", "产出档位应为 pro");
  check((envelope?.data?.answer?.content ?? "").length > 0, "应带上直答正文");
  const chatCalls = calls.filter((url) => url.includes("/v1/chat/completions"));
  check(chatCalls.length === 1, `Pro 应只调用一次直答，实际 ${chatCalls.length}`);

  // —— Ultra：本侧不承接，如实拒绝（而不是静默降级成 Pro） ——
  const beforeUltra = calls.filter((url) => url.includes("/v1/chat/completions")).length;
  const ultra = makeResponse();
  await handle(
    new URL("https://example.test/api/research-tasks"),
    makeRequest(`${SESSION_COOKIE}=${sessionId}`, "/api/research-tasks", "POST", {
      requestId: "22222222-2222-4222-8222-222222222222",
      question: "跑一次 Ultra。",
      allowWebSupplement: false,
      tier: "ultra",
    }),
    ultra.response,
  );
  const ultraBody = ultra.captured.body as { code?: string } | undefined;
  check(ultraBody?.code === "RESEARCH_TIER_UNAVAILABLE", `Ultra 应以 RESEARCH_TIER_UNAVAILABLE 拒绝，实际 ${ultraBody?.code}`);
  check(
    calls.filter((url) => url.includes("/v1/chat/completions")).length === beforeUltra,
    "被拒的 Ultra 请求不应触达直答",
  );

  // —— 任务列表：网页端不落库，返回空而不是 404 ——
  const list = makeResponse();
  await handle(
    new URL("https://example.test/api/research-tasks?limit=20&offset=0"),
    makeRequest(`${SESSION_COOKIE}=${sessionId}`, "/api/research-tasks?limit=20&offset=0", "GET"),
    list.response,
  );
  check(list.captured.status === 200, `任务列表应返回 200，实际 ${list.captured.status}`);
  const listBody = list.captured.body as { data?: { items?: unknown[] } } | undefined;
  check(Array.isArray(listBody?.data?.items) && listBody!.data!.items!.length === 0, "网页端任务列表应为空");

  // —— 未登录：额度挂在部署方账号上，不能匿名消耗 ——
  const anonymous = makeResponse();
  await handle(
    new URL("https://example.test/api/research-tasks"),
    makeRequest(undefined, "/api/research-tasks", "POST", {
      requestId: "33333333-3333-4333-8333-333333333333",
      question: "匿名提问。",
      allowWebSupplement: false,
      tier: "pro",
    }),
    anonymous.response,
  );
  check(anonymous.captured.status === 401, `未登录提交应返回 401，实际 ${anonymous.captured.status}`);

  // —— 开关关闭：本机运行面之外的调用方不应意外获得该路由 ——
  const disabled = createZhihuApiHandler({
    runtime,
    oauthConfig: undefined,
    sessions,
    capabilities: ["research"],
    surface: "web",
  });
  const off = makeResponse();
  const offHandled = await disabled(
    new URL("https://example.test/api/research-tasks"),
    makeRequest(`${SESSION_COOKIE}=${sessionId}`, "/api/research-tasks", "GET"),
    off.response,
  );
  check(offHandled === false, "未开启 Pro 时不应承接该路由");
} finally {
  globalThis.fetch = originalFetch;
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: "research-pro-route" }));
