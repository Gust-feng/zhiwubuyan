import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 知乎开放平台调用凭证：由环境变量或本机数据目录中的配置文件提供，进程启动时解析一次。
 * 凭证决定调用方额度与数据归属，只存本机数据目录，不回传前端、不写入任务或日志。
 */
export type StoredZhihuCredential = {
  readonly accessSecret: string;
  /** 配置文件中的保存时间；来自环境变量的初始值没有该字段。 */
  readonly updatedAt?: string;
};

export type ZhihuCredentialStore = {
  /** 当前生效的调用凭证；未配置时为 null。 */
  read(): string | null;
};

const CONFIG_FILE = "zhihu-credential.json";

/** 读取调用凭证：本机配置文件优先，其次为环境变量提供的初始值。 */
export function openZhihuCredentialStore(dataDir: string, fallback: string | null): ZhihuCredentialStore {
  const current = readStored(join(dataDir, CONFIG_FILE)) ??
    (fallback === null || fallback.trim() === "" ? null : { accessSecret: fallback.trim() });
  return {
    read: () => current?.accessSecret ?? null,
  };
}

function readStored(file: string): StoredZhihuCredential | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredZhihuCredential> | null;
    if (parsed === null || typeof parsed !== "object") return null;
    const accessSecret = typeof parsed.accessSecret === "string" ? parsed.accessSecret.trim() : "";
    // 凭证损坏或为空按未配置处理；不猜测旧值。
    if (accessSecret === "") return null;
    return {
      accessSecret,
      ...(typeof parsed.updatedAt === "string" ? { updatedAt: parsed.updatedAt } : {}),
    };
  } catch {
    return null;
  }
}
