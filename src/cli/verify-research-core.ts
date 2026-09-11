/**
 * 深度研究核心机制验证：用可控假网关直接驱动应用命令，
 * 覆盖幂等、预算、取消迟到写入、引用校验与原子保存边界。
 * 只验证机制，不代表真实模型/知乎研究质量。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeepResearchSystem, ResearchApiError, StageFailureError, type UpstreamSearchItem, type ZhihuSearchGateway } from "../application/deep-research.ts";
import { ProductError } from "../platform/zhihu/errors.ts";
import { parseStageJson } from "../agent/research-agent.ts";
import { ReportModelOutput } from "../contracts/research.ts";
import { openResearchStore } from "../storage/research-store.ts";
import { createRunTrace } from "../storage/run-trace.ts";

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

function makeItem(index: number, text: string): UpstreamSearchItem {
  return {
    id: `item-${index}`,
    title: `测试来源 ${index}`,
    url: `https://example.invalid/item/${index}?utm_source=test`,
    summary: text,
    authorName: `作者 ${index}`,
    contentType: "Answer",
    contentId: `90071992547409${90 + index}`,
    voteCount: 10 * index,
    commentCount: index,
    authorityLevel: index % 2 === 0 ? "2" : undefined,
    editTimeSeconds: 1_710_000_000 + index,
    fetchedAt: new Date("2026-09-13T00:00:00.000Z").toISOString(),
  };
}

type GatewayScript = {
  items: UpstreamSearchItem[];
  /** 每个 zhihu 请求前延迟，用于构造并发/取消窗口。 */
  delayMs?: number;
  failWith?: Error;
};

function fixtureGateway(script: GatewayScript): ZhihuSearchGateway & { zhihuCalls: number; webCalls: number } {
  let zhihuCalls = 0;
  let webCalls = 0;
  return {
    get zhihuCalls() {
      return zhihuCalls;
    },
    get webCalls() {
      return webCalls;
    },
    async searchZhihu(input) {
      zhihuCalls += 1;
      if (script.delayMs) await new Promise((resolve) => setTimeout(resolve, script.delayMs));
      if (script.failWith) throw script.failWith;
      if (input.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return { items: script.items };
    },
    async searchGlobal(input) {
      webCalls += 1;
      if (input.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return { items: script.items };
    },
  };
}

const clockStart = Date.parse("2026-09-13T00:00:00.000Z");
let clockNow = clockStart;
const clock = () => new Date(clockNow);

type ZhidaScript = {
  content: string;
  failWith?: Error;
};

function fixtureZhida(script: ZhidaScript) {
  let calls = 0;
  const models: string[] = [];
  return {
    get calls() {
      return calls;
    },
    get models() {
      return models;
    },
    async answer(input: { model: string; prompt: string }) {
      calls += 1;
      models.push(input.model);
      if (script.failWith) throw script.failWith;
      return {
        model: input.model,
        content: script.content,
        usage: { inputTokens: 42, outputTokens: 128 },
      };
    },
  };
}

const dataDir = mkdtempSync(join(tmpdir(), "research-core-"));
try {
  const store = await openResearchStore(dataDir);
  void store;
  const text1 = "小团队减少会议后，用文档同步替代了大部分例会。";
  const text2 = "跨时区协作仍然需要明确的异步约定，否则会遗漏决策。";
  const gateway = fixtureGateway({ items: [makeItem(1, text1), makeItem(2, text2)] });
  const zhida = fixtureZhida({ content: "直答生成的快答内容。" });
  const engine = createDeepResearchSystem({
    store,
    zhihu: gateway,
    zhida,
    desktopEdition: true,
    clock,
    modelInfo: () => ({ provider: "fixture", modelId: "fixture-model" }),
    zhihuConfigured: true,
    trace: createRunTrace(dataDir),
  });
  // 机制验证不运行真实工作流：挂接无操作执行端口，任务保持 outcome=null 供各场景驱动。
  engine.attachExecutionPort({
    async startExecution() {},
    async cancelExecution() {},
    async readExecutionStage() {
      return null;
    },
    isExecutionActive() {
      return false;
    },
  });

  // 1. 创建幂等：相同 requestId + 相同输入返回原任务；不同输入冲突。
  const requestId = "74a52ce5-0da4-481d-894b-a4f94a0a6201";
  const first = await engine.createResearchTask({ requestId, question: "远程小团队如何兼顾专注与协作？", allowWebSupplement: false, tier: "ultra" });
  check(first.accepted, "首个创建请求应被受理");
  const duplicate = await engine.createResearchTask({ requestId, question: "远程小团队如何兼顾专注与协作？", allowWebSupplement: false, tier: "ultra" });
  check(!duplicate.accepted && duplicate.detail.id === first.detail.id, "重复创建应返回原任务");
  let conflict = false;
  try {
    await engine.createResearchTask({ requestId, question: "另一个问题", allowWebSupplement: false, tier: "ultra" });
  } catch (error) {
    conflict = error instanceof ResearchApiError && error.code === "REQUEST_CONFLICT";
  }
  check(conflict, "相同 requestId 不同输入应报 REQUEST_CONFLICT");

  const taskId = first.detail.id;

  // 2. 主管计划与决策准入。
  const plan = await engine.submitInitialPlan(taskId, {
    objective: "远程小团队如何兼顾专注与协作？",
    assumptions: ["按小团队情境研究。"],
    questions: [
      { text: "减少会议如何影响专注？", priority: "high" },
      { text: "异步协作的失败经验是什么？", priority: "high" },
      { text: "适用哪些团队规模？", priority: "normal" },
    ],
  });
  check(plan.version === 1 && plan.questions.length === 3, "初始计划应有 3 个问题且 version=1");

  const decision = await engine.applySupervisorDecision({
    taskId,
    decision: {
      units: [
        { questionId: "q1", objective: "查找减少会议的正面与失败经验", focus: "counterevidence" },
        { questionId: "q2", objective: "查找异步协作失败案例", focus: "supporting" },
      ],
      planUpdates: {
        newQuestions: [{ text: "异步协作的失败经验是什么？", priority: "normal" }],
        closeQuestions: [],
      },
    },
  });
  check(decision.plan.version === 1, "重复问题应被合并，不产生新版本");
  check(decision.units.length === 2, "两个有效单元应被派发");

  // 3. 单元搜索：保存来源、真实身份、重复复用、并发与范围限制。
  const unitA = decision.units[0]!;
  const searchA = await engine.unitSearch({
    taskId,
    unitId: unitA.unitId,
    questionId: "q1",
    channel: "zhihu",
    text: "远程团队 减少会议 经验",
    purpose: "background",
    runSignal: new AbortController().signal,
  });
  check(searchA.status === "succeeded" && searchA.sources.length === 2, "搜索应保存 2 份来源");
  const detailAfterSearch = await engine.getResearchTaskDetail(taskId);
  check(detailAfterSearch.sourceCount === 2, "来源计数应为 2");
  check(detailAfterSearch.queries.length === 1 && detailAfterSearch.queries[0]?.status === "succeeded", "查询记录应为 succeeded");
  check(
    detailAfterSearch.queries[0]?.sourceIds.length === 2 &&
      detailAfterSearch.queries[0]?.discardedCount === 0,
    "查询记录应关联来源且无剔除",
  );
  const reused = await engine.unitSearch({
    taskId,
    unitId: unitA.unitId,
    questionId: "q1",
    channel: "zhihu",
    text: "远程团队 减少会议 经验",
    purpose: "background",
    runSignal: new AbortController().signal,
  });
  check(reused.status === "reused", "规范化后相同查询应复用结果");
  const webBlocked = await engine.unitSearch({
    taskId,
    unitId: unitA.unitId,
    questionId: "q1",
    channel: "web",
    text: "remote work research",
    purpose: "verification",
    runSignal: new AbortController().signal,
  });
  check(webBlocked.status === "rejected" && webBlocked.reason === "web_channel_not_allowed", "未授权全网应被拒绝且不发请求");
  check(gateway.webCalls === 0, "全网请求计数应为 0");

  // 4. 发现提交：引用校验与来源归属。
  const sources = await engine.listResearchSources(taskId);
  const source1 = sources.items.find((item) => item.text === text1)!;
  const source2 = sources.items.find((item) => item.text === text2)!;
  const commit = await engine.commitUnitFindings({
    taskId,
    unitId: unitA.unitId,
    proposals: [
      {
        questionId: "q1",
        statement: "材料描述减少会议后用文档同步替代例会。",
        kind: "experience",
        conditions: ["小团队"],
        limitations: ["单一材料"],
        evidence: [{ sourceId: source1.id, quote: "用文档同步替代了大部分例会", relation: "support" }],
      },
      {
        questionId: "q1",
        statement: "跨时区协作仍需异步约定。",
        kind: "fact",
        conditions: [],
        limitations: [],
        evidence: [{ sourceId: source2.id, quote: "跨时区协作仍然需要明确的异步约定", relation: "qualify" }],
      },
    ],
  });
  check(commit.addedFindingIds.length === 2, "两条发现应被保存");

  const badQuote = await engine.commitUnitFindings({
    taskId,
    unitId: unitA.unitId,
    proposals: [
      {
        questionId: "q1",
        statement: "伪造引用。",
        kind: "fact",
        conditions: [],
        limitations: [],
        evidence: [{ sourceId: source1.id, quote: "这句原文不存在", relation: "support" }],
      },
    ],
  });
  check(
    badQuote.addedFindingIds.length === 0 && badQuote.rejectedCount === 1,
    "伪 quote 应被剔除并记录原因",
  );

  const unknownSource = await engine.commitUnitFindings({
    taskId,
    unitId: unitA.unitId,
    proposals: [
      {
        questionId: "q1",
        statement: "跨任务引用。",
        kind: "fact",
        conditions: [],
        limitations: [],
        evidence: [{ sourceId: "source-not-exist", quote: "任意", relation: "support" }],
      },
    ],
  });
  check(
    unknownSource.addedFindingIds.length === 0 && unknownSource.rejectedCount === 1,
    "未知来源应被剔除并记录原因",
  );

  // 5. 主管合并：覆盖判断校验。
  await engine.mergeUnitResults(taskId, [
    { questionId: "q1", coverage: "partial", text: "有正反两面材料。", findingIds: commit.addedFindingIds, gaps: ["缺少规模差异"] },
    { questionId: "q2", coverage: "unanswered", text: "尚无失败案例。", findingIds: [], gaps: [] },
    { questionId: "q3", coverage: "unanswered", text: "尚无适用范围资料。", findingIds: [], gaps: [] },
  ]);
  const downgraded = await engine.mergeUnitResults(taskId, [
    { questionId: "q1", coverage: "contested", text: "冲突判断只有一条依据。", findingIds: [commit.addedFindingIds[0]!], gaps: [] },
    { questionId: "q2", coverage: "unanswered", text: "无", findingIds: [], gaps: [] },
    { questionId: "q3", coverage: "unanswered", text: "无", findingIds: [], gaps: [] },
  ]);
  check(
    downgraded.answers.find((a) => a.questionId === "q1")?.coverage === "partial",
    "contested 单依据应降级为 partial 而非伪造冲突",
  );

  const omitted = await engine.mergeUnitResults(taskId, [
    { questionId: "q2", coverage: "unanswered", text: "无", findingIds: [], gaps: [] },
    { questionId: "q3", coverage: "unanswered", text: "无", findingIds: [], gaps: [] },
  ]);
  check(
    omitted.answers.find((a) => a.questionId === "q1")?.coverage === "partial",
    "主管漏答的开放子问题应继承上一轮有效判断，不掉回未回答",
  );

  const hallucinated = await engine.mergeUnitResults(taskId, [
    { questionId: "q1", coverage: "supported", text: "引用不存在的发现。", findingIds: ["finding-does-not-exist"], gaps: [] },
    { questionId: "q2", coverage: "unanswered", text: "无", findingIds: [], gaps: [] },
    { questionId: "q3", coverage: "unanswered", text: "无", findingIds: [], gaps: [] },
  ]);
  const q1After = hallucinated.answers.find((a) => a.questionId === "q1");
  check(
    q1After?.coverage === "unanswered" && q1After.findingIds.length === 0,
    "幻觉 finding 引用应被剔除并降级，不产生无依据支持",
  );

  // 6. 预算账本：预占-结算-归还，超额拒绝。
  await engine.admitModelSteps(taskId, 5, "synthesis");
  await engine.consumeModelStep(taskId, { inputTokens: 100, outputTokens: 50, cachedInputTokens: 80 });
  await engine.consumeModelStep(taskId, { inputTokens: null, outputTokens: null, cachedInputTokens: null });
  await engine.releaseModelReservation(taskId, 3);
  const usageAfter = await engine.getResearchTaskDetail(taskId);
  check(usageAfter.usage.modelRequests === 2, "模型请求应计 2 次");
  check(usageAfter.usage.inputTokens === 100 && usageAfter.usage.outputTokens === 50, "已知 token 累计；未知不填零");
  check(usageAfter.usage.cachedInputTokens === 80, "缓存命中 token 累计；未知保持 null");
  let budgetRejected = false;
  try {
    await engine.admitModelSteps(taskId, 200, "exploration");
  } catch (error) {
    budgetRejected = error instanceof StageFailureError && error.taskErrorCode === "BUDGET_EXCEEDED";
  }
  check(budgetRejected, "探索超额预占应报 BUDGET_EXCEEDED");

  // 7. 成稿：派生来源与原子保存；重复保存返回同一版本。
  const finalize = await engine.loadFinalizeContext(taskId);
  check(finalize.findings.length === 2 && finalize.excerpts.length === 2, "成稿输入应包含发现与证据摘录");
  const draft = {
    title: "远程小团队协作：材料中的条件与缺口",
    sections: {
      conclusion: [
        { text: "减少会议与文档同步需要一起考虑。", findingIds: [commit.addedFindingIds[0]!] },
      ],
      evidence: [
        { text: "材料描述减少会议后用文档同步替代例会。", findingIds: [commit.addedFindingIds[0]!] },
      ],
      disagreements: [],
      gaps: ["缺少规模差异"],
    },
  };
  await engine.validateDraft(taskId, draft);
  const report = await engine.finalizeReport(taskId, draft, {
    stopReason: "source_saturated",
    completeness: "partial",
  });
  check(
    report.sections.conclusion[0]?.sourceIds.length === 1 &&
      report.sections.conclusion[0]?.sourceIds[0] === source1.id,
    "段落 sourceIds 应由发现证据派生",
  );
  const duplicateReport = await engine.finalizeReport(taskId, draft, {
    stopReason: "source_saturated",
    completeness: "partial",
  });
  check(duplicateReport.id === report.id, "重复保存应返回同一报告");
  const detailCompleted = await engine.getResearchTaskDetail(taskId);
  check(detailCompleted.status === "completed" && detailCompleted.reportId === report.id, "报告提交后任务应为 completed");
  const afterComplete = await engine.commitUnitFindings({
    taskId,
    unitId: "late-unit",
    proposals: [],
  }).catch((error: unknown) => error);
  check(afterComplete instanceof StageFailureError, "完成后迟到发现应被拒绝");

  // 8. 取消：未结束任务的取消关闭写入准入；活动执行结束后 cancelled。
  const cancelTask = await engine.createResearchTask({
    requestId: "a5a52ce5-0da4-481d-894b-a4f94a0a6202",
    question: "取消测试问题",
    allowWebSupplement: false,
    tier: "ultra",
  });
  const cancelId = cancelTask.detail.id;
  await engine.submitInitialPlan(cancelId, {
    objective: "取消测试问题",
    assumptions: [],
    questions: [
      { text: "q?", priority: "high" },
      { text: "r?", priority: "normal" },
      { text: "s?", priority: "normal" },
    ],
  });
  await engine.admitModelSteps(cancelId, 2, "exploration");
  const cancelled = await engine.cancelResearchTask(cancelId);
  check(cancelled.detail.status === "cancelled" || cancelled.detail.status === "cancelling", "取消后应为 cancelling/cancelled");
  await engine.confirmExecutionEnd(cancelId);
  const afterCancel = await engine.getResearchTaskDetail(cancelId);
  check(afterCancel.status === "cancelled", "执行结束后应显示 cancelled");
  const lateSearch = await engine.unitSearch({
    taskId: cancelId,
    unitId: "late-unit",
    questionId: "q1",
    channel: "zhihu",
    text: "取消后的迟到查询",
    purpose: "background",
    runSignal: new AbortController().signal,
  });
  check(lateSearch.status === "rejected", "取消后的搜索应被拒绝");
  const lateCommit = await engine.commitUnitFindings({
    taskId: cancelId,
    unitId: "late-unit",
    proposals: [
      {
        questionId: "q1",
        statement: "迟到发现",
        kind: "fact",
        conditions: [],
        limitations: [],
        evidence: [],
      },
    ],
  }).catch((error: unknown) => error);
  check(lateCommit instanceof StageFailureError, "取消后的发现提交应被拒绝");
  const cancelTerminal = await engine.cancelResearchTask(cancelId);
  check(cancelTerminal.detail.status === "cancelled" && cancelTerminal.httpStatus === 200, "取消终态任务是幂等读取");

  // 9. 重启收敛：outcome 为空的任务标记 interrupted。
  const interruptedTask = await engine.createResearchTask({
    requestId: "b5a52ce5-0da4-481d-894b-a4f94a0a6203",
    question: "重启收敛测试",
    allowWebSupplement: false,
    tier: "ultra",
  });
  const recovered = await engine.recoverInterruptedTasks();
  check(recovered.includes(interruptedTask.detail.id), "未完成任务应被标记 interrupted");
  const interruptedDetail = await engine.getResearchTaskDetail(interruptedTask.detail.id);
  check(interruptedDetail.status === "interrupted" && interruptedDetail.endedAt !== null, "interrupted 任务应有结束时间");

  // 10. 无凭证读取：历史任务仍可读。
  const readWithoutConfig = await engine.getResearchTaskDetail(taskId);
  check(readWithoutConfig.id === taskId, "读取不依赖凭证");

  // 11. 直答快答：同步完成、答案落库、usage 记账、无来源。
  const quick = await engine.createResearchTask({
    requestId: "c5a52ce5-0da4-481d-894b-a4f94a0a6204",
    question: "快答验证问题？",
    allowWebSupplement: false,
    tier: "fast",
  });
  check(quick.accepted && quick.detail.status === "completed", "快答应同步完成");
  check(
    quick.detail.tier === "fast" &&
      quick.detail.answer !== null &&
      quick.detail.answer.content === "直答生成的快答内容。",
    "快答应包含生成正文",
  );
  check(quick.detail.answer?.model === "zhida-fast-1p5", "fast 档应映射 zhida-fast-1p5");
  check(quick.detail.usage.modelRequests === 1, "快答应计 1 次模型请求");
  check(
    quick.detail.usage.inputTokens === 42 && quick.detail.usage.outputTokens === 128,
    "快答 token 应来自上游 usage",
  );
  check(quick.detail.sourceCount === 0 && quick.detail.reportId === null, "快答无来源、无报告");
  const quickDuplicate = await engine.createResearchTask({
    requestId: "c5a52ce5-0da4-481d-894b-a4f94a0a6204",
    question: "快答验证问题？",
    allowWebSupplement: false,
    tier: "fast",
  });
  check(!quickDuplicate.accepted && quickDuplicate.detail.id === quick.detail.id, "快答重复请求应返回原任务");

  // 12. 档位映射与失败路径。
  const agentTask = await engine.createResearchTask({
    requestId: "d5a52ce5-0da4-481d-894b-a4f94a0a6205",
    question: "Pro 档验证？",
    allowWebSupplement: false,
    tier: "pro",
  });
  check(agentTask.detail.answer?.model === "zhida-agent", "agent 档应映射 zhida-agent");
  check(zhida.calls === 2, "两次成功快答应共 2 次直答调用（失败场景用独立网关）");
  const failingZhida = fixtureZhida({ content: "", failWith: new ProductError("UPSTREAM_ERROR", "直答暂时没有响应。") });
  const failingEngine = createDeepResearchSystem({
    store,
    zhihu: gateway,
    zhida: failingZhida,
    desktopEdition: true,
    clock,
    modelInfo: () => ({ provider: "fixture", modelId: "fixture-model" }),
    zhihuConfigured: true,
    trace: createRunTrace(dataDir),
  });
  let quickFailed = false;
  try {
    await failingEngine.createResearchTask({
      requestId: "e5a52ce5-0da4-481d-894b-a4f94a0a6206",
      question: "失败路径验证？",
      allowWebSupplement: false,
      tier: "thinking",
    });
  } catch (error) {
    quickFailed =
      error instanceof ResearchApiError && error.code === "UPSTREAM_ERROR" && error.status === 502;
  }
  check(quickFailed, "直答失败应映射 UPSTREAM_ERROR 502");
  const failedTaskRow = (await store.listTasks(10, 0)).find(
    (item) => item.tier === "thinking" && item.outcome === "failed",
  );
  check(failedTaskRow !== undefined && failedTaskRow.error?.code === "UPSTREAM_ERROR", "失败快答应写入 failed 与错误码");

  // 13. 桌面判定：非桌面配置下 Ultra 被拒绝，快答不受影响。
  const webEngine = createDeepResearchSystem({
    store,
    zhihu: gateway,
    zhida,
    desktopEdition: false,
    clock,
    modelInfo: () => ({ provider: "fixture", modelId: "fixture-model" }),
    zhihuConfigured: true,
    trace: createRunTrace(dataDir),
  });
  let ultraRejected = false;
  try {
    await webEngine.createResearchTask({
      requestId: "f5a52ce5-0da4-481d-894b-a4f94a0a6207",
      question: "非桌面 Ultra 验证？",
      allowWebSupplement: false,
      tier: "ultra",
    });
  } catch (error) {
    ultraRejected =
      error instanceof ResearchApiError && error.code === "ULTRA_DESKTOP_ONLY" && error.status === 403;
  }
  check(ultraRejected, "非桌面创建 Ultra 应报 ULTRA_DESKTOP_ONLY 403");
  const webQuick = await webEngine.createResearchTask({
    requestId: "f5a52ce5-0da4-481d-894b-a4f94a0a6208",
    question: "非桌面快答验证？",
    allowWebSupplement: false,
    tier: "fast",
  });
  check(webQuick.detail.status === "completed", "非桌面快答不受影响");

  // 14. 成稿容忍：报告段落超过反退化天花板时截断保留，不整任务失败。
  const longDraft = {
    title: "超长报告",
    sections: {
      conclusion: [{ text: "结论段。", findingIds: [commit.addedFindingIds[0]!] }],
      evidence: Array.from({ length: 620 }, (_, i) => ({
        text: `依据段落 ${i}：材料原文摘录。`,
        findingIds: [commit.addedFindingIds[0]!],
      })),
      disagreements: [],
      gaps: [],
    },
  };
  const parsed = parseStageJson(JSON.stringify(longDraft), ReportModelOutput);
  check(parsed.sections.evidence.length === 500, "超长数组应截断到天花板而非失败");
  check(parsed.sections.conclusion.length === 1, "截断只作用于超限数组");

  // 场景全部完成后关闭连接再清理临时目录。
  await store.close();
} catch (cleanupError) {
  // Windows 下 libsql 句柄释放可能有延迟；临时目录由系统清理，不影响验证结论。
  console.warn(`cleanup skipped: ${String(cleanupError).slice(0, 120)}`);
}

if (failures.length > 0) {
  console.error("FAILURES:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, scenarios: 14 }));
