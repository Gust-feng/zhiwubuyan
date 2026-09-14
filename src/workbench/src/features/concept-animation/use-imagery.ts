import { useCallback, useEffect, useRef, useState } from "react";
import type { AnimationRecord, AnimationSummary } from "@contracts/concept-animation";
import { ApiError } from "@ui/api";
import { deleteAnimation, fetchAnimation, fetchAnimations, generateAnimation } from "./imagery-client";

/**
 * 成象状态：生成、历史列表、按需加载单条记录、删除。
 *
 * 生成是一次同步长调用（数十秒），期间只显示"正在生成"，不做轮询——
 * 服务端返回即已完成并落库。失败保持可见并允许原样重试，不静默回退。
 *
 * enabled=false 时不发任何请求：服务端未声明成象能力时入口只如实说明未接通。
 */
export function useImagery(enabled = true) {
  const [result, setResult] = useState<AnimationRecord | null>(null);
  const [history, setHistory] = useState<readonly AnimationSummary[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const historyLoaded = useRef(false);

  const refreshHistory = useCallback(async () => {
    try {
      const list = await fetchAnimations(30, 0);
      setHistory(list.items);
      historyLoaded.current = true;
    } catch {
      // 历史拉取失败不影响主流程：生成结果本身仍会返回。
    }
  }, []);

  useEffect(() => {
    if (!enabled || historyLoaded.current) return;
    void refreshHistory();
  }, [enabled, refreshHistory]);

  const generate = useCallback(async (input: { topic: string; instruction?: string; useMaterial: boolean }) => {
    setGenerating(true);
    setError(null);
    setErrorCode(null);
    try {
      const { recordId } = await generateAnimation(input);
      // 落库返回记录 id 时按 id 精确取回完整记录；拿不到 id 就只刷新列表。
      if (recordId !== null) setResult(await fetchAnimation(recordId));
      await refreshHistory();
    } catch (reason: unknown) {
      setError(messageOf(reason));
      setErrorCode(codeOf(reason));
    } finally {
      setGenerating(false);
    }
  }, [refreshHistory]);

  const open = useCallback(async (id: string) => {
    setError(null);
    setErrorCode(null);
    try {
      setResult(await fetchAnimation(id));
    } catch (reason: unknown) {
      setError(messageOf(reason));
      setErrorCode(codeOf(reason));
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await deleteAnimation(id);
      setHistory((items) => items.filter((item) => item.id !== id));
      setResult((current) => (current?.id === id ? null : current));
    } catch (reason: unknown) {
      setError(messageOf(reason));
      setErrorCode(codeOf(reason));
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setErrorCode(null);
  }, []);

  return { result, history, generating, error, errorCode, generate, open, remove, reset };
}

function messageOf(reason: unknown): string {
  if (reason instanceof ApiError || reason instanceof Error) return reason.message;
  return "成象服务暂时没有响应，可以再试一次。";
}

/** 成象状态控制器：入口与结果态共用同一份实例，切换时状态不丢。 */
export type ImageryController = ReturnType<typeof useImagery>;

function codeOf(reason: unknown): string | null {
  return reason instanceof ApiError ? reason.code ?? null : null;
}
