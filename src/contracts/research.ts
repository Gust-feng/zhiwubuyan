import { z } from "zod";

/**
 * 深度研究共享契约（目标形状）。HTTP DTO、应用命令、工具参数与 fixture 都以本文件为准；
 * 类型从 schema 推导，不在前端或路由复制第二份。
 * 字段语义见 docs/backend-api.md 与 docs/deep-research-development-plan.md（ADR-0006 运行架构）。
 */

export const CHANNEL = ["zhihu", "web"] as const;
export const QUERY_PURPOSE = ["background", "supporting", "counterevidence", "verification", "qualification"] as const;
export const COVERAGE = ["supported", "partial", "contested", "unanswered"] as const;
export const QUERY_STATUS = ["pending", "succeeded", "failed"] as const;
export const TIME_KIND = ["published_or_updated", "published", "unknown"] as const;
export const TASK_STATUS = ["starting", "running", "cancelling", "completed", "failed", "cancelled", "interrupted"] as const;
export const TASK_STAGE = ["planning", "researching", "writing", "reviewing", "repairing", "saving"] as const;
export const COMPLETENESS = ["sufficient", "partial"] as const;
export const STOP_REASON = [
  "sufficient",
  "source_saturated",
  "search_budget",
  "model_budget",
  "time_budget",
  "source_budget",
  "upstream_unavailable",
] as const;
export const TASK_OUTCOME = ["completed", "failed", "cancelled", "interrupted"] as const;
export const RESEARCH_TIER = ["ultra", "pro", "thinking", "fast"] as const;
export type ResearchTier = (typeof RESEARCH_TIER)[number];

export const TASK_ERROR_CODE = [
  "ULTRA_DESKTOP_ONLY",
  "AUTH_INVALID",
  "RATE_LIMITED",
  "QUOTA_EXHAUSTED",
  "UPSTREAM_ERROR",
  "PROTOCOL_ERROR",
  "MODEL_OUTPUT_INVALID",
  "INVALID_CITATION",
  "EVIDENCE_REQUIRED",
  "BUDGET_EXCEEDED",
  "TIMEOUT",
  "STORAGE_ERROR",
  "INTERNAL_ERROR",
] as const;
export const FINDING_KIND = ["fact", "experience", "opinion", "inference"] as const;
export const EVIDENCE_RELATION = ["support", "oppose", "qualify", "context"] as const;
export const QUESTION_PRIORITY = ["high", "normal"] as const;
export const CLOSED_REASON = ["irrelevant", "saturated"] as const;

export type Channel = (typeof CHANNEL)[number];
export type QueryPurpose = (typeof QUERY_PURPOSE)[number];
export type Coverage = (typeof COVERAGE)[number];
export type TaskStatus = (typeof TASK_STATUS)[number];
export type TaskStage = (typeof TASK_STAGE)[number];
export type Completeness = (typeof COMPLETENESS)[number];
export type StopReason = (typeof STOP_REASON)[number];
export type TaskOutcome = (typeof TASK_OUTCOME)[number];
export type TaskErrorCode = (typeof TASK_ERROR_CODE)[number];
export type FindingKind = (typeof FINDING_KIND)[number];
export type EvidenceRelation = (typeof EVIDENCE_RELATION)[number];
export type QuestionPriority = (typeof QUESTION_PRIORITY)[number];

const isoTimestamp = z.string().datetime({ offset: true });

/** 创建请求：requestId 为 UUID；question 去首尾空白后 1–2,000 字符；未知字段拒绝。 */
export const CreateResearchTaskInput = z
  .object({
    requestId: z.string().uuid(),
    question: z.string().min(1).max(2000),
    allowWebSupplement: z.boolean().default(false),
    tier: z.enum(RESEARCH_TIER),
  })
  .strict();
export type CreateResearchTaskInput = z.infer<typeof CreateResearchTaskInput>;

export const PlanQuestion = z
  .object({
    id: z.string().min(1).max(32),
    text: z.string().min(1).max(1000),
    priority: z.enum(QUESTION_PRIORITY),
    closedReason: z.enum(CLOSED_REASON).nullable(),
  })
  .strict();
export type PlanQuestion = z.infer<typeof PlanQuestion>;

/** 全局研究计划：主管可演化；version 随每次通过应用命令的修改递增。 */
export const ResearchPlan = z
  .object({
    version: z.number().int().min(1),
    objective: z.string().min(1).max(2100),
    assumptions: z.array(z.string().min(1).max(500)).max(500),
    questions: z.array(PlanQuestion).min(1).max(12),
  })
  .strict();
export type ResearchPlan = z.infer<typeof ResearchPlan>;

export const FindingEvidence = z.object({
  sourceId: z.string().min(1).max(64),
  quote: z.string().min(1).max(2000),
  relation: z.enum(EVIDENCE_RELATION),
});
export type FindingEvidence = z.infer<typeof FindingEvidence>;

/** 带证据的模型发现：id/unitId 由应用分配；引用必须来自实际保存的摘要。 */
export const ResearchFinding = z
  .object({
    id: z.string().min(1).max(64),
    unitId: z.string().min(1).max(64),
    questionId: z.string().min(1).max(32),
    statement: z.string().min(1).max(2000),
    kind: z.enum(FINDING_KIND),
    conditions: z.array(z.string().min(1).max(500)).max(500),
    limitations: z.array(z.string().min(1).max(500)).max(500),
    evidence: z.array(FindingEvidence).max(500),
  })
  .strict();
export type ResearchFinding = z.infer<typeof ResearchFinding>;

/** 调查单元提交的发现（尚无应用 ID，来源引用为原始 sourceId）。 */
export const ProposedFinding = z.object({
    questionId: z.string().min(1).max(32),
    statement: z.string().min(1).max(2000),
    kind: z.enum(FINDING_KIND),
    conditions: z.array(z.string().min(1).max(500)).max(500),
    limitations: z.array(z.string().min(1).max(500)).max(500),
  evidence: z.array(FindingEvidence.omit({ relation: true }).extend({ relation: z.enum(EVIDENCE_RELATION) })).max(500),
});
export type ProposedFinding = z.infer<typeof ProposedFinding>;

/** 覆盖判断：按当前计划合并；findingIds 引用已保存发现。 */
export const AnalysisAnswer = z.object({
  questionId: z.string().min(1).max(32),
  coverage: z.enum(COVERAGE),
  text: z.string().min(1).max(4000),
  findingIds: z.array(z.string().min(1).max(64)).max(500).default([]),
  gaps: z.array(z.string().min(1).max(500)).max(500).default([]),
});
export type AnalysisAnswer = z.infer<typeof AnalysisAnswer>;

export const ResearchAnalysis = z
  .object({
    answers: z.array(AnalysisAnswer).min(1).max(12),
  })
  .strict();
export type ResearchAnalysis = z.infer<typeof ResearchAnalysis>;

/** 调查准入记录：通过 unitId/questionId 归属；没有轮次概念。 */
export const QueryLogEntry = z
  .object({
    id: z.string().min(1).max(64),
    unitId: z.string().min(1).max(64),
    questionId: z.string().min(1).max(32),
    channel: z.enum(CHANNEL),
    text: z.string().min(1).max(500),
    purpose: z.enum(QUERY_PURPOSE),
    status: z.enum(QUERY_STATUS),
    sourceIds: z.array(z.string()),
    discardedCount: z.number().int().min(0).nullable(),
    error: z.string().max(200).nullable(),
    requestedAt: isoTimestamp,
    completedAt: isoTimestamp.nullable(),
  })
  .strict();
export type QueryLogEntry = z.infer<typeof QueryLogEntry>;

/** 单元结果回执：同一 unitId 重复提交不重复累计。 */
export const UnitReceipt = z
  .object({
    unitId: z.string().min(1).max(64),
    questionId: z.string().min(1).max(32),
    status: z.enum(["succeeded", "failed"]),
    findingIds: z.array(z.string()),
    suggestedQuestions: z.array(z.string().min(1).max(1000)).max(5),
    error: z.string().max(300).nullable(),
    completedAt: isoTimestamp,
  })
  .strict();
export type UnitReceipt = z.infer<typeof UnitReceipt>;

export const Usage = z
  .object({
    searchRequests: z.number().int().min(0),
    modelRequests: z.number().int().min(0),
    inputTokens: z.number().int().min(0).nullable(),
    outputTokens: z.number().int().min(0).nullable(),
    cachedInputTokens: z.number().int().min(0).nullable(),
    elapsedMs: z.number().int().min(0),
  })
  .strict();
export type Usage = z.infer<typeof Usage>;

/** 共享预算与并发限制；全部角色共用一份任务额度。 */
export const Limits = z
  .object({
    maxConcurrentUnits: z.number().int().min(1).max(3),
    maxConcurrentSearches: z.number().int().min(1).max(4),
    maxSearchRequests: z.number().int().min(1).max(160),
    maxModelRequests: z.number().int().min(4).max(200),
    maxSources: z.number().int().min(1).max(800),
    timeoutMs: z.number().int().min(60_000),
    synthesisModelReserve: z.number().int().min(4).max(12),
    synthesisTimeReserveMs: z.number().int().min(120_000).max(600_000),
    unitMaxSteps: z.number().int().min(4).max(12),
    unitMaxSearchRequests: z.number().int().min(1).max(8),
    unitTimeoutMs: z.number().int().min(60_000).max(300_000),
    maxRepairPasses: z.number().int().min(0).max(1),
  })
  .strict();
export type Limits = z.infer<typeof Limits>;

export const ModelInfo = z
  .object({
    provider: z.string().min(1).max(100),
    modelId: z.string().min(1).max(200),
  })
  .strict();
export type ModelInfo = z.infer<typeof ModelInfo>;

export const TaskError = z
  .object({
    code: z.enum(TASK_ERROR_CODE),
    message: z.string().max(1000),
  })
  .strict();
export type TaskError = z.infer<typeof TaskError>;

export const SourceAuthor = z
  .object({
    name: z.string().max(200),
    avatarUrl: z.string().max(1000).nullable(),
    badgeIconUrl: z.string().max(1000).nullable(),
    badges: z.array(z.string().max(200)),
  })
  .strict();
export type SourceAuthor = z.infer<typeof SourceAuthor>;

export const SelectedComment = z
  .object({
    text: z.string().max(2000),
  })
  .strict();
export type SelectedComment = z.infer<typeof SelectedComment>;

export const SourceMetadata = z
  .object({
    contentType: z.string().max(100).nullable(),
    contentId: z.string().max(64).nullable(),
    voteCount: z.number().int().nullable(),
    commentCount: z.number().int().nullable(),
    authorityLevel: z.string().max(20).nullable(),
    rankingScore: z.number().nullable(),
    selectedComments: z.array(SelectedComment).max(10),
  })
  .strict();
export type SourceMetadata = z.infer<typeof SourceMetadata>;

/** 来源快照：contentExtent 固定 summary；textHash 覆盖规范化后的 text。 */
export const ResearchSource = z
  .object({
    id: z.string().min(1).max(64),
    taskId: z.string().min(1).max(64),
    channel: z.enum(CHANNEL),
    identity: z.string().min(1).max(600),
    textHash: z.string().min(16).max(128),
    title: z.string().min(1).max(1000),
    url: z.string().max(2000),
    canonicalUrl: z.string().max(2000),
    text: z.string().min(1),
    contentExtent: z.literal("summary"),
    author: SourceAuthor.nullable(),
    sourceTime: isoTimestamp.nullable(),
    timeKind: z.enum(TIME_KIND),
    retrievedAt: isoTimestamp,
    metadata: SourceMetadata,
  })
  .strict();
export type ResearchSource = z.infer<typeof ResearchSource>;

export const ReportSectionParagraph = z
  .object({
    text: z.string().min(1).max(4000),
    findingIds: z.array(z.string().min(1).max(64)).max(500),
    sourceIds: z.array(z.string().min(1).max(64)).max(800),
  })
  .strict();
export type ReportSectionParagraph = z.infer<typeof ReportSectionParagraph>;

/** 报告：一项任务最多一份；段落 sourceIds 由应用从 finding 证据派生。 */
export const ResearchReport = z
  .object({
    id: z.string().min(1).max(64),
    taskId: z.string().min(1).max(64),
    title: z.string().min(1).max(300),
    sections: z
      .object({
        conclusion: z.array(ReportSectionParagraph).min(1).max(500),
        evidence: z.array(ReportSectionParagraph).min(1).max(500),
        disagreements: z.array(ReportSectionParagraph).max(500),
        gaps: z.array(z.string().min(1).max(600)).max(500),
      })
      .strict(),
    sourceIds: z.array(z.string().min(1).max(64)).min(1).max(800),
    completeness: z.enum(COMPLETENESS),
    stopReason: z.enum(STOP_REASON),
    limitations: z.array(z.string().min(1).max(600)).min(1).max(500),
    createdAt: isoTimestamp,
  })
  .strict();
export type ResearchReport = z.infer<typeof ResearchReport>;

/** 撰写模型输出：只给 findingIds；sourceIds 由应用派生。 */
export const ReportModelOutput = z.object({
  title: z.string().min(1).max(300),
  sections: z.object({
    conclusion: z.array(ReportSectionParagraph.omit({ sourceIds: true })).min(1).max(500),
    evidence: z.array(ReportSectionParagraph.omit({ sourceIds: true })).min(1).max(500),
    disagreements: z.array(ReportSectionParagraph.omit({ sourceIds: true })).max(500).default([]),
    gaps: z.array(z.string().min(1).max(600)).max(500).default([]),
  }),
});
export type ReportModelOutput = z.infer<typeof ReportModelOutput>;

export const ReviewIssue = z.object({
    section: z.enum(["conclusion", "evidence", "disagreements", "gaps"]),
    index: z.number().int().min(0),
  kind: z.enum(["unsupported", "overstated", "missing", "contradiction", "citation_mismatch"]),
  description: z.string().min(1).max(1000),
});
export type ReviewIssue = z.infer<typeof ReviewIssue>;

/** 核验模型输出：具体问题；是否回查由应用决定。 */
export const ReviewModelOutput = z.object({
  issues: z.array(ReviewIssue).max(500).default([]),
});
export type ReviewModelOutput = z.infer<typeof ReviewModelOutput>;

/** 直答快答：独立产物，无来源引用；正文是知乎直答生成内容。 */
export const QuickAnswer = z
  .object({
    content: z.string().min(1),
    model: z.string().min(1).max(100),
    generatedAt: isoTimestamp,
  })
  .strict();
export type QuickAnswer = z.infer<typeof QuickAnswer>;

export const TaskSummary = z
  .object({
    id: z.string(),
    question: z.string(),
    status: z.enum(TASK_STATUS),
    stage: z.enum(TASK_STAGE).nullable(),
    createdAt: isoTimestamp,
    endedAt: isoTimestamp.nullable(),
    sourceCount: z.number().int().min(0),
    reportId: z.string().nullable(),
    error: TaskError.nullable(),
  })
  .strict();
export type TaskSummary = z.infer<typeof TaskSummary>;

export const TaskDetail = TaskSummary.and(
  z
    .object({
      tier: z.enum(RESEARCH_TIER),
      allowWebSupplement: z.boolean(),
      plan: ResearchPlan.nullable(),
      findings: z.array(ResearchFinding),
      analysis: ResearchAnalysis.nullable(),
      queries: z.array(QueryLogEntry),
      usage: Usage,
      limits: Limits,
      modelInfo: ModelInfo,
      /** 快答档（fast/thinking/agent）才有；ultra 为 null。 */
      answer: QuickAnswer.nullable(),
    })
    .strict(),
);
export type TaskDetail = z.infer<typeof TaskDetail>;

// ---------------------------------------------------------------------------
// 模型输出 schema（主管/调查单元），由应用校验后转换。
// ---------------------------------------------------------------------------

/** 主管初步拆题输出：questionIndex 由应用映射为正式 ID。 */
export const SupervisorPlanOutput = z.object({
  objective: z.string().min(1).max(2100),
  assumptions: z.array(z.string().min(1).max(500)).max(500),
  questions: z
    .array(
      z.object({
        text: z.string().min(1).max(1000),
        priority: z.enum(QUESTION_PRIORITY),
      }),
    )
    .min(3)
    .max(5),
});
export type SupervisorPlanOutput = z.infer<typeof SupervisorPlanOutput>;

/** 主管决策输出：安排调查单元、调整计划或建议成稿。 */
export const SupervisorDecisionOutput = z.object({
  action: z.enum(["research", "synthesize"]),
  reason: z.string().min(1).max(600),
  units: z
    .array(
      z.object({
        questionId: z.string().min(1).max(32),
        objective: z.string().min(1).max(600),
        focus: z.enum(QUERY_PURPOSE),
      }),
    )
    .max(3)
    .default([]),
  planUpdates: z
    .object({
      newQuestions: z
        .array(z.object({ text: z.string().min(1).max(1000), priority: z.enum(QUESTION_PRIORITY) }))
        .max(3)
        .default([]),
      closeQuestions: z
        .array(z.object({ questionId: z.string().min(1).max(32), closedReason: z.enum(CLOSED_REASON) }))
        .max(3)
        .default([]),
    })
    .default({ newQuestions: [], closeQuestions: [] }),
});
export type SupervisorDecisionOutput = z.infer<typeof SupervisorDecisionOutput>;

/** 主管合并输出：按当前子问题更新覆盖判断。 */
export const SupervisorMergeOutput = z.object({
  answers: z.array(AnalysisAnswer).min(1).max(12),
});
export type SupervisorMergeOutput = z.infer<typeof SupervisorMergeOutput>;

/** 调查单元最终输出：结构化发现与建议；来源引用必须来自本次提供的材料。 */
export const ResearcherOutput = z.object({
  findings: z.array(ProposedFinding).max(500).default([]), // 500=反退化天花板
  suggestedQuestions: z.array(z.string().min(1).max(1000)).max(500).default([]),
});
export type ResearcherOutput = z.infer<typeof ResearcherOutput>;
