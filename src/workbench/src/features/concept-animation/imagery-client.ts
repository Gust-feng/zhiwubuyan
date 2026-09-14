import { requestJson } from "@ui/api";
import type {
  AnimationRecord,
  AnimationSummaryList,
  ConceptAnimationResult,
} from "@contracts/concept-animation";

/**
 * 成象 HTTP 客户端：只做路径、请求体与 {ok,data} 外壳的拆装。
 * DTO 直接引用共享契约，前端不复制第二份类型；失败一律抛错，不回退示例数据。
 */

type Envelope<T> = { ok: true; data: T; recordId?: string } | { ok: false; error?: { code?: string; message?: string } };

const GENERATE = "/api/concept-animation";
const RECORDS = "/api/concept-animations";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const body = await requestJson<Envelope<T>>(path, init);
  if (body.ok) return body.data;
  // requestJson 对非 2xx 已抛 ApiError（含稳定 code）；ok:false 外壳仅兜底。
  throw new Error(body.error?.message ?? "成象服务返回失败。");
}

/**
 * 生成一个动画。成功即已落库：返回结果与记录 id（失败时 recordId 为 null）。
 * 记录 id 由服务端在落库时生成，前端不猜。
 */
export async function generateAnimation(input: {
  topic: string;
  instruction?: string;
  useMaterial: boolean;
}): Promise<{ result: ConceptAnimationResult; recordId: string | null }> {
  const body = await requestJson<Envelope<ConceptAnimationResult>>(GENERATE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!body.ok) throw new Error(body.error?.message ?? "成象服务返回失败。");
  return { result: body.data, recordId: body.recordId ?? null };
}

/** 历史列表：不含 html，避免一次拉回全部动画正文。 */
export function fetchAnimations(limit = 20, offset = 0, signal?: AbortSignal): Promise<AnimationSummaryList> {
  return call<AnimationSummaryList>(`${RECORDS}?limit=${limit}&offset=${offset}`, { signal });
}

export function fetchAnimation(id: string, signal?: AbortSignal): Promise<AnimationRecord> {
  return call<AnimationRecord>(`${RECORDS}/${encodeURIComponent(id)}`, { signal });
}

export function deleteAnimation(id: string): Promise<{ id: string }> {
  return call<{ id: string }>(`${RECORDS}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
