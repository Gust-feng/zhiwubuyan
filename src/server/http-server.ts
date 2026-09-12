import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalServer } from "./local-server.ts";

// `pnpm dev:api` is the explicit local development entry point. Its ACS
// preview switch is injected here as well as by `pnpm dev` so a standalone
// API process follows the same developer behavior without affecting `start`
// or the desktop backend.
if (process.env.npm_lifecycle_event === "dev:api") {
  process.env.NODE_ENV ??= "development";
  process.env.ZHIHU_DEV_USER_DATA ??= "1";
}

loadLocalEnv();

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 4301);
const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const server = await startLocalServer({
  host,
  port,
  dataDir: resolve(process.env.RESEARCH_DATA_DIR ?? join(projectRoot, "data")),
  webRoot: join(projectRoot, "dist", "workbench"),
});

const shutdown = (signal: string) => {
  console.log(`[server] 收到 ${signal}，停止派发并关闭。`);
  void server.close().finally(() => process.exit(0));
  // 兜底：活动请求结束后仍未退出则直接结束。
  setTimeout(() => {
    void server.close().finally(() => process.exit(0));
  }, 5_000).unref();
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

console.log(`API ready at http://${host}:${server.port}`);

function loadLocalEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(index + 1).trim();
  }
}
