import { ApiError, requestJson } from "../../api";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { ResearchProEvent } from "@contracts/research";
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

export async function createResearchTask(input: {
  requestId: string;
  question: string;
  allowWebSupplement: boolean;
  tier: "pro" | "ultra";
}, options: { signal?: AbortSignal; onEvent?: (event: ResearchProEvent) => void } = {}): Promise<TaskDetail> {
  if (input.tier === "pro") {
    const response = await fetch(BASE, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(input),
      signal: options.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { code?: string; message?: string; error?: { code?: string; message?: string } };
      throw new ApiError(response.status, body.error?.code ?? body.code, body.error?.message ?? body.message ?? `研究请求失败：${response.status}`);
    }
    // 已部署的 JSON 服务在升级前仍可响应；不能为协商失败重发一次生成请求。
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      const body = await response.json() as Envelope<TaskDetail>;
      if (body.ok) return body.data;
      throw new ApiError(502, "PROTOCOL_ERROR", "研究服务没有返回答案。");
    }
    if (!response.body) throw new ApiError(502, "PROTOCOL_ERROR", "研究服务未返回事件流。");
    const reader = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream()).getReader();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        let event: ResearchProEvent;
        try {
          event = ResearchProEvent.parse(JSON.parse(item.value.data));
        } catch {
          throw new ApiError(502, "PROTOCOL_ERROR", "研究服务返回了无效事件，请重新研究。");
        }
        if (event.type === "failed") throw new ApiError(502, event.error.code, event.error.message);
        options.onEvent?.(event);
        if (event.type === "completed") return event.detail;
      }
      throw new ApiError(502, "PROTOCOL_ERROR", "连接在研究完成前断开，请重新研究。");
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  return call<TaskDetail>(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: options.signal,
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
