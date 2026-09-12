import { createHash, randomUUID } from "node:crypto";
import {
  type AnalysisAnswer,
  type QuickAnswer,
  type CreateResearchTaskInput as CreateResearchTaskInputType,
  type FindingEvidence,
  type Limits as LimitsType,
  type ModelInfo as ModelInfoType,
  type QueryLogEntry as QueryLogEntryType,
  type QueryPurpose,
  type ResearchAnalysis as ResearchAnalysisType,
  type ResearchFinding as ResearchFindingType,
  type ResearchPlan as ResearchPlanType,
  type ResearchReport as ResearchReportType,
  type ResearchSource as ResearchSourceType,
  type ResearchTier,
  type StopReason,
  type TaskDetail,
  type TaskStage,
  type TaskStatus,
  type UnitReceipt,
  type Usage as UsageType,
} from "../contracts/research.ts";
import { isProductError } from "../platform/zhihu/errors.ts";
import { toResearchSourceDraft } from "../platform/zhihu/research-sources.ts";
import { StorageError, type ResearchStore, type TaskRow } from "../storage/research-store.ts";
import type { RunTrace, RunTraceEvent } from "../storage/run-trace.ts";

/**
 * 服务端固定默认值（开发方案第 7 节）；创建时冻结快照。
 * 全部角色共用一份任务额度；并发与单元上限由同一账本控制。
 */
export const DEFAULT_LIMITS: LimitsType = {
  maxConcurrentUnits: 3,
  maxConcurrentSearches: 4,
  maxSearchRequests: 160,
  maxModelRequests: 200,
  maxSources: 800,
  timeoutMs: 2_700_000,
  synthesisModelReserve: 12,
  synthesisTimeReserveMs: 600_000,
  unitMaxSteps: 12,
  unitMaxSearchRequests: 8,
  unitTimeoutMs: 300_000,
  maxRepairPasses: 1,
};

/** 单元内每次搜索的默认条数与文本预算。 */
export const SEARCH_DEFAULT_COUNT = 5;
export const SEARCH_TIMEOUT_MS = 20_000;
export const SOURCE_EXCERPT_CHARS = 2_000;
export const TOOL_RESULT_CHARS = 6_000;
/** 单元时长上限（用于预算检查）与回查批次的最终处理预留。 */
export const REPAIR_UNIT_MS = 180_000;
export const FINAL_PROCESSING_RESERVE_MS = 240_000;

/** HTTP 公共错误：路由据此映射状态码与响应体。 */
export type ResearchApiErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "REQUEST_CONFLICT"
  | "TASK_BUSY"
  | "REPORT_NOT_READY"
  | "MODEL_NOT_CONFIGURED"
  | "ZHIHU_NOT_CONFIGURED"
  | "ULTRA_DESKTOP_ONLY"
  | "AUTH_INVALID"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "UPSTREAM_ERROR"
  | "PROTOCOL_ERROR"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";

export class ResearchApiError extends Error {
  readonly code: ResearchApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ResearchApiErrorCode, status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ResearchApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** 执行内部错误：工作流捕获后映射为任务 error.code。 */
export type StageFailureCode =
  | "MODEL_OUTPUT_INVALID"
  | "INVALID_CITATION"
  | "EVIDENCE_REQUIRED"
  | "BUDGET_EXCEEDED"
  | "TIMEOUT"
  | "PROTOCOL_ERROR"
  | "UPSTREAM_ERROR"
  | "AUTH_INVALID"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";

export class StageFailureError extends Error {
  readonly taskErrorCode: StageFailureCode;

  constructor(taskErrorCode: StageFailureCode, message: string) {
    super(message);
    this.name = "StageFailureError";
    this.taskErrorCode = taskErrorCode;
  }
}

/** 执行端口：应用层只依赖该接口；由 src/agent 用官方 Workflow API 实现。 */
export type ResearchExecutionPort = {
  startExecution(taskId: string): Promise<void>;
  cancelExecution(taskId: string): Promise<void>;
  readExecutionStage(taskId: string): Promise<TaskStage | null>;
  isExecutionActive(taskId: string): boolean;
};

export type UpstreamSearchItem = {
  id: string;
  title: string;
  url: string;
  summary: string;
  authorName?: string;
  contentType?: string;
  contentId?: string;
  authorAvatarUrl?: string;
  authorBadgeIconUrl?: string;
  authorBadgeText?: string;
  rankingScore?: number;
  editTimeSeconds?: number;
  selectedComments?: string[];
  voteCount?: number;
  commentCount?: number;
  authorityLevel?: string;
  fetchedAt: string;
};

export type ZhihuSearchGateway = {
  searchZhihu(input: { query: string; count?: number; signal?: AbortSignal }): Promise<{ items: UpstreamSearchItem[] }>;
  searchGlobal(input: { query: string; count?: number; signal?: AbortSignal }): Promise<{ items: UpstreamSearchItem[] }>;
};

export type ZhidaAnswer = {
  model: string;
  content: string;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
};

export type ZhidaQuickAnswerGateway = {
  answer(input: { model: string; prompt: string }): Promise<ZhidaAnswer>;
};

/** 直答档位 → 直答模型（ADR-0007：fast/thinking 为首页问答模式，pro 为深度研究 Pro）。 */
export const TIER_ZHIDA_MODEL: Record<Exclude<ResearchTier, "ultra">, string> = {
  fast: "zhida-fast-1p5",
  thinking: "zhida-thinking-1p5",
  pro: "zhida-agent",
};

export type DeepResearchConfig = {
  store: ResearchStore;
  zhihu: ZhihuSearchGateway;
  /** 知乎直答快答网关；缺失时快答档返回 ZHIHU_NOT_CONFIGURED。 */
  zhida: ZhidaQuickAnswerGateway | null;
  /** 桌面版运行标志：仅桌面可创建 Ultra 任务（ADR-0007）。 */
  desktopEdition: boolean;
  clock: () => Date;
  /** 当前研究模型信息；创建任务时读取，配置变更后对新任务立即生效。 */
  modelInfo: () => ModelInfoType | null;
  zhihuConfigured: boolean;
  limits?: Partial<LimitsType>;
  trace: RunTrace;
};

export type SourceExcerpt = {
  id: string;
  title: string;
  authorName: string | null;
  sourceTime: string | null;
  timeKind: string;
  text: string;
  excerptTruncated: boolean;
};

/** 工具结构化返回：模型依据 status 调整行为，不抛出策略错误。 */
export type UnitSearchResult = {
  status: "succeeded" | "reused" | "in_progress" | "rejected";
  reason?: string;
  sources: SourceExcerpt[];
};

export type ReadSourceResult = {
  status: "succeeded" | "rejected";
  reason?: string;
  sourceId?: string;
  title?: string;
  text?: string;
  totalLength?: number;
  excerptTruncated?: boolean;
};

/** 主管决策经应用校验后的单元派发单。 */
export type UnitAssignment = {
  unitId: string;
  questionId: string;
  objective: string;
  focus: QueryPurpose;
};

export type FinalizeContext = {
  question: string;
  plan: ResearchPlanType;
  findings: ResearchFindingType[];
  analysis: ResearchAnalysisType | null;
  excerpts: SourceExcerpt[];
  stopReason: StopReason;
  completeness: "sufficient" | "partial";
};

export function createDeepResearchSystem(config: DeepResearchConfig) {
  const store = config.store;
  const clock = config.clock;
  const limits: LimitsType = { ...DEFAULT_LIMITS, ...config.limits };
  /** 取消后仍在收尾的任务：占用活动槽，不能立刻腾出。 */
  const draining = new Set<string>();
  /** 同一任务的短事务串行化；不持有锁等待模型或网络。 */
  const taskLocks = new Map<string, Promise<void>>();
  /** 探索结束原因：仅同一次执行内使用；报告在同一进程保存。 */
  const explorationStopReason = new Map<string, StopReason>();
  /**
   * 进程内预算账本：预占/并发/单元时钟。JS 单线程下同步操作即原子；
   * 进程退出后预占自然消失，产品 outcome 兜底拒绝迟到写入。
   */
  const ledgers = new Map<
    string,
    {
      modelReserved: number;
      searchInFlight: number;
      unitStartedAt: Map<string, number>;
      repairPassesUsed: number;
      batchCount: number;
    }
  >();
  let executionPort: ResearchExecutionPort | null = null;

  /** 运行轨迹写入：诊断用途，失败静默。 */
  function trace(taskId: string, event: RunTraceEvent): void {
    void config.trace.append(taskId, event, clock().toISOString());
  }

  function recordStage(taskId: string, stage: TaskStage): void {
    trace(taskId, { kind: "stage", stage });
  }

  function attachExecutionPort(port: ResearchExecutionPort): void {
    executionPort = port;
  }

  function requirePort(): ResearchExecutionPort {
    if (!executionPort) throw new ResearchApiError("INTERNAL_ERROR", 500, "研究执行端口未装配。");
    return executionPort;
  }

  function shortId(): string {
    return randomUUID().replace(/-/g, "").slice(0, 12);
  }

  function ledger(taskId: string) {
    let entry = ledgers.get(taskId);
    if (!entry) {
      entry = {
        modelReserved: 0,
        searchInFlight: 0,
        unitStartedAt: new Map(),
        repairPassesUsed: 0,
        batchCount: 0,
      };
      ledgers.set(taskId, entry);
    }
    return entry;
  }

  async function withTaskLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    const previous = taskLocks.get(taskId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => gate);
    taskLocks.set(taskId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (taskLocks.get(taskId) === queued) taskLocks.delete(taskId);
    }
  }

  async function loadTaskRow(taskId: string): Promise<TaskRow> {
    const row = await store.getTask(taskId);
    if (!row) throw new ResearchApiError("NOT_FOUND", 404, "研究任务不存在。", { taskId });
    return row;
  }

  function remainingMs(row: TaskRow): number {
    return row.limits.timeoutMs - (clock().getTime() - Date.parse(row.createdAt));
  }

  function explorationClosed(row: TaskRow): boolean {
    return remainingMs(row) <= row.limits.synthesisTimeReserveMs;
  }

  function explorationModelCap(row: TaskRow): number {
    return row.limits.maxModelRequests - row.limits.synthesisModelReserve;
  }

  function computeInputHash(question: string, allowWebSupplement: boolean): string {
    return sha256Hex(JSON.stringify({ allowWebSupplement, question }));
  }

  // ---------------------------------------------------------------------------
  // 公共命令（HTTP 入口）
  // ---------------------------------------------------------------------------

  async function createResearchTask(
    rawInput: CreateResearchTaskInputType,
  ): Promise<{ detail: TaskDetail; accepted: boolean }> {
    const question = rawInput.question.trim();
    if (question.length < 1 || question.length > 2000) {
      throw new ResearchApiError("INVALID_INPUT", 400, "研究问题长度必须在 1–2,000 字符之间。");
    }
    const inputHash = computeInputHash(question, rawInput.allowWebSupplement);

    // 先处理重复 requestId，再做繁忙/配置检查；网络重试不会创建新任务。
    const existing = await store.findTaskByRequestId(rawInput.requestId);
    if (existing) {
      if (existing.inputHash !== inputHash) {
        throw new ResearchApiError("REQUEST_CONFLICT", 409, "该 requestId 已用于不同的研究请求。");
      }
      return { detail: await buildTaskDetail(existing), accepted: false };
    }

    const tier: ResearchTier = rawInput.tier;
    if (tier !== "ultra") {
      return await runQuickAnswer(rawInput, question, inputHash, tier);
    }

    // Ultra 仅桌面版可用（ADR-0007）；判定来自后端启动配置。
    if (!config.desktopEdition) {
      throw new ResearchApiError("ULTRA_DESKTOP_ONLY", 403, "深度研究 Ultra 仅在桌面版可用。");
    }

    // 创建任务时读取当前模型配置：设置里改完对新任务立即生效，无需重启后端。
    const modelInfo = config.modelInfo();
    if (!modelInfo) {
      throw new ResearchApiError("MODEL_NOT_CONFIGURED", 503, "模型尚未配置，无法执行研究。");
    }
    if (!config.zhihuConfigured) {
      throw new ResearchApiError("ZHIHU_NOT_CONFIGURED", 503, "知乎开放平台凭证尚未配置，无法检索来源。");
    }
    const taskId = `task-${shortId()}`;
    const createdAt = clock().toISOString();
    const usage: UsageType = {
      searchRequests: 0,
      modelRequests: 0,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      elapsedMs: 0,
    };
    const inserted = await withTaskLock("__create__", async () => {
      const racedRequest = await store.findTaskByRequestId(rawInput.requestId);
      if (racedRequest) {
        if (racedRequest.inputHash !== inputHash) {
          throw new ResearchApiError("REQUEST_CONFLICT", 409, "该 requestId 已用于不同的研究请求。");
        }
        return false;
      }
      if ((await store.countActiveTasks()) > 0 || draining.size > 0) {
        throw new ResearchApiError("TASK_BUSY", 409, "另一项研究尚未结束，请稍后重试。");
      }
      try {
        await store.insertTask({
          taskId,
          requestId: rawInput.requestId,
          inputHash,
          question,
          tier,
          allowWebSupplement: rawInput.allowWebSupplement,
          usage,
          limits,
          modelInfo,
          createdAt,
        });
        return true;
      } catch (error) {
        if (error instanceof StorageError) {
          const raced = await store.findTaskByRequestId(rawInput.requestId);
          if (raced && raced.inputHash === inputHash) return false;
          if (raced) throw new ResearchApiError("REQUEST_CONFLICT", 409, "该 requestId 已用于不同的研究请求。");
          throw new ResearchApiError("STORAGE_ERROR", 500, "研究任务写入失败。");
        }
        throw error;
      }
    });
    if (!inserted) {
      const existingTask = await store.findTaskByRequestId(rawInput.requestId);
      if (!existingTask) throw new ResearchApiError("STORAGE_ERROR", 500, "重复请求结果无法读取。");
      return { detail: await buildTaskDetail(existingTask), accepted: false };
    }

    // 任务已提交；派发失败转为任务失败，不能让任务停留在 starting。
    try {
      await requirePort().startExecution(taskId);
    } catch {
      await failTask(taskId, "INTERNAL_ERROR", "研究执行启动失败。");
    }
    const row = await loadTaskRow(taskId);
    return { detail: await buildTaskDetail(row), accepted: true };
  }

  async function getResearchTaskDetail(taskId: string): Promise<TaskDetail> {
    return await buildTaskDetail(await loadTaskRow(taskId));
  }

  /**
   * 直答快答（fast/thinking/agent）：同步调用知乎直答并立即返回完成态任务。
   * 产物是独立快答（无来源引用，见 ADR-0007）；复用 requestId 幂等与 outcome 写许可。
   */
  async function runQuickAnswer(
    rawInput: CreateResearchTaskInputType,
    question: string,
    inputHash: string,
    tier: ResearchTier,
  ): Promise<{ detail: TaskDetail; accepted: boolean }> {
    if (!config.zhida) {
      throw new ResearchApiError("ZHIHU_NOT_CONFIGURED", 503, "知乎直答尚未配置，无法执行快答。");
    }
    const model = TIER_ZHIDA_MODEL[tier as Exclude<ResearchTier, "ultra">];
    const taskId = `task-${shortId()}`;
    const createdAt = clock().toISOString();
    const usage: UsageType = {
      searchRequests: 0,
      modelRequests: 0,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      elapsedMs: 0,
    };
    const inserted = await withTaskLock("__create__", async () => {
      const racedRequest = await store.findTaskByRequestId(rawInput.requestId);
      if (racedRequest) {
        if (racedRequest.inputHash !== inputHash) {
          throw new ResearchApiError("REQUEST_CONFLICT", 409, "该 requestId 已用于不同的研究请求。");
        }
        return false;
      }
      try {
        await store.insertTask({
          taskId,
          requestId: rawInput.requestId,
          inputHash,
          question,
          tier,
          allowWebSupplement: rawInput.allowWebSupplement,
          usage,
          limits,
          modelInfo: { provider: "zhihu-zhida", modelId: model },
          createdAt,
        });
        return true;
      } catch (error) {
        if (error instanceof StorageError) {
          const raced = await store.findTaskByRequestId(rawInput.requestId);
          if (raced && raced.inputHash === inputHash) return false;
          if (raced) throw new ResearchApiError("REQUEST_CONFLICT", 409, "该 requestId 已用于不同的研究请求。");
          throw new ResearchApiError("STORAGE_ERROR", 500, "快答任务写入失败。");
        }
        throw error;
      }
    });
    if (!inserted) {
      const existingTask = await store.findTaskByRequestId(rawInput.requestId);
      if (!existingTask) throw new ResearchApiError("STORAGE_ERROR", 500, "重复请求结果无法读取。");
      return { detail: await buildTaskDetail(existingTask), accepted: false };
    }

    try {
      const response = await config.zhida.answer({ model, prompt: question });
      const answer: QuickAnswer = {
        content: response.content,
        model: response.model,
        generatedAt: clock().toISOString(),
      };
      // 先记账再提交完成态：saveUsage 受 outcome IS NULL 约束。
      const rowBefore = await loadTaskRow(taskId);
      await store.saveUsage(taskId, {
        ...rowBefore.usage,
        modelRequests: 1,
        inputTokens: response.usage?.inputTokens ?? null,
        outputTokens: response.usage?.outputTokens ?? null,
      });
      const committed = await store.commitQuickAnswer(taskId, answer);
      return { detail: await buildTaskDetail(await loadTaskRow(taskId)), accepted: true };
    } catch (error) {
      const mapped = describeQuickAnswerFailure(error);
      await failTask(taskId, mapped.taskErrorCode, mapped.message);
      throw new ResearchApiError(mapped.apiCode, mapped.status, mapped.message);
    }
  }

  function describeQuickAnswerFailure(error: unknown): {
    taskErrorCode: StageFailureError["taskErrorCode"];
    apiCode: ResearchApiError["code"];
    status: number;
    message: string;
  } {
    if (isProductError(error)) {
      switch (error.code) {
        case "RATE_LIMITED":
          return { taskErrorCode: "RATE_LIMITED", apiCode: "RATE_LIMITED", status: 429, message: "知乎直答请求过于频繁。" };
        case "QUOTA_EXHAUSTED":
          return { taskErrorCode: "QUOTA_EXHAUSTED", apiCode: "QUOTA_EXHAUSTED", status: 429, message: "知乎直答额度已用尽。" };
        case "AUTH_INVALID":
        case "AUTH_REQUIRED":
          return { taskErrorCode: "AUTH_INVALID", apiCode: "AUTH_INVALID", status: 503, message: "知乎直答鉴权失败。" };
        case "PROTOCOL_ERROR":
          return { taskErrorCode: "PROTOCOL_ERROR", apiCode: "PROTOCOL_ERROR", status: 502, message: "知乎直答响应不符合契约。" };
        case "ABORTED":
          return { taskErrorCode: "TIMEOUT", apiCode: "UPSTREAM_ERROR", status: 502, message: "知乎直答响应超时。" };
        default:
          return { taskErrorCode: "UPSTREAM_ERROR", apiCode: "UPSTREAM_ERROR", status: 502, message: "知乎直答暂时没有响应。" };
      }
    }
    const message = error instanceof Error ? error.message.slice(0, 200) : "知乎直答调用失败。";
    return { taskErrorCode: "UPSTREAM_ERROR", apiCode: "UPSTREAM_ERROR", status: 502, message };
  }

  async function listResearchTasks(input: { limit?: number; offset?: number }): Promise<{
    items: TaskDetail[];
    hasMore: boolean;
  }> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    const rows = await store.listTasks(limit + 1, offset);
    const items: TaskDetail[] = [];
    for (const row of rows.slice(0, limit)) {
      items.push(await buildTaskDetail(row));
    }
    return { items, hasMore: rows.length > limit };
  }

  async function cancelResearchTask(taskId: string): Promise<{ detail: TaskDetail; httpStatus: number }> {
    const row = await loadTaskRow(taskId);
    if (row.outcome !== null) {
      return { detail: await buildTaskDetail(row), httpStatus: 200 };
    }
    const applied = await store.setOutcome(taskId, "cancelled", null);
    if (applied) {
      trace(taskId, { kind: "terminal", outcome: "cancelled", errorCode: null, stopReason: null, usage: row.usage });
    }
    const active = requirePort().isExecutionActive(taskId);
    if (applied && active) {
      draining.add(taskId);
      await requirePort().cancelExecution(taskId);
      return { detail: await buildTaskDetail(await loadTaskRow(taskId)), httpStatus: 202 };
    }
    if (applied && !active) {
      await store.setEndedAt(taskId, clock().toISOString());
    }
    return { detail: await buildTaskDetail(await loadTaskRow(taskId)), httpStatus: 200 };
  }

  async function listResearchSources(taskId: string): Promise<{ items: ResearchSourceType[] }> {
    await loadTaskRow(taskId);
    return { items: await store.listSources(taskId) };
  }

  async function getResearchReport(taskId: string): Promise<ResearchReportType> {
    await loadTaskRow(taskId);
    const report = await store.getReportByTaskId(taskId);
    if (!report) {
      throw new ResearchApiError("REPORT_NOT_READY", 409, "当前没有已保存的研究报告。");
    }
    return report;
  }

  async function exportResearchReportMarkdown(taskId: string): Promise<string> {
    const report = await getResearchReport(taskId);
    const sources = await store.listSources(taskId);
    return renderReportMarkdown(report, sources);
  }

  // ---------------------------------------------------------------------------
  // 状态投影
  // ---------------------------------------------------------------------------

  async function buildTaskDetail(row: TaskRow): Promise<TaskDetail> {
    const stage = await projectStage(row);
    const sourceCount = await store.countSources(row.taskId);
    const report = await store.getReportByTaskId(row.taskId);
    const status = projectStatus(row);
    return {
      id: row.taskId,
      question: row.question,
      status,
      stage,
      createdAt: row.createdAt,
      endedAt: row.endedAt,
      sourceCount,
      reportId: report?.id ?? null,
      error: row.error,
      tier: row.tier,
      answer: row.answer,
      allowWebSupplement: row.allowWebSupplement,
      plan: row.plan,
      findings: row.findings,
      analysis: row.analysis,
      queries: row.queryLog,
      usage: { ...row.usage, elapsedMs: Math.max(0, clock().getTime() - Date.parse(row.createdAt)) },
      limits: row.limits,
      modelInfo: row.modelInfo,
    };
  }

  function projectStatus(row: TaskRow): TaskStatus {
    if (row.outcome === null) {
      return row.frameworkRunId !== null && requirePort().isExecutionActive(row.taskId) ? "running" : "starting";
    }
    if (row.outcome === "cancelled") {
      return requirePort().isExecutionActive(row.taskId) ? "cancelling" : "cancelled";
    }
    return row.outcome;
  }

  async function projectStage(row: TaskRow): Promise<TaskStage | null> {
    if (row.outcome !== null && row.outcome !== "cancelled") return null;
    if (row.frameworkRunId === null) return null;
    return await requirePort().readExecutionStage(row.taskId);
  }

  // ---------------------------------------------------------------------------
  // 启动收敛与执行收尾
  // ---------------------------------------------------------------------------

  async function recoverInterruptedTasks(): Promise<string[]> {
    const ids = await store.markInterruptedTasks(clock().toISOString());
    for (const taskId of ids) {
      const row = await store.getTask(taskId);
      if (row) {
        trace(taskId, { kind: "terminal", outcome: "interrupted", errorCode: null, stopReason: null, usage: row.usage });
      }
    }
    return ids;
  }

  async function failTask(taskId: string, code: StageFailureError["taskErrorCode"], message: string): Promise<void> {
    const applied = await store.setOutcome(taskId, "failed", { code, message });
    if (applied) {
      await store.setEndedAt(taskId, clock().toISOString());
      const row = await loadTaskRow(taskId);
      trace(taskId, { kind: "terminal", outcome: "failed", errorCode: code, stopReason: null, usage: row.usage });
    }
    ledgers.delete(taskId);
    draining.delete(taskId);
  }

  async function confirmExecutionEnd(taskId: string): Promise<void> {
    draining.delete(taskId);
    ledgers.delete(taskId);
    const row = await store.getTask(taskId);
    if (!row || row.endedAt !== null) return;
    if (row.outcome !== null) {
      await store.setEndedAt(taskId, clock().toISOString());
    }
  }

  async function markExecutionStarted(taskId: string, frameworkRunId: string): Promise<void> {
    await store.setFrameworkRunId(taskId, frameworkRunId);
  }

  async function hasPendingQueries(taskId: string): Promise<boolean> {
    const row = await loadTaskRow(taskId);
    return row.queryLog.some((entry) => entry.status === "pending");
  }

  function assertWritable(row: TaskRow): void {
    if (row.outcome !== null) {
      throw new StageFailureError("UPSTREAM_ERROR", "任务已结束，操作被拒绝。");
    }
  }

  // ---------------------------------------------------------------------------
  // 预算账本：预占 → 逐推理步结算 → 归还确定未使用的预留
  // ---------------------------------------------------------------------------

  /**
   * 预占模型推理次数。phase=exploration 受收尾预留约束；
   * 达到硬上限后任何请求都不再发送；结果未知的尝试不退还。
   */
  async function admitModelSteps(
    taskId: string,
    count: number,
    phase: "exploration" | "synthesis",
  ): Promise<void> {
    await withTaskLock(taskId, async () => {
      const row = await loadTaskRow(taskId);
      assertWritable(row);
      const entry = ledger(taskId);
      const used = row.usage.modelRequests;
      const cap = phase === "exploration" ? explorationModelCap(row) : row.limits.maxModelRequests;
      if (used + entry.modelReserved + count > cap) {
        throw new StageFailureError("BUDGET_EXCEEDED", `模型推理预算不足（${phase}）。`);
      }
      if (remainingMs(row) <= (phase === "exploration" ? row.limits.synthesisTimeReserveMs : 0)) {
        throw new StageFailureError("TIMEOUT", "剩余时间不足以继续执行该阶段。");
      }
      entry.modelReserved += count;
    });
  }

  /** 一步推理完成：结算一次并累计 token。 */
  async function consumeModelStep(
    taskId: string,
    tokens: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null },
  ): Promise<void> {
    await withTaskLock(taskId, async () => {
      const row = await loadTaskRow(taskId);
      if (row.outcome !== null) return;
      const entry = ledger(taskId);
      entry.modelReserved = Math.max(0, entry.modelReserved - 1);
      const usage = row.usage;
      await store.saveUsage(taskId, {
        ...usage,
        modelRequests: usage.modelRequests + 1,
        inputTokens: tokens.inputTokens === null ? usage.inputTokens : (usage.inputTokens ?? 0) + tokens.inputTokens,
        outputTokens:
          tokens.outputTokens === null ? usage.outputTokens : (usage.outputTokens ?? 0) + tokens.outputTokens,
        cachedInputTokens:
          tokens.cachedInputTokens === null
            ? usage.cachedInputTokens
            : (usage.cachedInputTokens ?? 0) + tokens.cachedInputTokens,
      });
    });
  }

  /** 执行结束：归还确定未使用的预留。 */
  async function releaseModelReservation(taskId: string, count: number): Promise<void> {
    if (count <= 0) return;
    await withTaskLock(taskId, async () => {
      const entry = ledger(taskId);
      entry.modelReserved = Math.max(0, entry.modelReserved - count);
    });
  }

  /** 查询单元上下文：unitId 时钟与本地搜索计数。 */
  function beginUnitTracking(taskId: string, unitId: string): void {
    const entry = ledger(taskId);
    entry.unitStartedAt.set(unitId, clock().getTime());
  }

  function endUnitTracking(taskId: string, unitId: string): void {
    const entry = ledger(taskId);
    entry.unitStartedAt.delete(unitId);
  }

  function unitElapsedMs(taskId: string, unitId: string): number {
    const startedAt = ledger(taskId).unitStartedAt.get(unitId);
    return startedAt === undefined ? 0 : clock().getTime() - startedAt;
  }

  // ---------------------------------------------------------------------------
  // 工具命令（searchZhihu / searchWeb / readSource）
  // ---------------------------------------------------------------------------

  function normalizeQueryText(text: string): string {
    return text.replace(/\s+/g, " ").trim().toLowerCase();
  }

  /**
   * 单元搜索准入与执行。重复查询复用已有来源；正在执行的同类查询返回 in_progress。
   * 策略拒绝以结构化 status 返回给模型，不抛出异常。
   */
  async function unitSearch(args: {
    taskId: string;
    unitId: string;
    questionId: string;
    channel: "zhihu" | "web";
    text: string;
    purpose: QueryPurpose;
    runSignal: AbortSignal;
  }): Promise<UnitSearchResult> {
    const text = args.text.trim();
    if (text.length === 0 || text.length > 500) {
      return { status: "rejected", reason: "invalid_query", sources: [] };
    }
    const entry: QueryLogEntryType = {
      id: `query-${shortId()}`,
      unitId: args.unitId,
      questionId: args.questionId,
      channel: args.channel,
      text,
      purpose: args.purpose,
      status: "pending",
      sourceIds: [],
      discardedCount: null,
      error: null,
      requestedAt: clock().toISOString(),
      completedAt: null,
    };
    // 准入即计数：短事务同时登记 pending 与 searchRequests；并发槽在锁内占用。
    const admission = await withTaskLock(args.taskId, async () => {
      const latest = await loadTaskRow(args.taskId);
      if (latest.outcome !== null) return { kind: "rejected" as const, reason: "task_closed" };
      const normalized = normalizeQueryText(text);
      const duplicate = latest.queryLog.find(
        (item) => item.channel === args.channel && normalizeQueryText(item.text) === normalized,
      );
      if (duplicate) {
        if (duplicate.status === "pending") return { kind: "in_progress" as const };
        const sources = await store.listSources(args.taskId);
        const reused = duplicate.sourceIds
          .map((id) => sources.find((source) => source.id === id))
          .filter((source): source is ResearchSourceType => source !== undefined);
        return { kind: "reused" as const, sources: buildExcerpts(reused) };
      }
      if (args.channel === "web" && !latest.allowWebSupplement) {
        return { kind: "rejected" as const, reason: "web_channel_not_allowed" };
      }
      if (latest.usage.searchRequests >= latest.limits.maxSearchRequests) {
        return { kind: "rejected" as const, reason: "search_budget_exhausted" };
      }
      if (ledger(args.taskId).searchInFlight >= latest.limits.maxConcurrentSearches) {
        return { kind: "rejected" as const, reason: "search_concurrency_limit" };
      }
      if (explorationClosed(latest)) {
        return { kind: "rejected" as const, reason: "synthesis_window" };
      }
      const unitSearchCount = latest.queryLog.filter((item) => item.unitId === args.unitId).length;
      if (unitSearchCount >= latest.limits.unitMaxSearchRequests) {
        return { kind: "rejected" as const, reason: "unit_search_budget_exhausted" };
      }
      if (unitElapsedMs(args.taskId, args.unitId) > latest.limits.unitTimeoutMs) {
        return { kind: "rejected" as const, reason: "unit_timeout" };
      }
      const ok = await store.admitSearch(args.taskId, entry, latest.limits.maxSearchRequests);
      if (ok) ledger(args.taskId).searchInFlight += 1;
      return ok ? { kind: "admitted" as const } : { kind: "rejected" as const, reason: "search_admission_rejected" };
    });
    if (admission.kind === "reused") return { status: "reused", sources: admission.sources };
    if (admission.kind === "in_progress") return { status: "in_progress", reason: "QUERY_IN_PROGRESS", sources: [] };
    if (admission.kind !== "admitted") return { status: "rejected", reason: admission.reason, sources: [] };

    try {
      const signal = AbortSignal.any([args.runSignal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]);
      const result =
        args.channel === "zhihu"
          ? await config.zhihu.searchZhihu({ query: text, count: SEARCH_DEFAULT_COUNT, signal })
          : await config.zhihu.searchGlobal({ query: text, count: SEARCH_DEFAULT_COUNT, signal });
      const savedSourceIds: string[] = [];
      const savedSources: ResearchSourceType[] = [];
      let discarded = 0;
      for (const item of result.items) {
        const draft = toResearchSourceDraft({ item, taskId: args.taskId, channel: args.channel });
        if (draft.kind === "discarded") {
          discarded += 1;
          continue;
        }
        const source: ResearchSourceType = { ...draft.source, id: `source-${shortId()}` };
        const outcome = await store.insertSource(source, limits.maxSources);
        if (outcome === "saved") {
          savedSourceIds.push(source.id);
          savedSources.push(source);
        } else if (outcome === "duplicate") {
          const existing = await store.findSourceByKey(args.taskId, source.channel, source.identity, source.textHash);
          if (existing) {
            savedSourceIds.push(existing.id);
            savedSources.push(existing);
          }
        }
      }
      await settleQuery(args.taskId, entry.id, {
        status: "succeeded",
        sourceIds: savedSourceIds,
        discardedCount: discarded,
        error: null,
      });
      return { status: "succeeded", sources: buildExcerpts(savedSources) };
    } catch (error) {
      await settleQuery(args.taskId, entry.id, {
        status: "failed",
        sourceIds: [],
        discardedCount: null,
        error: describeUpstreamError(error),
      });
      return { status: "rejected", reason: describeUpstreamError(error), sources: [] };
    }
  }

  async function settleQuery(
    taskId: string,
    queryId: string,
    patch: { status: "succeeded" | "failed"; sourceIds: string[]; discardedCount: number | null; error: string | null },
  ): Promise<void> {
    await withTaskLock(taskId, async () => {
      ledger(taskId).searchInFlight = Math.max(0, ledger(taskId).searchInFlight - 1);
      const row = await loadTaskRow(taskId);
      if (row.outcome !== null) return;
      const log = row.queryLog.map((item) =>
        item.id === queryId
          ? {
              ...item,
              status: patch.status,
              sourceIds: patch.sourceIds,
              discardedCount: patch.discardedCount,
              error: patch.error,
              completedAt: clock().toISOString(),
            }
          : item,
      );
      await store.appendQueryLog(taskId, log);
    });
  }

  function describeUpstreamError(error: unknown): string {
    if (isProductError(error)) {
      return error.code === "ABORTED" ? "ABORTED" : error.code;
    }
    return "UPSTREAM_ERROR";
  }

  /** readSource：只读取本任务已保存摘要的指定片段，不抓取网页全文。 */
  async function readSourceExcerpt(args: {
    taskId: string;
    sourceId: string;
    offset: number;
  }): Promise<ReadSourceResult> {
    const row = await loadTaskRow(args.taskId);
    if (row.outcome !== null) return { status: "rejected", reason: "task_closed" };
    const source = (await store.listSources(args.taskId)).find((item) => item.id === args.sourceId);
    if (!source) return { status: "rejected", reason: "source_not_in_task" };
    const total = source.text.length;
    const offset = Math.max(0, Math.min(args.offset, total));
    const text = source.text.slice(offset, offset + SOURCE_EXCERPT_CHARS);
    return {
      status: "succeeded",
      sourceId: source.id,
      title: source.title,
      text,
      totalLength: total,
      excerptTruncated: offset + text.length < total,
    };
  }

  function buildExcerpts(sources: ResearchSourceType[]): SourceExcerpt[] {
    // 工具返回正文预算：约 6,000 字符，按来源顺序装载。
    const excerpts: SourceExcerpt[] = [];
    let budget = TOOL_RESULT_CHARS;
    for (const source of sources) {
      if (budget <= 0) break;
      const text = source.text.slice(0, Math.min(SOURCE_EXCERPT_CHARS, budget));
      budget -= text.length;
      excerpts.push({
        id: source.id,
        title: source.title,
        authorName: source.author?.name ?? null,
        sourceTime: source.sourceTime,
        timeKind: source.timeKind,
        text,
        excerptTruncated: text.length < source.text.length,
      });
    }
    return excerpts;
  }

  // ---------------------------------------------------------------------------
  // 调查单元：发现提交与回执
  // ---------------------------------------------------------------------------

  /**
   * 提交单元发现：校验子问题与来源归属、引用原样子串后分配 ID 并幂等保存。
   * 返回实际新增的 findingIds。
   */
  async function commitUnitFindings(args: {
    taskId: string;
    unitId: string;
    proposals: Array<{
      questionId: string;
      statement: string;
      kind: ResearchFindingType["kind"];
      conditions: string[];
      limitations: string[];
      evidence: FindingEvidence[];
    }>;
  }): Promise<{ addedFindingIds: string[]; rejectedCount: number; rejectReasons: string[] }> {
    const row = await loadTaskRow(args.taskId);
    assertWritable(row);
    const plan = row.plan;
    if (!plan) {
      throw new StageFailureError("INTERNAL_ERROR", "提交发现时缺少全局计划。");
    }
    const sources = new Map((await store.listSources(args.taskId)).map((source) => [source.id, source]));
    const questionIds = new Set(plan.questions.map((question) => question.id));

    // 逐条校验：无效发现剔除并记录原因，不因单条失败丢弃整个单元的有效结果。
    const findings: ResearchFindingType[] = [];
    const rejectReasons: string[] = [];
    for (const proposal of args.proposals) {
      if (!questionIds.has(proposal.questionId)) {
        rejectReasons.push(`unknown_question:${proposal.questionId}`);
        continue;
      }
      if (proposal.evidence.length === 0) {
        rejectReasons.push("no_evidence");
        continue;
      }
      let valid = true;
      for (const citation of proposal.evidence) {
        const source = sources.get(citation.sourceId);
        if (!source) {
          rejectReasons.push(`unknown_source:${citation.sourceId}`);
          valid = false;
          break;
        }
        if (!source.text.includes(citation.quote)) {
          rejectReasons.push(`quote_mismatch:${citation.sourceId}`);
          valid = false;
          break;
        }
      }
      if (!valid) continue;
      findings.push({
        id: `finding-${shortId()}`,
        unitId: args.unitId,
        questionId: proposal.questionId,
        statement: proposal.statement,
        kind: proposal.kind,
        conditions: proposal.conditions,
        limitations: proposal.limitations,
        evidence: proposal.evidence,
      });
    }
    const added = await store.appendFindings(args.taskId, findings);
    return {
      addedFindingIds: added.map((finding) => finding.id),
      rejectedCount: args.proposals.length - added.length,
      rejectReasons: rejectReasons.slice(0, 5),
    };
  }

  async function saveUnitReceipt(taskId: string, receipt: UnitReceipt): Promise<void> {
    await store.saveUnitReceipt(taskId, receipt);
  }

  /** 本单元自己检索到的来源（供成稿阶段基于该单元材料生成发现）。 */
  async function listUnitSources(taskId: string, unitId: string): Promise<SourceExcerpt[]> {
    const row = await loadTaskRow(taskId);
    if (row.outcome !== null) return [];
    const unitSourceIds = [
      ...new Set(row.queryLog.filter((entry) => entry.unitId === unitId).flatMap((entry) => entry.sourceIds)),
    ];
    const sources = await store.listSources(taskId);
    const byId = new Map(sources.map((source) => [source.id, source]));
    return buildExcerpts(unitSourceIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
  }

  /**
   * 单元连续整体失败保护：最近两批（各 maxConcurrentUnits 个）回执全部失败
   * 且没有任何有效发现时，探索无法产出结果，应停止而非耗尽预算。
   */
  async function hasStalledUnits(taskId: string): Promise<boolean> {
    const row = await loadTaskRow(taskId);
    const batchSize = row.limits.maxConcurrentUnits * 2;
    if (row.findings.length > 0 || row.unitReceipts.length < batchSize) return false;
    const recent = row.unitReceipts.slice(-batchSize);
    return recent.every((receipt) => receipt.status === "failed");
  }

  // ---------------------------------------------------------------------------
  // 主管命令：计划提交、决策应用、结果合并（唯一写入入口）
  // ---------------------------------------------------------------------------

  async function submitInitialPlan(
    taskId: string,
    plan: { objective: string; assumptions: string[]; questions: Array<{ text: string; priority: "high" | "normal" }> },
  ): Promise<ResearchPlanType> {
    const row = await loadTaskRow(taskId);
    assertWritable(row);
    const saved: ResearchPlanType = {
      version: 1,
      objective: plan.objective,
      assumptions: plan.assumptions,
      questions: plan.questions.map((question, index) => ({
        id: `q${index + 1}`,
        text: question.text,
        priority: question.priority,
        closedReason: null,
      })),
    };
    const ok = await store.savePlan(taskId, saved);
    if (!ok) {
      throw new StageFailureError("UPSTREAM_ERROR", "计划写入被拒绝，任务可能已结束。");
    }
    return saved;
  }

  /**
   * 应用主管决策：调整计划（新增/关闭问题）并返回通过校验的单元派发单。
   * 模型决定经代码校验；无效或无进展的决定不产生派发。
   */
  async function applySupervisorDecision(args: {
    taskId: string;
    decision: {
      units: Array<{ questionId: string; objective: string; focus: QueryPurpose }>;
      planUpdates: {
        newQuestions: Array<{ text: string; priority: "high" | "normal" }>;
        closeQuestions: Array<{ questionId: string; closedReason: "irrelevant" | "saturated" }>;
      };
    };
  }): Promise<{ plan: ResearchPlanType; units: UnitAssignment[]; planChanged: boolean }> {
    const row = await loadTaskRow(args.taskId);
    assertWritable(row);
    const plan = row.plan;
    if (!plan) {
      throw new StageFailureError("INTERNAL_ERROR", "应用主管决策时缺少全局计划。");
    }

    const questions = [...plan.questions];
    const byId = new Map(questions.map((question) => [question.id, question]));
    let changed = false;

    for (const close of args.decision.planUpdates.closeQuestions) {
      const question = byId.get(close.questionId);
      if (!question || question.closedReason !== null) continue;
      question.closedReason = close.closedReason;
      changed = true;
    }
    const normalizedExisting = new Set(questions.map((question) => normalizeQueryText(question.text)));
    for (const proposal of args.decision.planUpdates.newQuestions) {
      if (questions.length >= 12) break;
      const key = normalizeQueryText(proposal.text);
      if (normalizedExisting.has(key)) continue;
      const question = {
        id: `q${questions.length + 1}-${shortId().slice(0, 4)}`,
        text: proposal.text,
        priority: proposal.priority,
        closedReason: null,
      };
      questions.push(question);
      byId.set(question.id, question);
      normalizedExisting.add(key);
      changed = true;
    }

    // 单元派发校验：开放问题、并发、探索窗口与剩余模型额度。
    const units: UnitAssignment[] = [];
    if (!explorationClosed(row)) {
      for (const proposal of args.decision.units) {
        if (units.length >= row.limits.maxConcurrentUnits) break;
        const question = byId.get(proposal.questionId);
        if (!question || question.closedReason !== null) continue;
        units.push({
          unitId: `unit-${shortId()}`,
          questionId: question.id,
          objective: proposal.objective,
          focus: proposal.focus,
        });
      }
    }

    const nextPlan: ResearchPlanType = changed
      ? { ...plan, version: plan.version + 1, questions }
      : plan;
    if (changed) {
      const ok = await store.savePlan(args.taskId, nextPlan);
      if (!ok) {
        throw new StageFailureError("UPSTREAM_ERROR", "计划更新被拒绝，任务可能已结束。");
      }
    }
    if (units.length > 0) {
      const entry = ledger(args.taskId);
      entry.batchCount += 1;
      trace(args.taskId, {
        kind: "batch",
        batch: entry.batchCount,
        units: units.map((unit) => ({ unitId: unit.unitId, questionId: unit.questionId })),
      });
    }
    return { plan: nextPlan, units, planChanged: changed };
  }

  /** 主管合并单元结果：覆盖判断依据有效发现；关闭问题的答案被忽略。 */
  async function mergeUnitResults(taskId: string, answers: AnalysisAnswer[]): Promise<ResearchAnalysisType> {
    const row = await loadTaskRow(taskId);
    assertWritable(row);
    const plan = row.plan;
    if (!plan) {
      throw new StageFailureError("INTERNAL_ERROR", "合并结果时缺少全局计划。");
    }
    const openQuestions = plan.questions.filter((question) => question.closedReason === null);
    const openIds = new Set(openQuestions.map((question) => question.id));
    const findingIds = new Set(row.findings.map((finding) => finding.id));

    // 容错合并：剔除幻觉或不归属本任务的 finding 引用，并按实际有效依据降级覆盖判断。
    // 不静默接受无依据的 supported，也不因单条模型错误丢弃整轮已有证据。
    const normalized: AnalysisAnswer[] = [];
    for (const answer of answers) {
      if (!openIds.has(answer.questionId)) continue;
      const validFindingIds = answer.findingIds.filter((findingId) => findingIds.has(findingId));
      const dropped = answer.findingIds.length - validFindingIds.length;
      if (answer.coverage === "unanswered" || validFindingIds.length === 0) {
        normalized.push({
          ...answer,
          coverage: "unanswered",
          findingIds: [],
          gaps: answer.gaps.length > 0 ? answer.gaps : ["本轮合并未取得可用依据。"],
        });
        continue;
      }
      let coverage = answer.coverage;
      if (coverage === "contested" && validFindingIds.length < 2) {
        coverage = "partial";
      }
      if (coverage === "supported" && validFindingIds.length < 1) {
        coverage = "partial";
      }
      normalized.push({
        ...answer,
        coverage,
        findingIds: validFindingIds,
        gaps:
          dropped > 0
            ? [...answer.gaps, `合并时有 ${dropped} 条依据引用无效被剔除。`].slice(0, 10)
            : answer.gaps,
      });
    }
    // 模型遗漏的开放子问题：优先继承上一轮有效判断，只有从未有过依据时才按未回答补齐。
    const answeredIds = new Set(normalized.map((answer) => answer.questionId));
    const previousAnswers = new Map((row.analysis?.answers ?? []).map((answer) => [answer.questionId, answer]));
    for (const question of openQuestions) {
      if (answeredIds.has(question.id)) continue;
      const carried = previousAnswers.get(question.id);
      if (carried && carried.coverage !== "unanswered") {
        normalized.push(carried);
        continue;
      }
      normalized.push({
        questionId: question.id,
        coverage: "unanswered",
        text: "本轮合并未给出判断。",
        findingIds: [],
        gaps: ["尚未合并到有效依据。"],
      });
    }
    const analysis: ResearchAnalysisType = { answers: normalized };
    const ok = await store.saveAnalysis(taskId, analysis);
    if (!ok) {
      throw new StageFailureError("UPSTREAM_ERROR", "分析写入被拒绝，任务可能已结束。");
    }
    trace(taskId, {
      kind: "coverage",
      answers: normalized.map((answer) => ({ questionId: answer.questionId, coverage: answer.coverage })),
      usage: { searchRequests: row.usage.searchRequests, modelRequests: row.usage.modelRequests },
    });
    return analysis;
  }

  /** 探索是否可继续（预算/时间/来源维度）；结束原因供报告使用。 */
  async function evaluateExplorationEnd(taskId: string): Promise<{ continueAllowed: boolean; stopReason: StopReason | null }> {
    const row = await loadTaskRow(taskId);
    assertWritable(row);
    // 停止优先依据：开放子问题均已 supported/contested 且无关键缺口，继续调查没有合理新方向。
    if (row.plan) {
      const openQuestions = row.plan.questions.filter((question) => question.closedReason === null);
      const openIds = new Set(openQuestions.map((question) => question.id));
      const answers = (row.analysis?.answers ?? []).filter((answer) => openIds.has(answer.questionId));
      const complete =
        openQuestions.length > 0 &&
        answers.length === openQuestions.length &&
        answers.every(
          (answer) =>
            (answer.coverage === "supported" || answer.coverage === "contested") && answer.gaps.length === 0,
        );
      if (complete) {
        return { continueAllowed: false, stopReason: "sufficient" };
      }
    }
    if (row.usage.modelRequests >= row.limits.maxModelRequests) {
      return { continueAllowed: false, stopReason: "model_budget" };
    }
    if (row.usage.modelRequests >= explorationModelCap(row)) {
      return { continueAllowed: false, stopReason: "model_budget" };
    }
    if (row.usage.searchRequests >= row.limits.maxSearchRequests) {
      return { continueAllowed: false, stopReason: "search_budget" };
    }
    if (remainingMs(row) <= row.limits.synthesisTimeReserveMs) {
      return { continueAllowed: false, stopReason: "time_budget" };
    }
    if ((await store.countSources(taskId)) >= row.limits.maxSources) {
      return { continueAllowed: false, stopReason: "source_budget" };
    }
    return { continueAllowed: true, stopReason: null };
  }

  function recordExplorationStopReason(taskId: string, stopReason: StopReason): void {
    explorationStopReason.set(taskId, stopReason);
  }

  /** 主管建议成稿时的停止原因：关键问题已覆盖且无关键缺口为 sufficient，否则来源饱和。 */
  async function synthesizeStopReason(taskId: string): Promise<StopReason> {
    const row = await loadTaskRow(taskId);
    if (!row.plan) return "source_saturated";
    const openQuestions = row.plan.questions.filter((question) => question.closedReason === null);
    const openIds = new Set(openQuestions.map((question) => question.id));
    const answers = (row.analysis?.answers ?? []).filter((answer) => openIds.has(answer.questionId));
    const allCovered =
      answers.length === openQuestions.length &&
      answers.every(
        (answer) =>
          (answer.coverage === "supported" || answer.coverage === "contested") && answer.gaps.length === 0,
      );
    return allCovered ? "sufficient" : "source_saturated";
  }

  // ---------------------------------------------------------------------------
  // 成稿、核验与保存
  // ---------------------------------------------------------------------------

  /** 冻结成稿输入：必须有计划与至少一条有效发现，否则 EVIDENCE_REQUIRED。 */
  async function loadFinalizeContext(taskId: string): Promise<FinalizeContext> {
    const row = await loadTaskRow(taskId);
    assertWritable(row);
    if (!row.plan) {
      throw new StageFailureError("EVIDENCE_REQUIRED", "缺少研究计划，不能生成事实报告。");
    }
    const supportedFindings = row.findings.filter((finding) => finding.evidence.length > 0);
    if (supportedFindings.length === 0) {
      throw new StageFailureError("EVIDENCE_REQUIRED", "没有有效证据支持任何结论，不生成空泛报告。");
    }
    const sources = await store.listSources(taskId);
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const citedIds = [
      ...new Set(supportedFindings.flatMap((finding) => finding.evidence.map((citation) => citation.sourceId))),
    ].filter((id) => sourceById.has(id));
    const evidenceSources = citedIds.map((id) => sourceById.get(id)!);

    const openQuestions = row.plan.questions.filter((question) => question.closedReason === null);
    const openIds = new Set(openQuestions.map((question) => question.id));
    const answers = (row.analysis?.answers ?? []).filter((answer) => openIds.has(answer.questionId));
    const allCovered =
      answers.length === openQuestions.length &&
      answers.every(
        (answer) =>
          (answer.coverage === "supported" || answer.coverage === "contested") && answer.gaps.length === 0,
      );
    const stopReason: StopReason = explorationStopReason.get(taskId) ?? (allCovered ? "sufficient" : "source_saturated");
    const completeness = allCovered && stopReason === "sufficient" ? "sufficient" : "partial";
    return {
      question: row.question,
      plan: row.plan,
      findings: supportedFindings,
      analysis: row.analysis,
      excerpts: buildExcerpts(evidenceSources.length > 0 ? evidenceSources : sources),
      stopReason,
      completeness,
    };
  }

  /** 核验发现重要缺口时的一次定向回查准入。 */
  async function reserveRepairPass(taskId: string): Promise<boolean> {
    const row = await loadTaskRow(taskId);
    assertWritable(row);
    const entry = ledger(taskId);
    if (entry.repairPassesUsed >= row.limits.maxRepairPasses) return false;
    if (remainingMs(row) <= REPAIR_UNIT_MS + FINAL_PROCESSING_RESERVE_MS) return false;
    entry.repairPassesUsed += 1;
    return true;
  }

  /** 确定性引用检查：findingIds 归属本任务且段落有依据。 */
  async function validateDraft(
    taskId: string,
    draft: import("../contracts/research.ts").ReportModelOutput,
  ): Promise<void> {
    const row = await loadTaskRow(taskId);
    assertWritable(row);
    const findingIds = new Set(row.findings.map((finding) => finding.id));
    if (draft.sections.conclusion.length === 0 || draft.sections.evidence.length === 0) {
      throw new StageFailureError("MODEL_OUTPUT_INVALID", "报告 conclusion 与 evidence 必须非空。");
    }
    for (const paragraph of [
      ...draft.sections.conclusion,
      ...draft.sections.evidence,
      ...draft.sections.disagreements,
    ]) {
      if (paragraph.findingIds.length === 0) {
        throw new StageFailureError("INVALID_CITATION", "实质性段落必须引用至少一条发现。");
      }
      for (const findingId of paragraph.findingIds) {
        if (!findingIds.has(findingId)) {
          throw new StageFailureError("INVALID_CITATION", `报告引用了不属于本任务的发现 ${findingId}。`);
        }
      }
    }
  }

  /**
   * 派生段落来源并原子保存报告与 completed outcome。
   * sourceIds 由应用从 finding 证据派生，不接受模型编造。
   */
  async function finalizeReport(
    taskId: string,
    draft: import("../contracts/research.ts").ReportModelOutput,
    finalize: {
      stopReason: StopReason;
      completeness: "sufficient" | "partial";
      additionalLimitations?: string[];
    },
  ): Promise<ResearchReportType> {
    // 重复保存先返回已有报告：产品已提交时框架迟到结果不得覆盖或报错。
    const existing = await store.getReportByTaskId(taskId);
    if (existing) return existing;
    const row = await loadTaskRow(taskId);
    assertWritable(row);
    if (!row.plan) {
      throw new StageFailureError("EVIDENCE_REQUIRED", "缺少研究计划，不能保存报告。");
    }
    const findings = new Map(row.findings.map((finding) => [finding.id, finding]));
    const deriveSources = (paragraph: { findingIds: string[] }): string[] => {
      const ids: string[] = [];
      for (const findingId of paragraph.findingIds) {
        const finding = findings.get(findingId);
        if (!finding) {
          throw new StageFailureError("INVALID_CITATION", `报告引用了不属于本任务的发现 ${findingId}。`);
        }
        for (const citation of finding.evidence) {
          if (!ids.includes(citation.sourceId)) ids.push(citation.sourceId);
        }
      }
      return ids;
    };

    const sections = {
      conclusion: draft.sections.conclusion.map((paragraph) => deriveParagraph(paragraph, deriveSources)),
      evidence: draft.sections.evidence.map((paragraph) => deriveParagraph(paragraph, deriveSources)),
      disagreements: draft.sections.disagreements.map((paragraph) => deriveParagraph(paragraph, deriveSources)),
      gaps: draft.sections.gaps,
    };
    if (sections.conclusion.length === 0 || sections.evidence.length === 0) {
      throw new StageFailureError("MODEL_OUTPUT_INVALID", "报告 conclusion 与 evidence 必须非空。");
    }
    const usedSourceIds = [
      ...new Set([...sections.conclusion, ...sections.evidence, ...sections.disagreements].flatMap((p) => p.sourceIds)),
    ];
    if (usedSourceIds.length === 0) {
      throw new StageFailureError("INVALID_CITATION", "报告没有引用任何本任务来源。");
    }

    const limitations = buildLimitations(row, finalize.stopReason);
    for (const gap of draft.sections.gaps.slice(0, 3)) {
      limitations.push(`缺口：${gap}`);
    }
    limitations.push(...(finalize.additionalLimitations ?? []).slice(0, 3));

    const report: ResearchReportType = {
      id: `report-${shortId()}`,
      taskId,
      title: draft.title,
      sections,
      sourceIds: usedSourceIds,
      completeness: finalize.completeness,
      stopReason: finalize.stopReason,
      limitations,
      createdAt: clock().toISOString(),
    };
    const result = await store.commitReport(report);
    if (result.result === "saved" && result.report) {
      trace(taskId, {
        kind: "terminal",
        outcome: "completed",
        errorCode: null,
        stopReason: report.stopReason,
        usage: row.usage,
      });
      return result.report;
    }
    if (result.result === "already_saved" && result.report) {
      return result.report;
    }
    throw new StageFailureError("UPSTREAM_ERROR", "报告保存被拒绝，任务可能已被取消。");
  }

  function deriveParagraph(
    paragraph: { text: string; findingIds: string[] },
    deriveSources: (paragraph: { findingIds: string[] }) => string[],
  ): { text: string; findingIds: string[]; sourceIds: string[] } {
    return { text: paragraph.text, findingIds: paragraph.findingIds, sourceIds: deriveSources(paragraph) };
  }

  function buildLimitations(row: TaskRow, stopReason: StopReason): string[] {
    const items = ["仅使用知乎搜索摘要，未阅读原文全文。"];
    if (!row.allowWebSupplement) {
      items.push("未使用全网补证，官方事实未经独立核对。");
    }
    if (stopReason === "search_budget" || stopReason === "source_budget") {
      items.push("检索受预算限制，样本可能不完整。");
    }
    if (stopReason === "time_budget" || stopReason === "model_budget") {
      items.push("研究在资源上限内收尾，部分问题可能未充分探索。");
    }
    return items;
  }

  // ---------------------------------------------------------------------------
  // 读模型与上下文构建
  // ---------------------------------------------------------------------------

  async function loadExecutionContext(taskId: string): Promise<{
    question: string;
    allowWebSupplement: boolean;
    plan: ResearchPlanType | null;
    findings: ResearchFindingType[];
    analysis: ResearchAnalysisType | null;
    limits: LimitsType;
  }> {
    const row = await loadTaskRow(taskId);
    assertWritable(row);
    return {
      question: row.question,
      allowWebSupplement: row.allowWebSupplement,
      plan: row.plan,
      findings: row.findings,
      analysis: row.analysis,
      limits: row.limits,
    };
  }

  /** 主管上下文：固定目标、当前计划、单元回执、发现摘要、剩余额度。 */
  async function loadSupervisorContext(taskId: string): Promise<{
    question: string;
    allowWebSupplement: boolean;
    plan: ResearchPlanType | null;
    findings: ResearchFindingType[];
    analysis: ResearchAnalysisType | null;
    unitReceipts: UnitReceipt[];
    queryLog: QueryLogEntryType[];
    remaining: {
      searchRequests: number;
      explorationModelRequests: number;
      sources: number;
      remainingMs: number;
    };
  }> {
    const row = await loadTaskRow(taskId);
    assertWritable(row);
    const sourceCount = await store.countSources(taskId);
    return {
      question: row.question,
      allowWebSupplement: row.allowWebSupplement,
      plan: row.plan,
      findings: row.findings,
      analysis: row.analysis,
      unitReceipts: row.unitReceipts,
      queryLog: row.queryLog,
      remaining: {
        searchRequests: Math.max(0, row.limits.maxSearchRequests - row.usage.searchRequests),
        explorationModelRequests: Math.max(0, explorationModelCap(row) - row.usage.modelRequests),
        sources: Math.max(0, row.limits.maxSources - sourceCount),
        remainingMs: remainingMs(row),
      },
    };
  }

  /** 单元上下文：相关已有发现、本地额度与可用渠道。 */
  async function loadUnitContext(taskId: string, unitId: string): Promise<{
    question: string;
    plan: ResearchPlanType;
    relatedFindings: ResearchFindingType[];
    remaining: {
      searches: number;
      modelSteps: number;
      unitMs: number;
    };
  } | null> {
    const row = await loadTaskRow(taskId);
    if (row.outcome !== null || !row.plan) return null;
    return {
      question: row.question,
      plan: row.plan,
      relatedFindings: row.findings,
      remaining: {
        searches: Math.max(0, row.limits.unitMaxSearchRequests - row.queryLog.filter((entry) => entry.unitId === unitId).length),
        modelSteps: row.limits.unitMaxSteps,
        unitMs: Math.max(0, row.limits.unitTimeoutMs - unitElapsedMs(taskId, unitId)),
      },
    };
  }

  async function remainingTimeMs(taskId: string): Promise<number> {
    return remainingMs(await loadTaskRow(taskId));
  }

  return {
    attachExecutionPort,
    recordStage,
    createResearchTask,
    getResearchTaskDetail,
    listResearchTasks,
    cancelResearchTask,
    listResearchSources,
    getResearchReport,
    exportResearchReportMarkdown,
    recoverInterruptedTasks,
    failTask,
    confirmExecutionEnd,
    markExecutionStarted,
    hasPendingQueries,
    admitModelSteps,
    consumeModelStep,
    releaseModelReservation,
    beginUnitTracking,
    endUnitTracking,
    unitSearch,
    readSourceExcerpt,
    commitUnitFindings,
    saveUnitReceipt,
    listUnitSources,
    hasStalledUnits,
    submitInitialPlan,
    applySupervisorDecision,
    mergeUnitResults,
    evaluateExplorationEnd,
    recordExplorationStopReason,
    synthesizeStopReason,
    reserveRepairPass,
    loadExecutionContext,
    loadSupervisorContext,
    loadUnitContext,
    loadFinalizeContext,
    validateDraft,
    finalizeReport,
    remainingTimeMs,
    limits,
  };
}

export type DeepResearchSystem = ReturnType<typeof createDeepResearchSystem>;

// ---------------------------------------------------------------------------
// 工具内部辅助
// ---------------------------------------------------------------------------

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Markdown 渲染：由报告与已保存来源确定性生成；编号按首次出现顺序分配。
// ---------------------------------------------------------------------------

export function renderReportMarkdown(report: ResearchReportType, sources: ResearchSourceType[]): string {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const orderedIds: string[] = [];
  for (const paragraph of [...report.sections.conclusion, ...report.sections.evidence, ...report.sections.disagreements]) {
    for (const sourceId of paragraph.sourceIds) {
      if (!orderedIds.includes(sourceId)) orderedIds.push(sourceId);
    }
  }
  const citationNumber = new Map(orderedIds.map((id, index) => [id, index + 1]));

  const renderParagraphs = (paragraphs: { text: string; sourceIds: string[] }[]) =>
    paragraphs
      .map((paragraph) => {
        const marks = paragraph.sourceIds
          .map((id) => citationNumber.get(id))
          .filter((n): n is number => n !== undefined)
          .map((n) => `[${n}]`)
          .join("");
        return `- ${paragraph.text}${marks ? ` ${marks}` : ""}`;
      })
      .join("\n");

  const lines: string[] = [
    `# ${report.title}`,
    "",
    `> 完整度：${report.completeness === "sufficient" ? "充分" : "部分"} · 结束原因：${stopReasonLabel(report.stopReason)} · 生成时间：${report.createdAt}`,
    "",
    "## 结论",
    renderParagraphs(report.sections.conclusion),
    "",
    "## 依据",
    renderParagraphs(report.sections.evidence),
  ];
  if (report.sections.disagreements.length > 0) {
    lines.push("", "## 分歧", renderParagraphs(report.sections.disagreements));
  }
  if (report.sections.gaps.length > 0) {
    lines.push("", "## 缺口", ...report.sections.gaps.map((gap) => `- ${gap}`));
  }
  lines.push("", "## 限制", ...report.limitations.map((item) => `- ${item}`));
  lines.push("", "## 来源");
  orderedIds.forEach((id, index) => {
    const source = sourceById.get(id);
    if (!source) return;
    const time = source.sourceTime ? `（时间：${source.sourceTime}，${timeKindLabel(source.timeKind)}）` : "（时间未知）";
    lines.push(`${index + 1}. ${source.title}${time} ${source.url}`);
  });
  return lines.join("\n");
}

function timeKindLabel(timeKind: string): string {
  return timeKind === "published" ? "发布时间" : "发布/更新时间";
}

function stopReasonLabel(stopReason: ResearchReportType["stopReason"]): string {
  switch (stopReason) {
    case "sufficient": return "证据已覆盖关键问题";
    case "source_saturated": return "来源在不同策略下已饱和";
    case "search_budget": return "达到检索预算";
    case "model_budget": return "达到模型调用预算";
    case "time_budget": return "达到时间上限";
    case "source_budget": return "达到来源快照上限";
    case "upstream_unavailable": return "上游无法继续提供资料";
  }
}
