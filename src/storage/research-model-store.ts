import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResearchModelView } from "../contracts/research-model.ts";

/**
 * 深度研究模型配置：桌面端由设置界面写入，dev/CLI 仍可用环境变量提供初始值。
 * 一个研究模型只有一组凭证（ADR-0007 的 BYOK），不做多厂商档案。
 */
export type StoredResearchModel = {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly providerLabel: string;
  readonly apiKey: string;
  /** 用户保存时间；来自环境变量的初始值没有该字段。 */
  readonly updatedAt?: string;
};

export type ResearchModelStore = {
  read(): StoredResearchModel | null;
  write(input: { baseUrl: string; modelId: string; providerLabel: string; apiKey: string }): StoredResearchModel;
  clear(): void;
  /** 非秘密视图；密钥只以布尔呈现。 */
  view(): ResearchModelView;
};

const CONFIG_FILE = "model-config.json";

/**
 * 模型配置存储：内存持有当前值，写入时整体原子替换文件。
 * 桌面端数据目录只在本机，密钥不出本机、不写入任务/日志/提示词。
 */
export function openResearchModelStore(
  dataDir: string,
  fallback: { baseUrl: string; modelId: string; apiKey: string; providerLabel: string } | null,
): ResearchModelStore {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, CONFIG_FILE);
  let current: StoredResearchModel | null = readStored(file) ?? (fallback === null ? null : {
    baseUrl: fallback.baseUrl,
    modelId: fallback.modelId,
    providerLabel: fallback.providerLabel,
    apiKey: fallback.apiKey,
  });

  return {
    read: () => current,
    write(input) {
      const next: StoredResearchModel = {
        baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
        modelId: input.modelId.trim(),
        providerLabel: input.providerLabel.trim() || "openai-compatible",
        apiKey: input.apiKey.trim(),
        updatedAt: new Date().toISOString(),
      };
      // 先写临时文件再改名：避免进程中断留下半份配置。
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, file);
      current = next;
      return next;
    },
    clear() {
      current = null;
      if (existsSync(file)) writeFileSync(file, "null\n", { encoding: "utf8", mode: 0o600 });
    },
    view() {
      if (current === null) {
        return { configured: false, baseUrl: "", modelId: "", providerLabel: "", apiKeyConfigured: false };
      }
      return {
        configured: current.apiKey.length > 0 && current.baseUrl.length > 0 && current.modelId.length > 0,
        baseUrl: current.baseUrl,
        modelId: current.modelId,
        providerLabel: current.providerLabel,
        apiKeyConfigured: current.apiKey.length > 0,
        ...(current.updatedAt === undefined ? {} : { updatedAt: current.updatedAt }),
      };
    },
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
    // 配置损坏按未配置处理，由用户重新填写；不猜测旧值。
    return null;
  }
}
