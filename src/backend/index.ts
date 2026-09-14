import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { lock, unlock } from "proper-lockfile";
import { createAgentRuntime, resolveModelConfig } from "../agent/runtime.ts";
import { buildResearchWorkflow, createMastraResearchPort } from "../agent/research-workflow.ts";
import { createResearcherRunner, createStageRunner } from "../agent/research-agent.ts";
import { createDeepResearchSystem, type DeepResearchSystem, type ZhihuSearchGateway } from "../application/deep-research.ts";
import { openResearchStore } from "../storage/research-store.ts";
import { openResearchModelStore } from "../storage/research-model-store.ts";
import { createRunTrace } from "../storage/run-trace.ts";
import { createOpenPlatformClient, OPEN_PLATFORM_BASE_URL } from "../platform/zhihu/client.ts";
import { createContentGateway } from "../platform/zhihu/content.ts";
import { createZhidaGateway, ZHIDA_MODELS, type ZhidaModel } from "../platform/zhihu/zhida.ts";
import { callerFromSecret, type RequestIdentity } from "../platform/zhihu/identity.ts";

export type ResearchBackendConfig = {
  /** 产品与框架数据的绝对目录；同一目录同时只允许一个后端写入。 */
  dataDir: string;
  /** 每次调用读取当前知乎开放平台凭证，未配置时返回 null：用户在设置里改完立即生效。 */
  zhihuAccessSecret: () => string | null;
  /** 模型服务配置；缺失时不能创建新任务。 */
  model: { baseUrl: string; modelId: string; apiKey: string } | null;
  /** 模型信息（非秘密），记录进任务。 */
  modelProviderLabel: string;
};

export type ResearchBackend = {
  engine: DeepResearchSystem;
  /** 启动时收敛的 interrupted 任务 ID。 */
  recoveredTaskIds: string[];
  close(): Promise<void>;
};

/**
 * 深度研究后端装配：目录独占 → 产品库 → 启动收敛 → 引擎 → 工作流 → 执行端口。
 * 不自动重放任何外部请求；恢复只读取事实并标记 interrupted。
 */
export async function startResearchBackend(config: ResearchBackendConfig): Promise<ResearchBackend> {
  const releaseLock = await acquireDataDirLock(config.dataDir);
  try {
    const store = await openResearchStore(config.dataDir);
    // 凭证配置由设置界面写入并即时生效；环境变量只作为首次启动的初始值。
    const modelConfig = openResearchModelStore(config.dataDir, config.model === null
      ? null
      : {
          baseUrl: config.model.baseUrl,
          modelId: config.model.modelId,
          apiKey: config.model.apiKey,
          providerLabel: config.modelProviderLabel,
        });

    const engine = createDeepResearchSystem({
      store,
      zhihu: createZhihuSearchGateway(config),
      zhida: createZhidaQuickAnswerGateway(config),
      clock: () => new Date(),
      modelInfo: () => {
        const current = modelConfig.read();
        return current === null ? null : { provider: current.providerLabel, modelId: current.modelId };
      },
      zhihuConfigured: () => {
        const secret = config.zhihuAccessSecret();
        return secret !== null && secret.trim() !== "";
      },
      trace: createRunTrace(config.dataDir),
    });

    // 工作流注册时模型是动态的：每次推理读取当前配置，无需重启后端即可切换模型。
    const modelDeps = {
      model: () => {
        const current = modelConfig.read();
        return current === null ? null : resolveModelConfig(current);
      },
      engine,
      admitModelSteps: engine.admitModelSteps,
      consumeModelStep: engine.consumeModelStep,
      releaseModelReservation: engine.releaseModelReservation,
    };
    const runner = createStageRunner(modelDeps);
    const researcher = createResearcherRunner(modelDeps);
    const workflowRegistration = buildResearchWorkflow({ engine, runner, researcher });

    const agentRuntime = await createAgentRuntime({
      dataDir: config.dataDir,
      workflows: { deepResearch: workflowRegistration.workflow },
    });

    engine.attachExecutionPort(
      createMastraResearchPort({ workflow: workflowRegistration.workflow, engine }),
    );

    const recoveredTaskIds = await engine.recoverInterruptedTasks();

    return {
      engine,
      recoveredTaskIds,
      async close() {
        await agentRuntime.close();
        await store.close();
        await releaseLock();
      },
    };
  } catch (error) {
    await releaseLock().catch(() => undefined);
    throw error;
  }
}

/** 数据目录独占：锁丢失/释放后必须停止派发。Windows 上 SIGTERM 等同强杀，遗留锁靠 stale 窗口回收，
 *  重试窗口必须覆盖 stale 判定，否则 watch 重启/桌面端重开会直接失败。 */
async function acquireDataDirLock(dataDir: string): Promise<() => Promise<void>> {
  mkdirSync(dataDir, { recursive: true });
  try {
    const release = await lock(dataDir, {
      lockfilePath: join(dataDir, "backend.lock"),
      stale: 10_000,
      update: 4_000,
      retries: { retries: 20, minTimeout: 400, maxTimeout: 800 },
      realpath: false,
    });
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await unlock(dataDir, { lockfilePath: join(dataDir, "backend.lock"), realpath: false });
    };
    void release;
  } catch (error) {
    throw new Error(
      `数据目录 ${dataDir} 已被其他后端进程占用，或无法创建目录锁：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** 知乎直答快答网关：三档模型透传（ADR-0007）；未配置时不会被执行（创建入口已拦截）。
 *  凭证每次调用时读取，用户在设置里改完对新任务立即生效，无需重启后端。 */
function createZhidaQuickAnswerGateway(config: ResearchBackendConfig) {
  return {
    async answer(input: { model: string; prompt: string }) {
      const accessSecret = config.zhihuAccessSecret()?.trim();
      if (!accessSecret) throw new Error("知乎开放平台凭证未配置。");
      const identity: RequestIdentity = { caller: callerFromSecret(accessSecret) };
      const client = createOpenPlatformClient({ baseUrl: OPEN_PLATFORM_BASE_URL });
      const zhida = createZhidaGateway(client, identity);
      const result = await zhida.answer({
        model: ZHIDA_MODELS.includes(input.model as ZhidaModel) ? (input.model as ZhidaModel) : "zhida-fast-1p5",
        prompt: input.prompt,
      });
      return { model: result.model, content: result.content, usage: result.usage };
    },
  };
}

/** 知乎搜索网关：复用现有 client/content adapter；凭证每次调用时读取。 */
function createZhihuSearchGateway(config: ResearchBackendConfig): ZhihuSearchGateway {
  const requireSecret = (): { identity: RequestIdentity; content: ReturnType<typeof createContentGateway> } => {
    const accessSecret = config.zhihuAccessSecret()?.trim();
    if (!accessSecret) throw new Error("知乎开放平台凭证未配置。");
    const identity: RequestIdentity = { caller: callerFromSecret(accessSecret) };
    const client = createOpenPlatformClient({ baseUrl: OPEN_PLATFORM_BASE_URL });
    return { identity, content: createContentGateway(client, identity) };
  };
  return {
    async searchZhihu(input) {
      const { content } = requireSecret();
      const result = await content.searchZhihu({ query: input.query, count: input.count, signal: input.signal });
      return { items: result.items };
    },
    async searchGlobal(input) {
      const { content } = requireSecret();
      const result = await content.searchGlobal({ query: input.query, count: input.count, signal: input.signal });
      return { items: result.items };
    },
  };
}
