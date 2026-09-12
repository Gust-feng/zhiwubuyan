import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client, type InStatement, type Transaction } from "@libsql/client";
import {
  Limits,
  ModelInfo,
  QueryLogEntry,
  ResearchAnalysis,
  ResearchFinding,
  ResearchPlan,
  ResearchReport,
  ResearchSource,
  QuickAnswer,
  TaskError,
  UnitReceipt,
  Usage,
  type Limits as LimitsType,
  type ModelInfo as ModelInfoType,
  type QueryLogEntry as QueryLogEntryType,
  type ResearchAnalysis as ResearchAnalysisType,
  type ResearchFinding as ResearchFindingType,
  type ResearchPlan as ResearchPlanType,
  type ResearchReport as ResearchReportType,
  type QuickAnswer as QuickAnswerType,
  type ResearchSource as ResearchSourceType,
  type TaskError as TaskErrorType,
  type ResearchTier,
  type UnitReceipt as UnitReceiptType,
  type Usage as UsageType,
} from "../contracts/research.ts";

export const PRODUCT_SCHEMA_VERSION = 1;

export type TaskOutcome = "completed" | "failed" | "cancelled" | "interrupted";

export type TaskRow = {
  taskId: string;
  requestId: string;
  inputHash: string;
  question: string;
  tier: ResearchTier;
  allowWebSupplement: boolean;
  frameworkRunId: string | null;
  outcome: TaskOutcome | null;
  error: TaskErrorType | null;
  answer: QuickAnswerType | null;
  plan: ResearchPlanType | null;
  findings: ResearchFindingType[];
  analysis: ResearchAnalysisType | null;
  queryLog: QueryLogEntryType[];
  unitReceipts: UnitReceiptType[];
  usage: UsageType;
  limits: LimitsType;
  modelInfo: ModelInfoType;
  createdAt: string;
  endedAt: string | null;
};

export class StorageError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "StorageError";
    this.cause = cause;
  }
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS research_tasks (
    task_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    input_hash TEXT NOT NULL,
    question TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'ultra',
    allow_web_supplement INTEGER NOT NULL,
    answer_json TEXT,
    framework_run_id TEXT,
    outcome TEXT,
    error_code TEXT,
    error_message TEXT,
    plan_json TEXT,
    analysis_json TEXT,
    findings_json TEXT NOT NULL DEFAULT '[]',
    query_log_json TEXT NOT NULL DEFAULT '[]',
    unit_receipts_json TEXT NOT NULL DEFAULT '[]',
    usage_json TEXT NOT NULL,
    limits_json TEXT NOT NULL,
    model_info_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ended_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS research_sources (
    source_id TEXT NOT NULL PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES research_tasks(task_id),
    channel TEXT NOT NULL,
    identity TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    source_json TEXT NOT NULL,
    first_retrieved_at TEXT NOT NULL,
    UNIQUE (task_id, channel, identity, text_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS research_reports (
    report_id TEXT NOT NULL PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE REFERENCES research_tasks(task_id),
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

/** 打开产品库并确保 schema。schema 不兼容时明确失败，不删除数据。 */
export async function openResearchStore(dataDir: string): Promise<ResearchStore> {
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "product.sqlite");
  const client = createClient({ url: pathToFileURL(dbPath).href });
  try {
    await client.executeMultiple("PRAGMA journal_mode = WAL;");
    await client.executeMultiple("PRAGMA foreign_keys = ON;");
    await client.executeMultiple("PRAGMA busy_timeout = 5000;");
    const version = await client.execute("PRAGMA user_version;");
    const current = Number(version.rows[0]?.user_version ?? 0);
    if (current === 0) {
      await client.executeMultiple(SCHEMA_STATEMENTS.join(";\n") + ";");
      await client.execute(`PRAGMA user_version = ${PRODUCT_SCHEMA_VERSION};`);
    } else if (current !== PRODUCT_SCHEMA_VERSION) {
      throw new StorageError(
        `产品库 schema 版本不兼容：当前 v${current}，需要 v${PRODUCT_SCHEMA_VERSION}。请使用显式维护命令处理。`,
      );
    }
    const store = new ResearchStore(client);
    return store;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("产品库初始化失败。", error);
  }
}

/**
 * 产品库唯一写入入口：任务、来源、报告三类事实。
 * 事务保持短小，不等待模型或网络；写许可由 outcome 条件更新保证。
 */
export class ResearchStore {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  private async exec(statement: InStatement) {
    try {
      return await this.client.execute(statement);
    } catch (error) {
      throw new StorageError("产品库操作失败。", error);
    }
  }

  private async withWriteTransaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
    let transaction: Transaction;
    try {
      transaction = await this.client.transaction("write");
    } catch (error) {
      throw new StorageError("产品库事务开启失败。", error);
    }
    try {
      const result = await run(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      try {
        await transaction.rollback();
      } catch {
        // 回滚失败不影响原错误
      }
      if (error instanceof StorageError) throw error;
      throw new StorageError("产品库事务失败。", error);
    }
  }

  async findTaskByRequestId(requestId: string): Promise<TaskRow | null> {
    return await this.queryTask({ sql: "SELECT * FROM research_tasks WHERE request_id = ?", args: [requestId] });
  }

  async getTask(taskId: string): Promise<TaskRow | null> {
    return await this.queryTask({ sql: "SELECT * FROM research_tasks WHERE task_id = ?", args: [taskId] });
  }

  async listTasks(limit: number, offset: number): Promise<TaskRow[]> {
    const result = await this.exec({
      sql: "SELECT * FROM research_tasks ORDER BY created_at DESC, task_id DESC LIMIT ? OFFSET ?",
      args: [limit, offset],
    });
    return result.rows.map((row) => parseTaskRow(rowToRecord(row)));
  }

  async countActiveTasks(): Promise<number> {
    const result = await this.exec("SELECT COUNT(*) AS n FROM research_tasks WHERE outcome IS NULL");
    return Number(result.rows[0]?.n ?? 0);
  }

  async insertTask(row: {
    taskId: string;
    requestId: string;
    inputHash: string;
    question: string;
    tier: ResearchTier;
    allowWebSupplement: boolean;
    usage: UsageType;
    limits: LimitsType;
    modelInfo: ModelInfoType;
    createdAt: string;
  }): Promise<void> {
    await this.exec({
      sql: `INSERT INTO research_tasks
        (task_id, request_id, input_hash, question, tier, allow_web_supplement, outcome, query_log_json, usage_json, limits_json, model_info_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?, ?, ?)`,
      args: [
        row.taskId,
        row.requestId,
        row.inputHash,
        row.question,
        row.tier,
        row.allowWebSupplement ? 1 : 0,
        JSON.stringify(row.usage),
        JSON.stringify(row.limits),
        JSON.stringify(row.modelInfo),
        row.createdAt,
      ],
    });
  }

  /**
   * 保存全局计划：主管是唯一写入入口，版本递增由应用负责；
   * 只受 outcome 写许可约束（可变计划，覆盖保存）。
   */
  async savePlan(taskId: string, plan: ResearchPlanType): Promise<boolean> {
    const result = await this.exec({
      sql: "UPDATE research_tasks SET plan_json = ? WHERE task_id = ? AND outcome IS NULL",
      args: [JSON.stringify(plan), taskId],
    });
    return result.rowsAffected > 0;
  }

  /** 分析保留最近一次通过校验的合并结果。 */
  async saveAnalysis(taskId: string, analysis: ResearchAnalysisType): Promise<boolean> {
    const result = await this.exec({
      sql: "UPDATE research_tasks SET analysis_json = ? WHERE task_id = ? AND outcome IS NULL",
      args: [JSON.stringify(analysis), taskId],
    });
    return result.rowsAffected > 0;
  }

  /**
   * 追加发现：同 findingId 幂等；在事务内重查写许可。
   * 返回实际新增的发现。
   */
  async appendFindings(taskId: string, findings: ResearchFindingType[]): Promise<ResearchFindingType[]> {
    if (findings.length === 0) return [];
    return await this.withWriteTransaction(async (tx) => {
      const closed = await tx.execute({
        sql: "SELECT outcome IS NOT NULL AS closed, findings_json FROM research_tasks WHERE task_id = ?",
        args: [taskId],
      });
      const row = closed.rows[0];
      if (!row || Number(row.closed ?? 1) !== 0) return [];
      const existing = ResearchFinding.array().parse(JSON.parse(String(row.findings_json ?? "[]")));
      const byId = new Map(existing.map((item) => [item.id, item]));
      const added: ResearchFindingType[] = [];
      for (const finding of findings) {
        if (byId.has(finding.id)) continue;
        byId.set(finding.id, finding);
        added.push(finding);
      }
      if (added.length === 0) return [];
      await tx.execute({
        sql: "UPDATE research_tasks SET findings_json = ? WHERE task_id = ? AND outcome IS NULL",
        args: [JSON.stringify([...byId.values()]), taskId],
      });
      return added;
    });
  }

  /** 追加单元结果回执：同 unitId 幂等，重复完成不重复累计。 */
  async saveUnitReceipt(taskId: string, receipt: UnitReceiptType): Promise<boolean> {
    return await this.withWriteTransaction(async (tx) => {
      const row = await tx.execute({
        sql: "SELECT outcome IS NOT NULL AS closed, unit_receipts_json FROM research_tasks WHERE task_id = ?",
        args: [taskId],
      });
      const record = row.rows[0];
      if (!record || Number(record.closed ?? 1) !== 0) return false;
      const existing = UnitReceipt.array().parse(JSON.parse(String(record.unit_receipts_json ?? "[]")));
      if (existing.some((item) => item.unitId === receipt.unitId)) return false;
      await tx.execute({
        sql: "UPDATE research_tasks SET unit_receipts_json = ? WHERE task_id = ? AND outcome IS NULL",
        args: [JSON.stringify([...existing, receipt]), taskId],
      });
      return true;
    });
  }

  /** 条件追加查询日志；超限条目由调用方裁剪。 */
  async appendQueryLog(taskId: string, entries: QueryLogEntryType[]): Promise<boolean> {
    const result = await this.exec({
      sql: "UPDATE research_tasks SET query_log_json = ? WHERE task_id = ? AND outcome IS NULL",
      args: [JSON.stringify(entries), taskId],
    });
    return result.rowsAffected > 0;
  }

  /**
   * 搜索准入与计数必须在同一产品事务中完成，避免并行调查互相覆盖 query log 或 usage。
   */
  async admitSearch(
    taskId: string,
    entry: QueryLogEntryType,
    maxSearchRequests: number,
  ): Promise<boolean> {
    return await this.withWriteTransaction(async (tx) => {
      const result = await tx.execute({
        sql: "SELECT outcome, query_log_json, usage_json FROM research_tasks WHERE task_id = ?",
        args: [taskId],
      });
      const row = result.rows[0];
      if (!row || row.outcome !== null) return false;
      const currentUsage = Usage.parse(JSON.parse(String(row.usage_json)));
      if (currentUsage.searchRequests >= maxSearchRequests) return false;
      const currentLog = QueryLogEntry.array().max(160).parse(JSON.parse(String(row.query_log_json)));
      await tx.execute({
        sql: "UPDATE research_tasks SET query_log_json = ?, usage_json = ? WHERE task_id = ? AND outcome IS NULL",
        args: [
          JSON.stringify([...currentLog, entry]),
          JSON.stringify({ ...currentUsage, searchRequests: currentUsage.searchRequests + 1 }),
          taskId,
        ],
      });
      return true;
    });
  }

  /** 按稳定来源键读取数据库中已经存在的来源，供 duplicate 插入结果复用真实 sourceId。 */
  async findSourceByKey(
    taskId: string,
    channel: ResearchSourceType["channel"],
    identity: string,
    textHash: string,
  ): Promise<ResearchSourceType | null> {
    const result = await this.exec({
      sql: "SELECT source_json FROM research_sources WHERE task_id = ? AND channel = ? AND identity = ? AND text_hash = ?",
      args: [taskId, channel, identity, textHash],
    });
    const raw = result.rows[0] ? String(rowToRecord(result.rows[0]).source_json) : null;
    if (!raw) return null;
    const parsed = ResearchSource.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  async saveUsage(taskId: string, usage: UsageType): Promise<boolean> {
    const result = await this.exec({
      sql: "UPDATE research_tasks SET usage_json = ? WHERE task_id = ? AND outcome IS NULL",
      args: [JSON.stringify(usage), taskId],
    });
    return result.rowsAffected > 0;
  }

  async setFrameworkRunId(taskId: string, runId: string): Promise<void> {
    await this.exec({
      sql: "UPDATE research_tasks SET framework_run_id = ? WHERE task_id = ?",
      args: [runId, taskId],
    });
  }

  /**
   * 条件终态：仅当 outcome 仍为空时写入，保证取消/完成/失败互不覆盖。
   */
  async setOutcome(taskId: string, outcome: TaskOutcome, error: TaskErrorType | null): Promise<boolean> {
    const result = await this.exec({
      sql: "UPDATE research_tasks SET outcome = ?, error_code = ?, error_message = ? WHERE task_id = ? AND outcome IS NULL",
      args: [outcome, error?.code ?? null, error?.message ?? null, taskId],
    });
    return result.rowsAffected > 0;
  }

  /** 快答完成：answer 与 completed outcome 同事务提交；重复提交返回已有答案。 */
  async commitQuickAnswer(
    taskId: string,
    answer: QuickAnswerType,
  ): Promise<{ result: "saved" | "already_saved"; answer: QuickAnswerType | null }> {
    return await this.withWriteTransaction(async (tx) => {
      const existing = await tx.execute({
        sql: "SELECT answer_json, outcome FROM research_tasks WHERE task_id = ?",
        args: [taskId],
      });
      const row = existing.rows[0];
      if (!row || row.outcome != null) {
        // 任务不存在或已有终态；answer_json 已有内容时按重复保存返回。
        if (row?.answer_json != null) {
          const parsed = QuickAnswer.safeParse(JSON.parse(String(row.answer_json)));
          if (parsed.success) return { result: "already_saved" as const, answer: parsed.data };
        }
        return { result: "already_saved" as const, answer: null };
      }
      if (row.answer_json != null) {
        const parsed = QuickAnswer.safeParse(JSON.parse(String(row.answer_json)));
        return parsed.success
          ? { result: "already_saved" as const, answer: parsed.data }
          : { result: "already_saved" as const, answer: null };
      }
      await tx.execute({
        sql: "UPDATE research_tasks SET answer_json = ?, outcome = 'completed', ended_at = ? WHERE task_id = ? AND outcome IS NULL",
        args: [JSON.stringify(answer), answer.generatedAt, taskId],
      });
      return { result: "saved" as const, answer };
    });
  }

  /** 收尾：设置结束时间；已取消任务与正常结束任务都可能调用，幂等。 */
  async setEndedAt(taskId: string, endedAt: string): Promise<void> {
    await this.exec({
      sql: "UPDATE research_tasks SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL",
      args: [endedAt, taskId],
    });
  }

  /** 重启收敛：没有产品终态的旧任务标记 interrupted，不重放请求。 */
  async markInterruptedTasks(endedAt: string): Promise<string[]> {
    const select = await this.exec("SELECT task_id FROM research_tasks WHERE outcome IS NULL");
    const ids = select.rows.map((row) => String(rowToRecord(row).task_id));
    if (ids.length === 0) return [];
    await this.exec({
      sql: "UPDATE research_tasks SET outcome = 'interrupted', ended_at = ? WHERE outcome IS NULL",
      args: [endedAt],
    });
    return ids;
  }

  /** 写来源：先在事务内检查写许可与数量上限，再插入；unique(taskId,channel,identity,textHash) 去重。 */
  async insertSource(source: ResearchSourceType, maxSources: number): Promise<"saved" | "duplicate" | "rejected"> {
    return await this.withWriteTransaction(async (tx) => {
      const taskResult = await tx.execute({
        sql: "SELECT outcome IS NOT NULL AS closed FROM research_tasks WHERE task_id = ?",
        args: [source.taskId],
      });
      if (Number(taskResult.rows[0]?.closed ?? 1) !== 0) return "rejected" as const;
      const countResult = await tx.execute({
        sql: "SELECT COUNT(*) AS n FROM research_sources WHERE task_id = ?",
        args: [source.taskId],
      });
      if (Number(countResult.rows[0]?.n ?? 0) >= maxSources) return "rejected" as const;
      const insert = await tx.execute({
        sql: `INSERT INTO research_sources (source_id, task_id, channel, identity, text_hash, source_json, first_retrieved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(task_id, channel, identity, text_hash) DO NOTHING`,
        args: [
          source.id,
          source.taskId,
          source.channel,
          source.identity,
          source.textHash,
          JSON.stringify(source),
          source.retrievedAt,
        ],
      });
      return insert.rowsAffected > 0 ? ("saved" as const) : ("duplicate" as const);
    });
  }

  async listSources(taskId: string): Promise<ResearchSourceType[]> {
    const result = await this.exec({
      sql: "SELECT source_json FROM research_sources WHERE task_id = ? ORDER BY first_retrieved_at, source_id",
      args: [taskId],
    });
    return result.rows.flatMap((row) => {
      const parsed = ResearchSource.safeParse(JSON.parse(String(rowToRecord(row).source_json)));
      return parsed.success ? [parsed.data] : [];
    });
  }

  async countSources(taskId: string): Promise<number> {
    const result = await this.exec({
      sql: "SELECT COUNT(*) AS n FROM research_sources WHERE task_id = ?",
      args: [taskId],
    });
    return Number(result.rows[0]?.n ?? 0);
  }

  /**
   * 报告与 completed outcome 原子提交。重复保存返回已有报告；
   * 任务已被取消/失败时拒绝写入。
   */
  async commitReport(
    report: ResearchReportType,
  ): Promise<{ result: "saved" | "already_saved" | "rejected"; report: ResearchReportType | null }> {
    return await this.withWriteTransaction(async (tx) => {
      const existing = await tx.execute({
        sql: "SELECT report_json FROM research_reports WHERE task_id = ?",
        args: [report.taskId],
      });
      const existingRaw = existing.rows[0] ? String(existing.rows[0].report_json) : null;
      if (existingRaw) {
        const parsed = ResearchReport.safeParse(JSON.parse(existingRaw));
        return parsed.success
          ? { result: "already_saved" as const, report: parsed.data }
          : { result: "rejected" as const, report: null };
      }
      const closedResult = await tx.execute({
        sql: "SELECT outcome IS NOT NULL AS closed FROM research_tasks WHERE task_id = ?",
        args: [report.taskId],
      });
      if (Number(closedResult.rows[0]?.closed ?? 1) !== 0) return { result: "rejected" as const, report: null };
      await tx.execute({
        sql: "INSERT INTO research_reports (report_id, task_id, report_json, created_at) VALUES (?, ?, ?, ?)",
        args: [report.id, report.taskId, JSON.stringify(report), report.createdAt],
      });
      const completed = await tx.execute({
        sql: "UPDATE research_tasks SET outcome = 'completed', ended_at = ? WHERE task_id = ? AND outcome IS NULL",
        args: [report.createdAt, report.taskId],
      });
      if (completed.rowsAffected === 0) return { result: "rejected" as const, report: null };
      return { result: "saved" as const, report };
    });
  }

  async getReportByTaskId(taskId: string): Promise<ResearchReportType | null> {
    const result = await this.exec({
      sql: "SELECT report_json FROM research_reports WHERE task_id = ?",
      args: [taskId],
    });
    const raw = result.rows[0] ? String(rowToRecord(result.rows[0]).report_json) : null;
    if (!raw) return null;
    const parsed = ResearchReport.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  /** 关闭底层连接（测试与停机使用）。 */
  async close(): Promise<void> {
    await this.client.close();
  }

  private async queryTask(statement: InStatement): Promise<TaskRow | null> {
    const result = await this.exec(statement);
    const row = result.rows[0];
    if (!row) return null;
    return parseTaskRow(rowToRecord(row));
  }
}

function rowToRecord(row: unknown): Record<string, unknown> {
  return row as Record<string, unknown>;
}

function parseTaskRow(record: Record<string, unknown>): TaskRow {
  const planJson = record.plan_json == null ? null : JSON.parse(String(record.plan_json));
  const analysisJson = record.analysis_json == null ? null : JSON.parse(String(record.analysis_json));
  const limits = Limits.safeParse(JSON.parse(String(record.limits_json)));
  const modelInfo = ModelInfo.safeParse(JSON.parse(String(record.model_info_json)));
  const usage = Usage.parse(JSON.parse(String(record.usage_json)));
  const queryLog = QueryLogEntry.array().max(160).parse(JSON.parse(String(record.query_log_json)));
  if (!limits.success) throw new StorageError("任务 limits 数据损坏。");
  if (!modelInfo.success) throw new StorageError("任务 modelInfo 数据损坏。");
  return {
    taskId: String(record.task_id),
    requestId: String(record.request_id),
    inputHash: String(record.input_hash),
    question: String(record.question),
    tier: (String(record.tier ?? "ultra") || "ultra") as ResearchTier,
    allowWebSupplement: Number(record.allow_web_supplement) === 1,
    frameworkRunId: record.framework_run_id == null ? null : String(record.framework_run_id),
    outcome: record.outcome == null ? null : (String(record.outcome) as TaskOutcome),
    error:
      record.error_code == null
        ? null
        : TaskError.parse({ code: String(record.error_code), message: String(record.error_message ?? "") }),
    answer:
      record.answer_json == null ? null : QuickAnswer.parse(JSON.parse(String(record.answer_json))),
    plan: planJson == null ? null : ResearchPlan.parse(planJson),
    findings: ResearchFinding.array().max(800).parse(JSON.parse(String(record.findings_json ?? "[]"))),
    analysis: analysisJson == null ? null : ResearchAnalysis.parse(analysisJson),
    queryLog,
    unitReceipts: UnitReceipt.array().parse(JSON.parse(String(record.unit_receipts_json ?? "[]"))),
    usage,
    limits: limits.data,
    modelInfo: modelInfo.data,
    createdAt: String(record.created_at),
    endedAt: record.ended_at == null ? null : String(record.ended_at),
  };
}
