import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  ReportModelOutput,
  ReviewModelOutput,
  SupervisorDecisionOutput,
  SupervisorMergeOutput,
  SupervisorPlanOutput,
  type ReportModelOutput as ReportModelOutputType,
  type ReviewIssue,
  type StopReason,
  type UnitReceipt,
} from "../contracts/research.ts";
import {
  StageFailureError,
  type DeepResearchSystem,
  type ResearchExecutionPort,
  type SourceExcerpt,
} from "../application/deep-research.ts";
import {
  SUPERVISOR_DECISION_SYSTEM,
  SUPERVISOR_MERGE_SYSTEM,
  SUPERVISOR_PLAN_SYSTEM,
  VERIFIER_SYSTEM,
  WRITER_SYSTEM,
  createResearcherRunner,
  createStageRunner,
  type StageRunner,
  type StageRunnerArgs,
} from "./research-agent.ts";

const TaskRefSchema = z.object({ taskId: z.string() });

const CycleStateSchema = z.object({
  taskId: z.string(),
  done: z.boolean(),
});

const DecisionStateSchema = z.object({
  taskId: z.string(),
  done: z.boolean(),
  units: z.array(
    z.object({
      unitId: z.string(),
      questionId: z.string(),
      objective: z.string(),
      focus: z.string(),
    }),
  ),
});

/** foreach 的迭代元素：附带 taskId，工具上下文与模型调用都绑定它。 */
const UnitDispatchSchema = z.object({
  taskId: z.string(),
  unitId: z.string(),
  questionId: z.string(),
  objective: z.string(),
  focus: z.string(),
});

const UnitResultSchema = z.object({
  unitId: z.string(),
  questionId: z.string(),
  ok: z.boolean(),
  suggestedQuestions: z.array(z.string()),
  error: z.string().nullable(),
});

const ReviewIssueSchema = z.object({
  section: z.enum(["conclusion", "evidence", "disagreements", "gaps"]),
  index: z.number().int().min(0),
  kind: z.enum(["unsupported", "overstated", "missing", "contradiction", "citation_mismatch"]),
  description: z.string(),
});

const DraftStateSchema = z.object({
  taskId: z.string(),
  draft: ReportModelOutput,
  finalizeMeta: z.object({
    stopReason: z.string(),
    completeness: z.enum(["sufficient", "partial"]),
    unresolvedReviewIssues: z.number().int().min(0),
  }),
  reviewIssues: z.array(ReviewIssueSchema).max(20),
});

/** 主管循环的安全迭代上限：预算与主管判断之外的进程保护。 */
const MAX_SUPERVISOR_ITERATIONS = 40;

export type ResearchWorkflowArgs = {
  engine: DeepResearchSystem;
  runner: StageRunner;
  researcher: ReturnType<typeof createResearcherRunner>;
};

/**
 * 深度研究顶层 Workflow（ADR-0006）：
 * 主管拆题 → （主管决策 → 最多三个并行调查单元 → 合并覆盖判断）循环 →
 * 撰写 → 确定性引用检查 → 核验 → 至多一次定向回查 → 改写并复验 → 保存。
 */
export function buildResearchWorkflow(args: ResearchWorkflowArgs) {
  const { engine, runner, researcher } = args;

  const planStep = createStep({
    id: "plan",
    inputSchema: TaskRefSchema,
    outputSchema: CycleStateSchema,
    retries: 0,
    execute: async ({ inputData, abortSignal }) => {
      const { taskId } = inputData;
      engine.recordStage(taskId, "planning");
      const context = await engine.loadExecutionContext(taskId);
      const plan = await runStageWithOneRetry(runner, {
        taskId,
        system: SUPERVISOR_PLAN_SYSTEM,
        user: buildSupervisorPlanUser(context.question),
        schema: SupervisorPlanOutput,
        signal: abortSignal,
        reservedSteps: 1,
        phase: "exploration",
      });
      await engine.submitInitialPlan(taskId, plan);
      return { taskId, done: false };
    },
  });

  const decideStep = createStep({
    id: "decide",
    inputSchema: CycleStateSchema,
    outputSchema: DecisionStateSchema,
    retries: 0,
    execute: async ({ inputData, abortSignal }) => {
      const { taskId } = inputData;
      engine.recordStage(taskId, "researching");
      const endExploration = (stopReason: StopReason): { taskId: string; done: boolean; units: never[] } => {
        engine.recordExplorationStopReason(taskId, stopReason);
        return { taskId, done: true, units: [] };
      };
      // 连续多批单元全部失败且没有任何有效发现：继续派发只会重复消耗预算。
      if (await engine.hasStalledUnits(taskId)) {
        return endExploration("upstream_unavailable");
      }
      let context;
      try {
        context = await engine.loadSupervisorContext(taskId);
      } catch (error) {
        if (error instanceof StageFailureError && (error.taskErrorCode === "TIMEOUT" || error.taskErrorCode === "BUDGET_EXCEEDED")) {
          return endExploration(error.taskErrorCode === "TIMEOUT" ? "time_budget" : "model_budget");
        }
        throw error;
      }

      let decision;
      try {
        decision = await runStageWithOneRetry(runner, {
          taskId,
          system: SUPERVISOR_DECISION_SYSTEM,
          user: buildSupervisorDecisionUser(context),
          schema: SupervisorDecisionOutput,
          signal: abortSignal,
          reservedSteps: 1,
          phase: "exploration",
        });
      } catch (error) {
        if (error instanceof StageFailureError) {
          // 预算/时间/网络受限时不再中断整项研究：已有有效发现则转入成稿，否则如实结束。
          if (error.taskErrorCode === "TIMEOUT" || error.taskErrorCode === "BUDGET_EXCEEDED") {
            return endExploration(error.taskErrorCode === "TIMEOUT" ? "time_budget" : "model_budget");
          }
          if (error.taskErrorCode === "UPSTREAM_ERROR") {
            return endExploration("upstream_unavailable");
          }
        }
        throw error;
      }

      if (decision.action === "synthesize") {
        return endExploration(await engine.synthesizeStopReason(taskId));
      }

      const budget = await engine.evaluateExplorationEnd(taskId);
      if (!budget.continueAllowed) {
        return endExploration(budget.stopReason ?? "model_budget");
      }

      const applied = await engine.applySupervisorDecision({ taskId, decision });
      if (applied.units.length === 0) {
        // 决定没有产生有效动作：一次结构修正；仍无效则结束探索并保留缺口。
        const revised = await runStageWithOneRetry(runner, {
          taskId,
          system: SUPERVISOR_DECISION_SYSTEM,
          user: [
            buildSupervisorDecisionUser(context),
            "",
            "你上一次的决定未通过应用校验（可能引用了未知或已关闭的问题、重复方向或没有有效单元）。请重新输出一个可执行的决定；若确无合理新方向，请选择 synthesize。",
            "上次决定：",
            JSON.stringify(decision, null, 2),
          ].join("\n"),
          schema: SupervisorDecisionOutput,
          signal: abortSignal,
          reservedSteps: 1,
          phase: "exploration",
        });
        if (revised.action === "synthesize") {
          return endExploration(await engine.synthesizeStopReason(taskId));
        }
        const reapplied = await engine.applySupervisorDecision({ taskId, decision: revised });
        if (reapplied.units.length === 0) {
          return endExploration("source_saturated");
        }
        return { taskId, done: false, units: reapplied.units };
      }
      return { taskId, done: false, units: applied.units };
    },
  });

  /** 把主管派发单映射为 foreach 输入数组（元素携带 taskId）。 */
  const unitsArrayStep = createStep({
    id: "collect-units",
    inputSchema: DecisionStateSchema,
    outputSchema: z.array(UnitDispatchSchema),
    retries: 0,
    execute: async ({ inputData }) => {
      return inputData.units.map((unit) => ({ ...unit, taskId: inputData.taskId }));
    },
  });

  const unitStep = createStep({
    id: "run-unit",
    inputSchema: UnitDispatchSchema,
    outputSchema: UnitResultSchema,
    retries: 0,
    execute: async ({ inputData, abortSignal }) => {
      return await runOneUnit(inputData, abortSignal);
    },
  });

  /**
   * 单元结构化输出修正：只把本单元已取得的来源交给模型做一次严格整理，
   * 不发起新的搜索，不扩大范围。
   */
  async function repairUnitOutput(args: {
    taskId: string;
    unitId: string;
    questionId: string;
    unit: z.infer<typeof UnitDispatchSchema>;
    question: string;
    allowWebSupplement: boolean;
    reason: string;
    signal: AbortSignal;
  }): Promise<{ output: import("../contracts/research.ts").ResearcherOutput; steps: number }> {
    // 修正调用也要预占推理额度；不足时不再发起，返回空结果由调用方处理。
    const repairReserve = 3;
    try {
      await engine.admitModelSteps(args.taskId, repairReserve, "exploration");
    } catch (error) {
      if (error instanceof StageFailureError) {
        return {
          output: { findings: [], suggestedQuestions: [] },
          steps: 0,
        };
      }
      throw error;
    }
    let repairConsumed = 0;
    const excerpts = await engine.listUnitSources(args.taskId, args.unitId);
    const sourcesBlock =
      excerpts.length > 0
        ? excerpts
            .map((s) => "### " + s.id + " | " + s.title + String.fromCharCode(10) + s.text)
            .join(String.fromCharCode(10, 10))
        : "（本单元没有取得可用摘要）";
    const user = [
      `研究总目标：${args.question}`,
      `本单元子问题 questionId=${args.questionId}；调查目标：${args.unit.objective}`,
      "",
      "上一次输出无法使用，原因：",
      args.reason,
      "",
      "只能依据以下已保存摘要整理发现（quote 必须逐字复制自 text，sourceId 必须是下列 ID）：",
      sourcesBlock,
      "",
      '输出 JSON：{"findings":[{"questionId":"' + args.questionId + '","statement":"...","kind":"fact|experience|opinion|inference","conditions":[],"limitations":[],"evidence":[{"sourceId":"...","quote":"...","relation":"support|oppose|qualify|context"}]}],"suggestedQuestions":[]}',
      "findings 最多 8 条，每条 1–3 个证据，只保留确实被摘要支持的发现；没有可支持的内容时返回空数组。",
    ].join(String.fromCharCode(10));
    try {
      const result = await researcher({
        taskId: args.taskId,
        unitId: args.unitId,
        questionId: args.questionId,
        allowWebSupplement: args.allowWebSupplement,
        user,
        maxSteps: repairReserve,
        signal: args.signal,
      });
      repairConsumed = result.steps;
      return result;
    } finally {
      if (repairReserve > repairConsumed) {
        await engine
          .releaseModelReservation(args.taskId, repairReserve - repairConsumed)
          .catch(() => undefined);
      }
    }
  }

  async function runOneUnit(
    unit: z.infer<typeof UnitDispatchSchema>,
    abortSignal: AbortSignal,
  ): Promise<z.infer<typeof UnitResultSchema>> {
    const { taskId, unitId, questionId } = unit;
    let reserved = 0;
    let consumed = 0;
    engine.beginUnitTracking(taskId, unitId);
    try {
      const context = await engine.loadExecutionContext(taskId);
      // 单元预占：最多 unitMaxSteps 次推理，受全局剩余额度约束；不足时不启动该单元。
      reserved = Math.min(context.limits.unitMaxSteps, 12);
      try {
        await engine.admitModelSteps(taskId, reserved, "exploration");
      } catch (error) {
        if (error instanceof StageFailureError && (error.taskErrorCode === "BUDGET_EXCEEDED" || error.taskErrorCode === "TIMEOUT")) {
          reserved = 0;
          return { unitId, questionId, ok: false, suggestedQuestions: [], error: error.taskErrorCode };
        }
        throw error;
      }

      const unitContext = await engine.loadUnitContext(taskId, unitId);
      const brief = buildResearcherBrief({
        unit,
        question: context.question,
        plan: context.plan,
        findings: context.findings,
        allowWebSupplement: context.allowWebSupplement,
        remaining:
          unitContext?.remaining ?? {
            searches: context.limits.unitMaxSearchRequests,
            modelSteps: context.limits.unitMaxSteps,
            unitMs: context.limits.unitTimeoutMs,
          },
      });
      let result;
      try {
        result = await researcher({
          taskId,
          unitId,
          questionId,
          allowWebSupplement: context.allowWebSupplement,
          user: brief,
          maxSteps: context.limits.unitMaxSteps,
          signal: abortSignal,
        });
      } catch (error) {
        // 结构化输出失败：用本单元已取得来源做一次纯整理调用（不重复搜索）。
        if (!(error instanceof StageFailureError) || error.taskErrorCode !== "MODEL_OUTPUT_INVALID") {
          throw error;
        }
        result = await repairUnitOutput({
          taskId,
          unitId,
          questionId,
          unit,
          question: context.question,
          allowWebSupplement: context.allowWebSupplement,
          reason: error.message,
          signal: abortSignal,
        });
      }
      consumed = result.steps;
      let commit = await engine.commitUnitFindings({
        taskId,
        unitId,
        proposals: result.output.findings,
      });
      if (commit.addedFindingIds.length === 0 && result.output.findings.length > 0) {
        // 全部发现因引用不匹配被剔除：用本单元来源做一次严格重整理。
        const retry = await repairUnitOutput({
          taskId,
          unitId,
          questionId,
          unit,
          question: context.question,
          allowWebSupplement: context.allowWebSupplement,
          reason: `上一次提交的发现引用无效：${commit.rejectReasons.join("；")}`,
          signal: abortSignal,
        }).catch(() => null);
        if (retry) {
          consumed += retry.steps;
          result = retry;
          commit = await engine.commitUnitFindings({
            taskId,
            unitId,
            proposals: retry.output.findings,
          });
        }
      }
      const receipt: UnitReceipt = {
        unitId,
        questionId,
        status: "succeeded",
        findingIds: commit.addedFindingIds,
        suggestedQuestions: result.output.suggestedQuestions,
        error: null,
        completedAt: new Date().toISOString(),
      };
      await engine.saveUnitReceipt(taskId, receipt);
      return {
        unitId,
        questionId,
        ok: true,
        suggestedQuestions: result.output.suggestedQuestions,
        error: null,
      };
    } catch (error) {
      const message =
        error instanceof StageFailureError
          ? `${error.taskErrorCode}: ${error.message}`
          : String(error).slice(0, 300);
      try {
        await engine.saveUnitReceipt(taskId, {
          unitId,
          questionId,
          status: "failed",
          findingIds: [],
          suggestedQuestions: [],
          error: message,
          completedAt: new Date().toISOString(),
        });
      } catch {
        // 回执失败不影响错误传播
      }
      return { unitId, questionId, ok: false, suggestedQuestions: [], error: message };
    } finally {
      if (reserved > 0) {
        await engine.releaseModelReservation(taskId, Math.max(0, reserved - consumed)).catch(() => undefined);
      }
      engine.endUnitTracking(taskId, unitId);
    }
  }

  const mergeStep = createStep({
    id: "merge",
    inputSchema: z.array(UnitResultSchema),
    outputSchema: CycleStateSchema,
    retries: 0,
    execute: async ({ inputData, abortSignal, getStepResult }) => {
      const decision = getStepResult(decideStep);
      const taskId = decision.taskId;
      if (decision.done || inputData.length === 0) {
        return { taskId, done: decision.done };
      }
      engine.recordStage(taskId, "researching");
      try {
        const context = await engine.loadSupervisorContext(taskId);
        const merge = await runStageWithOneRetry(runner, {
          taskId,
          system: SUPERVISOR_MERGE_SYSTEM,
          user: buildSupervisorMergeUser(context, inputData),
          schema: SupervisorMergeOutput,
          signal: abortSignal,
          reservedSteps: 1,
          phase: "exploration",
        });
        await engine.mergeUnitResults(taskId, merge.answers);
      } catch (error) {
        if (error instanceof StageFailureError) {
          // 合并受限：保留已保存发现，结束探索并如实记录原因，不中断整项研究。
          if (error.taskErrorCode === "TIMEOUT") {
            engine.recordExplorationStopReason(taskId, "time_budget");
            return { taskId, done: true };
          }
          if (error.taskErrorCode === "BUDGET_EXCEEDED") {
            engine.recordExplorationStopReason(taskId, "model_budget");
            return { taskId, done: true };
          }
          if (error.taskErrorCode === "UPSTREAM_ERROR") {
            engine.recordExplorationStopReason(taskId, "upstream_unavailable");
            return { taskId, done: true };
          }
        }
        throw error;
      }
      return { taskId, done: false };
    },
  });

  const researchCycle = createWorkflow({
    id: "research-cycle",
    inputSchema: CycleStateSchema,
    outputSchema: CycleStateSchema,
    retryConfig: { attempts: 0, delay: 0 },
    options: { autoRestartActiveRuns: false, validateInputs: true, shouldPersistSnapshot: () => true },
  })
    .then(decideStep)
    .then(unitsArrayStep)
    .foreach(unitStep, { concurrency: 3 })
    .then(mergeStep)
    .commit();

  const writeStep = createStep({
    id: "write",
    inputSchema: CycleStateSchema,
    outputSchema: DraftStateSchema,
    retries: 0,
    execute: async ({ inputData, abortSignal }) => {
      const { taskId } = inputData;
      engine.recordStage(taskId, "writing");
      const finalize = await engine.loadFinalizeContext(taskId);
      const draft = await runStageWithOneRetry(runner, {
        taskId,
        system: WRITER_SYSTEM,
        user: buildWriterUser(finalize),
        schema: ReportModelOutput,
        signal: abortSignal,
        reservedSteps: 1,
        phase: "synthesis",
      });
      await engine.validateDraft(taskId, draft);
      return {
        taskId,
        draft,
        finalizeMeta: {
          stopReason: finalize.stopReason,
          completeness: finalize.completeness,
          unresolvedReviewIssues: 0,
        },
        reviewIssues: [],
      };
    },
  });

  const verifyStep = createStep({
    id: "verify",
    inputSchema: DraftStateSchema,
    outputSchema: DraftStateSchema,
    retries: 0,
    execute: async ({ inputData, abortSignal }) => {
      const { taskId, draft, finalizeMeta } = inputData;
      engine.recordStage(taskId, "reviewing");
      const finalize = await engine.loadFinalizeContext(taskId);
      const review = await runStageWithOneRetry(runner, {
        taskId,
        system: VERIFIER_SYSTEM,
        user: buildVerifierUser(draft, finalize.findings, finalize.excerpts),
        schema: ReviewModelOutput,
        signal: abortSignal,
        reservedSteps: 1,
        phase: "synthesis",
      });
      return {
        taskId,
        draft,
        finalizeMeta: { ...finalizeMeta, unresolvedReviewIssues: review.issues.length },
        reviewIssues: review.issues,
      };
    },
  });

  const repairStep = createStep({
    id: "repair",
    inputSchema: DraftStateSchema,
    outputSchema: DraftStateSchema,
    retries: 0,
    execute: async ({ inputData, abortSignal }) => {
      const { taskId, draft, finalizeMeta, reviewIssues } = inputData;
      if (reviewIssues.length === 0) {
        return { taskId, draft, finalizeMeta, reviewIssues };
      }
      const eligible = await engine.reserveRepairPass(taskId).catch(() => false);
      if (!eligible) {
        // 没有回查额度：改写时删除/弱化不受支持断言并保留缺口说明。
        return { taskId, draft, finalizeMeta, reviewIssues };
      }
      engine.recordStage(taskId, "repairing");
      const context = await engine.loadExecutionContext(taskId);
      const finalize = await engine.loadFinalizeContext(taskId);
      const unitId = `repair-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      engine.beginUnitTracking(taskId, unitId);
      let reserved = 0;
      let consumed = 0;
      try {
        reserved = Math.min(context.limits.unitMaxSteps, 12);
        try {
          await engine.admitModelSteps(taskId, reserved, "synthesis");
        } catch {
          reserved = 0;
        }
        if (reserved === 0) {
          return { taskId, draft, finalizeMeta, reviewIssues };
        }
        const questionId =
          finalize.plan.questions.find((question) => question.closedReason === null)?.id ?? "q1";
        const brief = buildRepairBrief({
          question: finalize.question,
          plan: finalize.plan,
          draft,
          issues: reviewIssues,
          findings: finalize.findings,
        });
        const result = await researcher({
          taskId,
          unitId,
          questionId,
          allowWebSupplement: context.allowWebSupplement,
          user: brief,
          maxSteps: context.limits.unitMaxSteps,
          signal: abortSignal,
        });
        consumed = result.steps;
        await engine.commitUnitFindings({ taskId, unitId, proposals: result.output.findings });
      } catch {
        // 回查失败不撤销已有结果；改写基于已有证据继续。
      } finally {
        if (reserved > 0) {
          await engine.releaseModelReservation(taskId, Math.max(0, reserved - consumed)).catch(() => undefined);
        }
        engine.endUnitTracking(taskId, unitId);
      }
      return { taskId, draft, finalizeMeta, reviewIssues };
    },
  });

  const rewriteStep = createStep({
    id: "rewrite",
    inputSchema: DraftStateSchema,
    outputSchema: DraftStateSchema,
    retries: 0,
    execute: async ({ inputData, abortSignal }) => {
      const { taskId, draft, finalizeMeta, reviewIssues } = inputData;
      if (reviewIssues.length === 0) {
        return { taskId, draft, finalizeMeta, reviewIssues };
      }
      engine.recordStage(taskId, "writing");
      const finalize = await engine.loadFinalizeContext(taskId);
      const revised = await runStageWithOneRetry(runner, {
        taskId,
        system: WRITER_SYSTEM,
        user: buildRevisionUser(finalize, draft, reviewIssues),
        schema: ReportModelOutput,
        signal: abortSignal,
        reservedSteps: 1,
        phase: "synthesis",
      });
      await engine.validateDraft(taskId, revised);
      return { taskId, draft: revised, finalizeMeta, reviewIssues };
    },
  });

  const reverifyStep = createStep({
    id: "reverify",
    inputSchema: DraftStateSchema,
    outputSchema: DraftStateSchema,
    retries: 0,
    execute: async ({ inputData, abortSignal }) => {
      const { taskId, draft, finalizeMeta, reviewIssues } = inputData;
      if (reviewIssues.length === 0) {
        return { taskId, draft, finalizeMeta, reviewIssues };
      }
      engine.recordStage(taskId, "reviewing");
      // 修复后必须复验，不能省略。
      const finalize = await engine.loadFinalizeContext(taskId);
      const review = await runStageWithOneRetry(runner, {
        taskId,
        system: VERIFIER_SYSTEM,
        user: buildVerifierUser(draft, finalize.findings, finalize.excerpts),
        schema: ReviewModelOutput,
        signal: abortSignal,
        reservedSteps: 1,
        phase: "synthesis",
      });
      return {
        taskId,
        draft,
        finalizeMeta: { ...finalizeMeta, unresolvedReviewIssues: review.issues.length },
        reviewIssues: review.issues,
      };
    },
  });

  const saveStep = createStep({
    id: "save",
    inputSchema: DraftStateSchema,
    outputSchema: z.object({ taskId: z.string(), reportId: z.string() }),
    retries: 0,
    execute: async ({ inputData }) => {
      const { taskId, draft, finalizeMeta } = inputData;
      engine.recordStage(taskId, "saving");
      const report = await engine.finalizeReport(taskId, draft, {
        stopReason: finalizeMeta.stopReason as StopReason,
        completeness: finalizeMeta.completeness,
        additionalLimitations:
          finalizeMeta.unresolvedReviewIssues > 0
            ? [`自动核验在最终版本仍提示 ${finalizeMeta.unresolvedReviewIssues} 处需要人工核对的问题。`]
            : [],
      });
      return { taskId, reportId: report.id };
    },
  });

  const workflow = createWorkflow({
    id: "deep-research",
    inputSchema: TaskRefSchema,
    outputSchema: z.object({ taskId: z.string(), reportId: z.string() }),
    retryConfig: { attempts: 0, delay: 0 },
    options: { autoRestartActiveRuns: false, validateInputs: true, shouldPersistSnapshot: () => true },
  })
    .then(planStep)
    .dountil(researchCycle, async ({ getStepResult, iterationCount }) => {
      const result = getStepResult(researchCycle);
      return result?.done === true || iterationCount >= MAX_SUPERVISOR_ITERATIONS;
    })
    .then(writeStep)
    .then(verifyStep)
    .then(repairStep)
    .then(rewriteStep)
    .then(reverifyStep)
    .then(saveStep)
    .commit();

  return { workflow };
}

// ---------------------------------------------------------------------------
// 执行端口实现：产品控制意图与官方 Workflow 入口的唯一衔接点。
// ---------------------------------------------------------------------------

export type MastraResearchPortArgs = {
  workflow: ReturnType<typeof buildResearchWorkflow>["workflow"];
  engine: DeepResearchSystem;
};

export function createMastraResearchPort(args: MastraResearchPortArgs): ResearchExecutionPort {
  const { workflow, engine } = args;
  const active = new Map<string, { runId: string }>();

  return {
    async startExecution(taskId: string): Promise<void> {
      const run = await workflow.createRun();
      await engine.markExecutionStarted(taskId, run.runId);
      active.set(taskId, { runId: run.runId });
      const settled = run
        .start({ inputData: { taskId } })
        .then(async (output) => {
          if (output.status === "failed") {
            await engine.failTask(taskId, mapWorkflowErrorCode(output.error), describeWorkflowError(output.error));
          }
        })
        .catch(async (error: unknown) => {
          await engine.failTask(taskId, mapWorkflowErrorCode(error), describeWorkflowError(error));
        })
        .finally(async () => {
          active.delete(taskId);
          await engine.confirmExecutionEnd(taskId);
        });
      void settled;
    },
    async cancelExecution(taskId: string): Promise<void> {
      const entry = active.get(taskId);
      if (!entry) return;
      const run = await workflow.createRun({ runId: entry.runId });
      await run.cancel();
    },
    async readExecutionStage(taskId: string) {
      const entry = active.get(taskId);
      if (!entry) return null;
      const state = await workflow.getWorkflowRunById(entry.runId);
      if (!state || state.status !== "running") return null;
      return projectStageFromState(state.steps);
    },
    isExecutionActive(taskId: string): boolean {
      return active.has(taskId);
    },
  };
}

const STAGE_FAILURE_CODES = new Set<string>([
  "MODEL_OUTPUT_INVALID",
  "INVALID_CITATION",
  "EVIDENCE_REQUIRED",
  "BUDGET_EXCEEDED",
  "TIMEOUT",
  "PROTOCOL_ERROR",
  "UPSTREAM_ERROR",
  "AUTH_INVALID",
  "RATE_LIMITED",
  "QUOTA_EXHAUSTED",
  "STORAGE_ERROR",
  "INTERNAL_ERROR",
]);

/**
 * 从框架公开快照投影展示阶段。stage 只表达 planning/researching/writing/
 * reviewing/repairing/saving 或 null；不维护独立可写阶段。
 */
function projectStageFromState(
  steps: Record<string, unknown> | undefined,
): "planning" | "researching" | "writing" | "reviewing" | "repairing" | "saving" | null {
  const record = (steps ?? {}) as Record<string, { status?: string } | Array<{ status?: string }> | undefined>;
  const statusOf = (id: string): string | undefined => {
    const entry = record[id];
    if (Array.isArray(entry)) return entry.at(-1)?.status;
    return entry?.status;
  };
  if (statusOf("plan") !== "success") return "planning";
  if (statusOf("write") === "running") return "writing";
  if (statusOf("verify") === "running" || statusOf("reverify") === "running") return "reviewing";
  if (statusOf("repair") === "running") return "repairing";
  if (statusOf("rewrite") === "running") return "writing";
  if (statusOf("save") === "running") return "saving";
  const cycle = record["research-cycle"];
  const cycleRunning = Array.isArray(cycle) ? cycle.at(-1)?.status === "running" : cycle?.status === "running";
  if (cycleRunning) return "researching";
  return null;
}

/** 工作流引擎传回的错误可能是序列化对象（非实例），按 StageFailureError 形态还原。 */
function reviveStageFailure(error: unknown): { taskErrorCode: StageFailureError["taskErrorCode"]; message: string } | null {
  if (error instanceof StageFailureError) {
    return { taskErrorCode: error.taskErrorCode, message: error.message };
  }
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    const code = (error as { taskErrorCode?: unknown }).taskErrorCode;
    if (typeof code === "string" && STAGE_FAILURE_CODES.has(code as StageFailureError["taskErrorCode"])) {
      return { taskErrorCode: code as StageFailureError["taskErrorCode"], message: (error as { message: string }).message };
    }
  }
  return null;
}

function mapWorkflowErrorCode(error: unknown): StageFailureError["taskErrorCode"] {
  const revived = reviveStageFailure(error);
  if (revived) return revived.taskErrorCode;
  return "INTERNAL_ERROR";
}

function describeWorkflowError(error: unknown): string {
  const revived = reviveStageFailure(error);
  if (revived) return revived.message;
  if (error instanceof Error) {
    return error.message.length <= 300 ? error.message : `${error.message.slice(0, 300)}…`;
  }
  try {
    return JSON.stringify(error)?.slice(0, 300) ?? String(error);
  } catch {
    return String(error);
  }
}

// ---------------------------------------------------------------------------
// 阶段输入构建：结构化上下文 + 明确标注的来源文本。
// ---------------------------------------------------------------------------

function buildSupervisorPlanUser(question: string): string {
  return [
    `研究问题：${question}`,
    "",
    "请输出初步计划 JSON（3–5 个子问题）。",
  ].join("\n");
}

function buildSupervisorDecisionUser(context: {
  question: string;
  allowWebSupplement: boolean;
  plan: { version: number; objective: string; questions: Array<{ id: string; text: string; priority: string; closedReason: string | null }> } | null;
  findings: Array<{ id: string; questionId: string; statement: string; kind: string; evidence: Array<{ sourceId: string; relation: string }> }>;
  analysis: { answers: Array<{ questionId: string; coverage: string; gaps: string[] }> } | null;
  unitReceipts: UnitReceipt[];
  queryLog: Array<{ id: string; channel: string; text: string; status: string; questionId: string }>;
  remaining: { searchRequests: number; explorationModelRequests: number; sources: number; remainingMs: number };
}): string {
  return [
    `固定研究目标：${context.question}`,
    "",
    "当前计划（closedReason 非 null 的问题已关闭）：",
    context.plan ? JSON.stringify(context.plan, null, 2) : "（尚未建立）",
    "",
    "子问题覆盖判断（最近一次合并）：",
    context.analysis ? JSON.stringify(context.analysis.answers, null, 2) : "（尚无）",
    "",
    "已保存发现（id / questionId / kind / statement / 证据关系）：",
    context.findings.length > 0
      ? context.findings
          .map((f) => `- ${f.id} | ${f.questionId} | ${f.kind} | ${f.statement} | ${f.evidence.map((e) => `${e.sourceId}:${e.relation}`).join("、")}`)
          .join("\n")
      : "（无）",
    "",
    "已完成调查单元（unitId / questionId / 状态 / 建议）：",
    context.unitReceipts.length > 0
      ? context.unitReceipts
          .map((r) => `- ${r.unitId} | ${r.questionId} | ${r.status} | 建议：${r.suggestedQuestions.join("；") || "无"}`)
          .join("\n")
      : "（无）",
    "",
    "已执行查询（channel / text / status）：",
    context.queryLog.length > 0
      ? context.queryLog.map((q) => `- ${q.channel} | ${q.text} | ${q.status}`).join("\n")
      : "（无）",
    "",
    `剩余额度：搜索 ${context.remaining.searchRequests} 次；探索模型推理 ${context.remaining.explorationModelRequests} 次；来源快照 ${context.remaining.sources} 份；剩余时间 ${Math.round(context.remaining.remainingMs / 1000)} 秒。`,
    "",
    "请输出主管决定 JSON。",
  ].join("\n");
}

function buildSupervisorMergeUser(
  context: {
    plan: { questions: Array<{ id: string; text: string; closedReason: string | null }> } | null;
    findings: Array<{ id: string; questionId: string; statement: string; kind: string; conditions: string[]; evidence: Array<{ sourceId: string; quote: string; relation: string }> }>;
  },
  unitResults: Array<{ unitId: string; questionId: string; ok: boolean; error: string | null }>,
): string {
  return [
    "当前计划子问题（只合并开放问题）：",
    context.plan ? JSON.stringify(context.plan.questions, null, 2) : "（无）",
    "",
    "全部已保存发现：",
    context.findings.length > 0
      ? context.findings
          .map((f) =>
            [
              `### ${f.id} | ${f.questionId} | ${f.kind}`,
              `${f.statement}`,
              `条件：${f.conditions.join("；") || "未说明"} | 证据：${f.evidence.map((e) => `${e.sourceId}(${e.relation})「${e.quote}」`).join("；")}`,
            ].join("\n"),
          )
          .join("\n\n")
      : "（无）",
    "",
    "本轮单元执行结果：",
    unitResults.map((r) => `- ${r.unitId} | ${r.questionId} | ${r.ok ? "成功" : "失败"} | ${r.error ?? ""}`).join("\n") || "（无）",
    "",
    "请输出覆盖判断 JSON。",
  ].join("\n");
}

function buildResearcherBrief(args: {
  unit: { unitId: string; questionId: string; objective: string; focus: string };
  question: string;
  plan: { questions: Array<{ id: string; text: string; closedReason: string | null }> } | null;
  findings: Array<{ id: string; questionId: string; statement: string }>;
  allowWebSupplement: boolean;
  remaining: { searches: number; modelSteps: number; unitMs: number };
}): string {
  const targetQuestion = args.plan?.questions.find((q) => q.id === args.unit.questionId);
  return [
    `研究总目标：${args.question}`,
    "",
    `本单元子问题：${targetQuestion?.text ?? args.unit.questionId}（questionId=${args.unit.questionId}）`,
    `调查目标：${args.unit.objective}`,
    `调查重点：${args.unit.focus}`,
    "",
    `本地额度：最多 ${args.remaining.searches} 次搜索、约 ${args.remaining.modelSteps} 个工具步骤、${Math.round(args.remaining.unitMs / 1000)} 秒。`,
    `可用渠道：${args.allowWebSupplement ? "zhihu、web（官方事实补证）" : "仅 zhihu"}`,
    "",
    "与本问题相关的已有发现（避免重复调查）：",
    args.findings.filter((f) => f.questionId === args.unit.questionId).map((f) => `- ${f.statement}`).join("\n") || "（无）",
    "",
    "完成调查后，输出最终 JSON（findings + suggestedQuestions），不要再调用工具。",
  ].join("\n");
}

function buildWriterUser(finalize: {
  question: string;
  plan: { questions: Array<{ id: string; text: string; priority: string; closedReason: string | null }> };
  findings: Array<{ id: string; questionId: string; statement: string; kind: string; conditions: string[]; limitations: string[]; evidence: Array<{ sourceId: string; quote: string; relation: string }> }>;
  analysis: { answers: Array<{ questionId: string; coverage: string; text: string; findingIds: string[]; gaps: string[] }> } | null;
  excerpts: SourceExcerpt[];
  stopReason: StopReason;
  completeness: "sufficient" | "partial";
}): string {
  return [
    `研究问题：${finalize.question}`,
    "",
    "计划子问题：",
    ...finalize.plan.questions.map((q) => `- ${q.id}（${q.closedReason ? `已关闭：${q.closedReason}` : q.priority}）：${q.text}`),
    "",
    "已验证发现：",
    finalize.findings.length > 0
      ? finalize.findings
          .map((f) =>
            [
              `### ${f.id} | ${f.questionId} | ${f.kind}`,
              `${f.statement}`,
              `条件：${f.conditions.join("；") || "未说明"} | 限制：${f.limitations.join("；") || "未说明"}`,
              `证据：${f.evidence.map((e) => `${e.sourceId}(${e.relation})「${e.quote}」`).join("；")}`,
            ].join("\n"),
          )
          .join("\n\n")
      : "（无）",
    "",
    "子问题覆盖判断：",
    finalize.analysis ? JSON.stringify(finalize.analysis.answers, null, 2) : "（无）",
    "",
    "证据摘录（对应发现引用的来源）：",
    finalize.excerpts.length > 0
      ? finalize.excerpts
          .map((s) => [`### ${s.id} | ${s.title}`, `作者：${s.authorName ?? "未知"} | 时间：${s.sourceTime ?? "未知"}（${s.timeKind}）${s.excerptTruncated ? " | 摘要已截断" : ""}`, s.text].join("\n"))
          .join("\n\n")
      : "（无）",
    "",
    `探索结束原因：${finalize.stopReason}`,
    "",
    "请输出报告正文 JSON（段落引用 findingIds）。",
  ].join("\n");
}

function buildVerifierUser(
  draft: ReportModelOutputType,
  findings: Array<{ id: string; statement: string; evidence: Array<{ sourceId: string; quote: string; relation: string }> }>,
  excerpts: SourceExcerpt[],
): string {
  return [
    "报告草稿：",
    JSON.stringify(draft, null, 2),
    "",
    "所引用发现：",
    findings.length > 0
      ? findings
          .map((f) => [`### ${f.id} | ${f.statement}`, `证据：${f.evidence.map((e) => `${e.sourceId}(${e.relation})「${e.quote}」`).join("；")}`].join("\n"))
          .join("\n\n")
      : "（无）",
    "",
    "证据摘录（原始来源摘要）：",
    excerpts.length > 0
      ? excerpts.map((s) => [`### ${s.id} | ${s.title}`, s.text].join("\n")).join("\n\n")
      : "（无）",
    "",
    "请输出核验 JSON。",
  ].join("\n");
}

function buildRepairBrief(args: {
  question: string;
  plan: { questions: Array<{ id: string; text: string; closedReason: string | null }> };
  draft: ReportModelOutputType;
  issues: ReviewIssue[];
  findings: Array<{ id: string; statement: string }>;
}): string {
  return [
    `研究总目标：${args.question}`,
    "",
    "这是核验后的定向回查：只解决以下具体问题，不要重新泛化研究。",
    "",
    "核验发现的问题：",
    args.issues.map((issue, i) => `${i + 1}. [${issue.kind}] ${issue.section}[${issue.index}]：${issue.description}`).join("\n"),
    "",
    "开放子问题（新发现必须挂到其中一个 questionId）：",
    args.plan.questions.filter((q) => q.closedReason === null).map((q) => `- ${q.id}：${q.text}`).join("\n"),
    "",
    "已有发现（避免重复）：",
    args.findings.map((f) => `- ${f.statement}`).join("\n") || "（无）",
    "",
    "完成回查后输出最终 JSON（findings + suggestedQuestions），不要再调用工具。",
  ].join("\n");
}

function buildRevisionUser(
  finalize: Parameters<typeof buildWriterUser>[0],
  draft: ReportModelOutputType,
  issues: ReviewIssue[],
): string {
  return [
    buildWriterUser(finalize),
    "",
    "你的上一版草稿：",
    JSON.stringify(draft, null, 2),
    "",
    "核验发现的问题（必须逐条修正：删除或弱化无依据断言、补充发现引用、恢复被遗漏的条件与分歧；无法修复时在 gaps 中明确说明）：",
    issues.map((issue, i) => `${i + 1}. [${issue.kind}] ${issue.section}[${issue.index}]：${issue.description}`).join("\n"),
    "",
    "请输出修正后的完整报告 JSON。",
  ].join("\n");
}

/** 显式结构修正重试：最多一次，且计入模型预算。 */
async function runStageWithOneRetry<T>(
  runner: StageRunner,
  args: StageRunnerArgs<T>,
): Promise<T> {
  try {
    return await runner<T>(args);
  } catch (error) {
    if (!(error instanceof StageFailureError) || error.taskErrorCode !== "MODEL_OUTPUT_INVALID") {
      throw error;
    }
    return await runner<T>({
      ...args,
      user: [
        args.user,
        "",
        "上一次输出无法通过校验，原因：",
        error.message,
        "请重新输出完整、合法、符合 schema 的 JSON；引用必须使用提供的 ID 与原样子串。",
      ].join("\n"),
    });
  }
}
