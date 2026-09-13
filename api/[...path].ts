import type { IncomingMessage, ServerResponse } from "node:http";
import { Redis } from "@upstash/redis";
import { createRuntime } from "../src/application/runtime.ts";
import { readOAuthAppConfig } from "../src/platform/zhihu/oauth.ts";
import { createZhihuApiHandler } from "../src/server/zhihu-api.ts";
import { createKvSessionStore, createMemorySessionStore, type SessionStore } from "../src/server/session-store.ts";
import { writeJson } from "../src/server/http-utils.ts";

// 知乎 OAuth token 只存服务端 KV；本地预览未接 KV 时退回进程内存（单实例，仅供联调）。
function createSessions(): SessionStore {
  const url = process.env.KV_REST_API_URL?.trim();
  const token = process.env.KV_REST_API_TOKEN?.trim();
  if (!url || !token) return createMemorySessionStore();
  return createKvSessionStore(new Redis({ url, token }));
}

const accessSecret = process.env.ZHIHU_ACCESS_SECRET?.trim();

const handleZhihuApi = createZhihuApiHandler({
  runtime: accessSecret ? createRuntime({ accessSecret }) : undefined,
  oauthConfig: readOAuthAppConfig(process.env),
  sessions: createSessions(),
  capabilities: ["zhihu_search", "global_search", "hot_list", "user_data", "voices"],
  hotCacheControl: "public, s-maxage=3600, stale-while-revalidate=300",
});

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `https://${request.headers.host ?? "localhost"}`);
  if (await handleZhihuApi(url, request, response)) return;
  writeJson(response, 404, { code: "NOT_FOUND", message: "接口不存在。" });
}
