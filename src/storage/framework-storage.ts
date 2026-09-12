import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LibSQLStore } from "@mastra/libsql";

export const PRODUCT_SCHEMA_VERSION = 1;

/**
 * 解析产品数据目录。生产路径必须绝对；相对路径仅用于开发，按进程工作目录解析。
 * 中文、空格与盘符在 DR-00 隔离实验中覆盖，持久化 URL 必须经 pathToFileURL 构造。
 */
export function resolveDataDir(rawDir: string): string {
  const dir = rawDir.trim();
  if (!dir) {
    throw new Error("缺少数据目录配置。");
  }
  return resolve(dir);
}

export type FrameworkStorage = {
  store: LibSQLStore;
  runtimeDbPath: string;
  close(): Promise<void>;
};

/**
 * 打开框架本地存储（runtime.sqlite）。只服务 Mastra 快照与消息历史，
 * 产品业务事实由 product.sqlite 另行持有，两库不共享事务。
 * autoRestartActiveRuns 由 Mastra 装配负责；这里不重建任何数据。
 */
export async function openFrameworkStorage(dataDir: string): Promise<FrameworkStorage> {
  const dir = resolveDataDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const runtimeDbPath = join(dir, "runtime.sqlite");
  const store = new LibSQLStore({
    id: "zhihu-runtime-store",
    url: pathToFileURL(runtimeDbPath).href,
  });
  await store.init();
  return {
    store,
    runtimeDbPath,
    async close() {
      await store.close();
    },
  };
}
