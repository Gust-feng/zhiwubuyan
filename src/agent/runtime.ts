import { Mastra } from "@mastra/core";
import type { Workflow } from "@mastra/core/workflows";
import type { MastraModelConfig } from "@mastra/core/llm";
import { openFrameworkStorage, type FrameworkStorage } from "../storage/framework-storage.ts";

export type ModelProfileConfig = {
  /** OpenAI 兼容端点，如 https://api.b.ai/v1 */
  baseUrl: string;
  /** 模型 ID，如 glm-5.3-flash */
  modelId: string;
  /** 仅进程内存持有，禁止写入日志、数据库或前端 */
  apiKey: string;
};

export type AgentRuntimeOptions = {
  dataDir: string;
  workflows?: Record<string, Workflow>;
};

export type AgentRuntime = {
  mastra: Mastra;
  framework: FrameworkStorage;
  close(): Promise<void>;
};

/**
 * 组装 Mastra 运行时：本地框架存储 + 工作流注册。
 * 框架整体重试与活动运行自动重启必须关闭；生命周期由产品控制意图驱动。
 */
export async function createAgentRuntime(options: AgentRuntimeOptions): Promise<AgentRuntime> {
  const framework = await openFrameworkStorage(options.dataDir);
  const mastra = new Mastra({
    storage: framework.store,
    agents: {},
    workflows: options.workflows ?? {},
    logger: false,
  });
  return {
    mastra,
    framework,
    async close() {
      await framework.close();
    },
  };
}

/**
 * 把冻结的模型 profile 配置解析为 Mastra 模型配置。
 * 使用官方 OpenAI 兼容路由，不重写 provider payload；凭证只经内存传递。
 * url 是 base 地址；provider 会自动追加 /chat/completions。
 */
export function resolveModelConfig(profile: ModelProfileConfig): MastraModelConfig {
  return {
    id: `openai-compatible/${profile.modelId}`,
    url: profile.baseUrl.replace(/\/+$/, ""),
    apiKey: profile.apiKey,
  };
}
