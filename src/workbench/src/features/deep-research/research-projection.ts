import type {
  ResearchAnalysis,
  ResearchPlan,
  ResearchReport,
  ResearchSource,
  TaskDetail,
  TaskSummary,
  QueryLogEntry,
} from "@contracts/research";
import type { ResearchProProgress } from "./research-view-model";
import type {
  ResearchActivityView,
  ResearchReportMetaView,
  ResearchUsageView,
  ResearchPlanItemView,
  ResearchQueryView,
  ResearchReportSectionView,
  ResearchScene,
  ResearchSourceView,
  ResearchViewModel,
} from "./research-view-model";

/**
 * 把任务、来源与报告投影成界面视图。只读真实字段，不生成百分比、不推测进度；
 * 缺失值按契约保持未知，不用空列表掩盖未发生的行为。
 */

const STAGE_LABELS: Record<NonNullable<TaskDetail["stage"]>, string> = {
  planning: "拆解问题",
  researching: "检索取证",
  writing: "撰写报告",
  reviewing: "核验依据",
  repairing: "定向回查",
  saving: "保存成果",
};

const COVERAGE_LABELS = { supported: "已有依据", partial: "部分依据", contested: "存在分歧", unanswered: "尚未回答" } as const;

const BLOCK_TITLES: Record<keyof ResearchReport["sections"], string> = {
  conclusion: "结论",
  evidence: "依据",
  disagreements: "分歧",
  gaps: "缺口与限制",
};

export const EMPTY_RESEARCH: ResearchViewModel = {
  scene: "idle",
  question: "",
  title: "",
  activityLabel: "",
  searchCount: 0,
  elapsedLabel: "",
  plan: [],
  activities: [],
  sources: [],
  report: [],
  tier: null,
  planVersion: null,
  usage: null,
  answer: null,
  reportMeta: null,
  limitations: [],
};

export function projectProProgress(progress: ResearchProProgress): ResearchViewModel {
  return {
    ...EMPTY_RESEARCH,
    tier: "pro",
    scene: progress.status === "running" ? "researching" : progress.status,
    question: progress.question,
    title: progress.question,
    activityLabel: progress.content ? "正在生成回答" : "正在检索与生成",
    answer: { content: progress.content, model: "zhida-agent" },
  };
}

const STOP_REASON_LABELS: Record<ResearchReport["stopReason"], string> = {
  sufficient: "证据已覆盖关键问题",
  source_saturated: "来源在不同策略下已饱和",
  search_budget: "达到检索预算",
  model_budget: "达到模型调用预算",
  time_budget: "达到时间上限",
  source_budget: "达到来源上限",
  upstream_unavailable: "上游无法继续提供资料",
};

export function projectResearch(args: {
  detail: TaskDetail | null;
  sources: readonly ResearchSource[];
  report: ResearchReport | null;
  now: number;
}): ResearchViewModel {
  const { detail, sources, report, now } = args;
  if (!detail) return EMPTY_RESEARCH;

  const scene = projectScene(detail.status, detail.stage);
  const isQuickAnswer = detail.answer !== null;
  return {
    scene,
    question: detail.question,
    title: isQuickAnswer ? detail.question : (detail.plan?.objective ?? detail.question),
    activityLabel: [
      taskStageText(detail.status, detail.stage),
      `已收集 ${detail.sourceCount} 个来源`,
      `已检索 ${detail.usage.searchRequests} 次`,
    ]
      .filter(Boolean)
      .join(" · "),
    searchCount: detail.usage.searchRequests,
    elapsedLabel: formatElapsed(elapsedMs(detail.createdAt, detail.endedAt, now)),
    plan: projectPlan(detail.plan, detail.analysis),
    activities: projectActivities(detail),
    sources: sources.map(projectSource),
    report: report ? projectReport(report) : [],
    outcomeNote: projectOutcomeNote(detail),
    stopping: detail.status === "cancelling" ? true : undefined,
    tier: detail.tier === "ultra" ? "ultra" : detail.answer !== null ? "pro" : null,
    planVersion: detail.plan?.version ?? null,
    usage: projectUsage(detail),
    answer:
      detail.answer === null
        ? null
        : { content: detail.answer.content, model: detail.answer.model },
    reportMeta: report
      ? ({
          completeness: report.completeness,
          stopReason: STOP_REASON_LABELS[report.stopReason],
        } satisfies ResearchReportMetaView)
      : null,
    limitations: report?.limitations ?? [],
  };
}

function projectOutcomeNote(detail: TaskDetail): string | undefined {
  if (!isTerminal(detail.status)) return undefined;
  if (detail.status === "completed") {
    return detail.reportId ? undefined : "任务已完成，但没有可展示的已保存报告。";
  }
  if (detail.status === "cancelled") return "研究已停止。停止前收集的来源与活动仍可查看。";
  if (detail.status === "interrupted") return "服务重启时该任务已中断，材料已保留；需要继续请新建研究。";
  return `研究未完成：${detail.error?.message ?? detail.error?.code ?? "未知原因"}。已取得的材料仍可查看。`;
}

function isTerminal(status: TaskDetail["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
}

function projectScene(status: TaskDetail["status"], stage: TaskDetail["stage"]): ResearchScene {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "interrupted") return "failed";
  if (stage === "writing" || stage === "reviewing" || stage === "repairing" || stage === "saving") return "writing";
  return "researching";
}

function labelForTerminal(status: TaskDetail["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已停止";
  if (status === "interrupted") return "已中断";
  if (status === "failed") return "未完成";
  return "准备中";
}

/** 任务当前阶段的一句中文说明：进行中用阶段名，终态用结果名。列表与研究视图共用。 */
export function taskStageText(status: TaskSummary["status"], stage: TaskSummary["stage"]): string {
  if (status === "cancelling") return "正在停止";
  if (stage !== null && !isTerminal(status)) return STAGE_LABELS[stage];
  return labelForTerminal(status);
}

/** 列表里的日期只显示月日：最近的研究带年份没有信息量。 */
export function taskDayLabel(iso: string | null): string {
  const value = Date.parse(iso ?? "");
  if (!Number.isFinite(value)) return "时间未知";
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function projectPlan(plan: ResearchPlan | null, analysis: ResearchAnalysis | null): ResearchPlanItemView[] {
  if (!plan) return [];
  const coverageById = new Map((analysis?.answers ?? []).map((answer) => [answer.questionId, answer.coverage]));
  return plan.questions.map((question) => {
    const coverage = coverageById.get(question.id);
    const state =
      question.closedReason !== null || coverage === "supported"
        ? "complete"
        : coverage === "partial" || coverage === "contested"
          ? "active"
          : "pending";
    const tag = question.closedReason
      ? question.closedReason === "saturated"
        ? "资料已充分"
        : "与本问题无关"
      : coverage
        ? COVERAGE_LABELS[coverage]
        : undefined;
    return { id: question.id, title: question.text, state, tag, priority: question.priority, closed: question.closedReason !== null };
  });
}

function projectActivities(detail: TaskDetail): ResearchActivityView[] {
  const activities: ResearchActivityView[] = [];
  const questionText = new Map((detail.plan?.questions ?? []).map((question) => [question.id, question.text]));

  if (detail.plan) {
    activities.push({
      id: "plan",
      kind: "planning",
      time: formatClock(detail.createdAt),
      title: `拆解为 ${detail.plan.questions.length} 个子问题（计划第 ${detail.plan.version} 版）`,
      summary: detail.plan.objective,
      sourceIds: [],
    });
  }

  const byUnit = new Map<string, QueryLogEntry[]>();
  for (const query of detail.queries) {
    const bucket = byUnit.get(query.unitId);
    if (bucket) bucket.push(query);
    else byUnit.set(query.unitId, [query]);
  }
  for (const [unitId, queries] of byUnit) {
    const first = queries[0]!;
    const sourceIds = [...new Set(queries.flatMap((query) => query.sourceIds))];
    activities.push({
      id: unitId,
      kind: "searching",
      time: formatClock(first.requestedAt),
      title: questionText.get(first.questionId) ?? `调查单元 ${unitId}`,
      summary: summarizeQueries(queries),
      queries: queries.map(projectQuery),
      sourceIds,
    });
  }

  if (detail.analysis) {
    activities.push({
      id: "analysis",
      kind: "analyzing",
      time: formatClock(detail.queries[detail.queries.length - 1]?.completedAt ?? detail.createdAt),
      title: "合并证据，更新覆盖判断",
      summary: summarizeCoverage(detail.analysis),
      sourceIds: [],
    });
  }

  if (detail.stage === "writing" || detail.stage === "reviewing" || detail.stage === "repairing" || detail.stage === "saving" || detail.reportId) {
    activities.push({
      id: "writing",
      kind: "writing",
      time: formatClock(detail.endedAt ?? detail.createdAt),
      title: "撰写并核验报告",
      summary: detail.reportId ? "报告已保存，可打开来源核对引用。" : "正在按已有依据成稿并核验关键结论。",
      sourceIds: [],
    });
  }
  return activities;
}

function projectQuery(query: QueryLogEntry): ResearchQueryView {
  return {
    id: query.id,
    text: query.text,
    channel: query.channel,
    status: query.status,
    resultCount: query.status === "succeeded" ? query.sourceIds.length : null,
  };
}

function summarizeQueries(queries: readonly QueryLogEntry[]): string {
  const succeeded = queries.filter((query) => query.status === "succeeded").length;
  const failed = queries.filter((query) => query.status === "failed").length;
  const pending = queries.length - succeeded - failed;
  const parts = [`检索 ${queries.length} 次`, `成功 ${succeeded}`];
  if (failed > 0) parts.push(`失败 ${failed}`);
  if (pending > 0) parts.push(`进行中 ${pending}`);
  return parts.join(" · ");
}

function summarizeCoverage(analysis: ResearchAnalysis): string {
  const counts = new Map<string, number>();
  for (const answer of analysis.answers) {
    counts.set(answer.coverage, (counts.get(answer.coverage) ?? 0) + 1);
  }
  return (["supported", "partial", "contested", "unanswered"] as const)
    .filter((coverage) => (counts.get(coverage) ?? 0) > 0)
    .map((coverage) => `${COVERAGE_LABELS[coverage]} ${counts.get(coverage)}`)
    .join(" · ");
}

function projectUsage(detail: TaskDetail): ResearchUsageView {
  const usage = detail.usage;
  const limits = detail.limits;
  return {
    search: { used: usage.searchRequests, max: limits.maxSearchRequests },
    model: { used: usage.modelRequests, max: limits.maxModelRequests },
    sources: { used: detail.sourceCount, max: limits.maxSources },
  };
}

function projectSource(source: ResearchSource): ResearchSourceView {
  const isWeb = source.channel === "web";
  const kind: ResearchSourceView["kind"] = isWeb
    ? "web"
    : (source.metadata.contentType ?? "").toLowerCase().startsWith("artic")
      ? "article"
      : "answer";
  const signals = [
    source.metadata.voteCount === null ? null : `赞同 ${source.metadata.voteCount}`,
    source.metadata.commentCount === null ? null : `评论 ${source.metadata.commentCount}`,
    source.metadata.authorityLevel ? `认证 ${source.metadata.authorityLevel}` : null,
  ].filter((item): item is string => item !== null);
  return {
    id: source.id,
    title: source.title,
    author: source.author?.name ?? "未署名",
    kind,
    excerpt: source.text,
    context: signals.length > 0 ? signals.join(" · ") : "上游未返回互动数据",
    dateLabel: source.sourceTime === null ? "时间未知" : formatDate(source.sourceTime),
    url: source.url.length > 0 ? source.url : null,
  };
}

function projectReport(report: ResearchReport): ResearchReportSectionView[] {
  const paragraphs = [
    ...report.sections.conclusion.map((item) => [BLOCK_TITLES.conclusion, item] as const),
    ...report.sections.evidence.map((item) => [BLOCK_TITLES.evidence, item] as const),
    ...report.sections.disagreements.map((item) => [BLOCK_TITLES.disagreements, item] as const),
  ];
  const sections: ResearchReportSectionView[] = paragraphs.map(([title, item], index) => ({
    id: `${title}-${index}`,
    title,
    text: item.text,
    sourceIds: item.sourceIds,
  }));
  for (const gap of report.sections.gaps) {
    sections.push({ id: `${BLOCK_TITLES.gaps}-${sections.length}`, title: BLOCK_TITLES.gaps, text: gap, sourceIds: [] });
  }
  return sections;
}

function elapsedMs(createdAt: string, endedAt: string | null, now: number): number {
  const start = Date.parse(createdAt);
  const end = endedAt === null ? now : Date.parse(endedAt);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function formatClock(iso: string): string {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return "";
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDate(iso: string): string {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return "时间未知";
  return new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}
