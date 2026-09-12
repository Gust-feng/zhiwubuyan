import { requestJson } from "../../api";
import type {
  ResearchReport,
  ResearchSource,
  TaskDetail,
  TaskSummary,
} from "@contracts/research";

/**
 * 深度研究 HTTP 客户端：只做路径、请求体与 {ok,data} 外壳的拆装。
 * DTO 直接引用共享契约，前端不复制第二份类型；真实模式失败一律抛错，不回退示例数据。
 */

type Envelope<T> = { ok: true; data: T } | { ok: false; error?: { code?: string; message?: string } };

const BASE = "/api/research-tasks";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const body = await requestJson<Envelope<T>>(path, init);
  if (body.ok) return body.data;
  // requestJson 对非 2xx 已抛 ApiError（含稳定 code）；ok:false 外壳仅兜底。
  throw new Error(body.error?.message ?? "研究服务返回失败。");
}

export function createResearchTask(input: {
  requestId: string;
  question: string;
  allowWebSupplement: boolean;
  tier: "pro" | "ultra";
}): Promise<TaskDetail> {
  return call<TaskDetail>(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** 任务列表按创建时间倒序，第一页即最近的研究。 */
export function fetchResearchTasks(limit = 20, offset = 0, signal?: AbortSignal): Promise<TaskSummary[]> {
  return call<{ items: TaskSummary[]; hasMore: boolean }>(`${BASE}?limit=${limit}&offset=${offset}`, { signal }).then(
    (page) => page.items,
  );
}

export function fetchLatestResearchTask(): Promise<TaskSummary | null> {
  return fetchResearchTasks(1).then((items) => items[0] ?? null);
}

export function fetchResearchTask(taskId: string): Promise<TaskDetail> {
  return call<TaskDetail>(`${BASE}/${encodeURIComponent(taskId)}`);
}

export function cancelResearchTask(taskId: string): Promise<TaskDetail> {
  return call<TaskDetail>(`${BASE}/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

export function fetchResearchSources(taskId: string): Promise<ResearchSource[]> {
  return call<{ items: ResearchSource[] }>(`${BASE}/${encodeURIComponent(taskId)}/sources`).then(
    (page) => page.items,
  );
}

export function fetchResearchReport(taskId: string): Promise<ResearchReport> {
  return call<ResearchReport>(`${BASE}/${encodeURIComponent(taskId)}/report`);
}

/** 报告 Markdown 由后端确定性渲染，前端不自行拼接正文。 */
export function researchReportMarkdownUrl(taskId: string): string {
  return `${BASE}/${encodeURIComponent(taskId)}/report.md`;
}

export function isTerminalStatus(status: TaskSummary["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
}
