import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 深度研究模型配置：由环境变量或本机数据目录中的配置文件提供，进程启动时解析一次。
 * 一个研究模型只有一组凭证（ADR-0007 的 BYOK），不做多厂商档案。
 */
export type StoredResearchModel = {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly providerLabel: string;
  readonly apiKey: string;
  /** 配置文件中的保存时间；来自环境变量的初始值没有该字段。 */
  readonly updatedAt?: string;
};

export type ResearchModelStore = {
  read(): StoredResearchModel | null;
};

const CONFIG_FILE = "model-config.json";

/** 读取模型配置：本机配置文件优先，其次为环境变量提供的初始值。 */
export function openResearchModelStore(
  dataDir: string,
  fallback: { baseUrl: string; modelId: string; apiKey: string; providerLabel: string } | null,
): ResearchModelStore {
  const current = readStored(join(dataDir, CONFIG_FILE)) ?? (fallback === null ? null : {
    baseUrl: fallback.baseUrl,
    modelId: fallback.modelId,
    providerLabel: fallback.providerLabel,
    apiKey: fallback.apiKey,
  });
  return {
    read: () => current,
  };
}

function readStored(file: string): StoredResearchModel | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredResearchModel> | null;
    if (parsed === null || typeof parsed !== "object") return null;
    const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl : "";
    const modelId = typeof parsed.modelId === "string" ? parsed.modelId : "";
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
    if (baseUrl.length === 0 || modelId.length === 0 || apiKey.length === 0) return null;
    return {
      baseUrl,
      modelId,
      apiKey,
      providerLabel: typeof parsed.providerLabel === "string" && parsed.providerLabel.length > 0
        ? parsed.providerLabel
        : "openai-compatible",
      ...(typeof parsed.updatedAt === "string" ? { updatedAt: parsed.updatedAt } : {}),
    };
  } catch {
    // 配置损坏按未配置处理；不猜测旧值。
    return null;
  }
}
