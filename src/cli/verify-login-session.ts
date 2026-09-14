/**
 * 登录会话链路验证：用假上游驱动真实处理器，覆盖
 * 「回调换令牌 → 设置会话 cookie → 带 cookie 读会话」整条链路。
 * 只验证产品的会话行为，不代表真实知乎授权。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRuntime } from "../application/runtime.ts";
import { createZhihuApiHandler } from "../server/zhihu-api.ts";
import { createMemorySessionStore } from "../server/session-store.ts";
import { SESSION_COOKIE } from "../server/http-utils.ts";

const failures: string[] = [];
const check = (c: unknown, m: string) => { if (!c) failures.push(m); };

const orig = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("/access_token")) {
    return new Response(JSON.stringify({ access_token: "tok-abc", token_type: "Bearer", expires_in: 3600 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  // /user 端点（会话里读昵称头像）
  if (url.includes("/user")) return new Response(JSON.stringify({ fullname: "测试用户", hash_id: "h1" }), { status: 200 });
  return new Response(JSON.stringify({}), { status: 200 });
}) as typeof globalThis.fetch;

type Cap = { status?: number; body?: unknown; headers?: Record<string, string> };
const makeRes = () => {
  const cap: Cap = { headers: {} };
  const response = {
    setHeader(n: string, v: string) { cap.headers![n] = v; },
    writeHead(s: number, h?: Record<string, string>) {
      cap.status = s;
      // 按 Node 语义：writeHead 的 headers 与 setHeader 合并，同名以 writeHead 优先
      if (h) for (const [k, v] of Object.entries(h)) cap.headers![k] = v;
      return response;
    },
    end(b?: string) { if (b !== undefined) { try { cap.body = JSON.parse(b); } catch { cap.body = b; } } return response; },
  } as unknown as ServerResponse;
  return { response, cap };
};
const makeReq = (cookie?: string, path = "/", method = "GET"): IncomingMessage =>
  ({ method, url: path, headers: cookie ? { cookie } : {} }) as unknown as IncomingMessage;

const sessions = createMemorySessionStore();
const runtime = createRuntime({ accessSecret: "s" });
const oauthConfig = { appId: "420", appKey: "k", redirectUri: "https://example.test/api/auth/callback" };
const handle = createZhihuApiHandler({ runtime, oauthConfig, sessions, capabilities: ["user_data"], surface: "web" });

// 1) 未登录读会话
{
  const { response, cap } = makeRes();
  await handle(new URL("https://example.test/api/auth/session"), makeReq(undefined, "/api/auth/session"), response);
  check((cap.body as any)?.authenticated === false, "未登录时 authenticated 应为 false");
}

// 2) 回调：应 302 且设置会话 cookie
let cookie = "";
{
  const { response, cap } = makeRes();
  await handle(new URL("https://example.test/api/auth/callback?authorization_code=code1"),
    makeReq(undefined, "/api/auth/callback"), response);
  check(cap.status === 302, `回调应 302，实际 ${cap.status}`);
  const sc = cap.headers!["Set-Cookie"] ?? "";
  check(sc.startsWith(`${SESSION_COOKIE}=`), `回调应设置 ${SESSION_COOKIE} cookie，实际 "${sc.slice(0, 60)}"`);
  check(sc.includes("Path=/"), "cookie 应带 Path=/");
  cookie = sc.split(";")[0] ?? "";
}

// 3) 带 cookie 读会话：必须认出已登录
{
  const { response, cap } = makeRes();
  await handle(new URL("https://example.test/api/auth/session"), makeReq(cookie, "/api/auth/session"), response);
  check((cap.body as any)?.authenticated === true, `带会话 cookie 应认出已登录，实际 ${JSON.stringify(cap.body)?.slice(0, 120)}`);
}

// 4) 带 cookie 取个人数据：不应再 401
{
  const { response, cap } = makeRes();
  await handle(new URL("https://example.test/api/user/contents"), makeReq(cookie, "/api/user/contents"), response);
  check(cap.status !== 401, `已登录取个人数据不应 401，实际 ${cap.status}`);
}

// 5) 登出后应失效
{
  const a = makeRes();
  await handle(new URL("https://example.test/api/auth/logout"), makeReq(cookie, "/api/auth/logout", "POST"), a.response);
  const b = makeRes();
  await handle(new URL("https://example.test/api/auth/session"), makeReq(cookie, "/api/auth/session"), b.response);
  check((b.cap.body as any)?.authenticated === false, "登出后 authenticated 应为 false");
}

globalThis.fetch = orig;
if (failures.length) { for (const f of failures) console.error("✗ " + f); process.exit(1); }
console.log(JSON.stringify({ ok: true, checks: "login-session" }));
