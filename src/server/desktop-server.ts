import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalServer } from "./local-server.ts";

/**
 * 桌面端后端入口：由 Electron 主进程以 ELECTRON_RUN_AS_NODE=1 spawn 运行。
 * 与 dev 入口的差异只有三处：端口 0（系统分配，并行会话不抢 4301）、
 * 数据目录在 userData（RESEARCH_DATA_DIR 由主进程指定）、就绪后把实际端口写到 stdout。
 * BYOK 配置读取顺序：进程环境变量 > KANSHAN_ENV_FILE（userData/.env） > cwd/.env。
 */

const dataDir = process.env.RESEARCH_DATA_DIR?.trim();
if (!dataDir) {
  console.error("[desktop-server] 缺少 RESEARCH_DATA_DIR，无法确定数据目录。");
  process.exit(1);
}

loadEnvFile(process.env.KANSHAN_ENV_FILE);
loadEnvFile(resolve(process.cwd(), ".env"));

const webRoot = resolve(fileURLToPath(new URL("../workbench", import.meta.url)));

const server = await startLocalServer({
  host: "127.0.0.1",
  port: 0,
  dataDir,
  webRoot,
});

const shutdown = () => {
  void server.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

// 主进程靠这一行拿到实际端口；必须保持格式稳定。
console.log(`BACKEND_PORT=${server.port}`);

function loadEnvFile(path: string | undefined): void {
  if (!path || !existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(index + 1).trim();
  }
}
