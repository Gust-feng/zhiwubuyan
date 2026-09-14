import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchReport, ResearchSource, TaskDetail } from "@contracts/research";
import { ApiError } from "../../api";
import type { ResearchProProgress, ProCoverageRound } from "./research-view-model";
import {
  cancelResearchTask,
  createResearchTask,
  fetchLatestResearchTask,
  fetchResearchReport,
  fetchResearchSources,
  fetchResearchTask,
  isTerminalStatus,
} from "./research-client";

const POLL_INTERVAL_MS = 1_500;

/**
 * 深度研究任务状态：提交、轮询进度、按需加载来源与报告、取消。
 * 只走真实研究 API；失败保持可见并允许用同一 requestId 重试，不静默回退示例数据。
 *
 * enabled=false 时不发任何请求：服务端未声明研究能力时入口只如实说明未接通，
 * 而众声与它共用入口外壳，外壳常驻时不能顺带打一轮研究接口。
 */
export function useDeepResearch(initialTaskId?: string | null, enabled = true) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [sources, setSources] = useState<readonly ResearchSource[]>([]);
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [proProgress, setProProgress] = useState<ResearchProProgress | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pendingRequestId = useRef<string | null>(null);
  const loadedSourceCount = useRef(0);

  const applyDetail = useCallback((next: TaskDetail) => {
    setDetail(next);
    setError(null);
    setErrorCode(null);
    if (isTerminalStatus(next.status)) pendingRequestId.current = null;
  }, []);

  // 进入页面时恢复研究：指定任务优先（从首页或研究入口点进来），否则恢复最近一次。
  // 关闭页面不取消任务，回来应继续看同一条进度。
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const generation = requestGeneration.current;
    const load = initialTaskId
      ? fetchResearchTask(initialTaskId)
      : fetchLatestResearchTask().then((summary) => (summary ? fetchResearchTask(summary.id) : null));
    void load
      .then((task) => {
        if (!cancelled && task && generation === requestGeneration.current) applyDetail(task);
      })
      .catch((reason: unknown) => {
        if (!cancelled && generation === requestGeneration.current) setError(messageOf(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [applyDetail, initialTaskId, enabled]);

  // 未进入终态时按固定间隔轮询；终态立即停止。
  const status = detail?.status ?? null;
  const taskId = detail?.id ?? null;
  const terminal = detail === null ? false : isTerminalStatus(detail.status);
  useEffect(() => {
    if (!enabled || taskId === null || terminal) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await fetchResearchTask(taskId);
        if (cancelled) return;
        applyDetail(next);
      } catch (reason) {
        if (!cancelled) setError(messageOf(reason));
      }
      if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [taskId, terminal, status, applyDetail, enabled]);

  // 来源只在数量变化时重新拉取，避免每次轮询都取回全部快照。
  const sourceCount = detail?.sourceCount ?? 0;
  useEffect(() => {
    if (!enabled || taskId === null || sourceCount === 0 || sourceCount === loadedSourceCount.current) return;
    let cancelled = false;
    loadedSourceCount.current = sourceCount;
    void fetchResearchSources(taskId)
      .then((items) => {
        if (!cancelled) setSources(items);
      })
      .catch((reason: unknown) => {
        loadedSourceCount.current = 0;
        if (!cancelled) setError(messageOf(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, sourceCount, enabled]);

  const reportId = detail?.reportId ?? null;
  useEffect(() => {
    if (!enabled || taskId === null || reportId === null) return;
    let cancelled = false;
    void fetchResearchReport(taskId)
      .then((saved) => {
        if (!cancelled) setReport(saved);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(messageOf(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, reportId, enabled]);

  useEffect(() => () => {
    const pending = activeRequest.current;
    activeRequest.current = null;
    pending?.abort();
  }, []);

  // 进行中每秒刷新已用时长；终态后不再计时。
  useEffect(() => {
    if (terminal) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [terminal]);

  const submit = useCallback(
    async (question: string, allowWebSupplement: boolean, tier: "pro" | "ultra", requestId: string) => {
      const trimmed = question.trim();
      if (trimmed.length === 0 || activeRequest.current) return;
      const controller = new AbortController();
      requestGeneration.current += 1;
      activeRequest.current = controller;
      setSubmitting(true);
      setDetail(null);
      setProProgress(tier === "pro" ? { question: trimmed, createdAt: new Date().toISOString(), content: "", status: "running" } : null);
      loadedSourceCount.current = 0;
      setSources([]);
      setReport(null);
      setError(null);
      setErrorCode(null);
      try {
        pendingRequestId.current ??= requestId;
        const created = await createResearchTask({
          requestId: pendingRequestId.current,
          question: trimmed,
          allowWebSupplement,
          tier,
        }, {
          signal: controller.signal,
          onEvent(event) {
            if (activeRequest.current !== controller || controller.signal.aborted) return;
            if (event.type === "started") setProProgress({ question: event.question, createdAt: event.createdAt, content: "", status: "running" });
            if (event.type === "plan") setProProgress((current) => current ? { ...current, plan: event.plan, round: event.round } : current);
            if (event.type === "coverage") setProProgress((current) => current ? {
              ...current,
              round: event.round,
              coverageRounds: [...(current.coverageRounds ?? []), { round: event.round, analysis: event.analysis } satisfies ProCoverageRound],
            } : current);
            if (event.type === "material") setProProgress((current) => current ? { ...current, material: event.material } : current);
            if (event.type === "answer_delta") setProProgress((current) => current ? { ...current, content: current.content + event.text } : current);
          },
        });
        if (activeRequest.current !== controller) return;
        if (controller.signal.aborted) {
          setProProgress((current) => current ? { ...current, status: "cancelled" } : current);
          return;
        }
        setProProgress(null);
        applyDetail(created);
      } catch (reason) {
        if (activeRequest.current !== controller) return;
        if (controller.signal.aborted) {
          setProProgress((current) => current ? { ...current, status: "cancelled" } : current);
          return;
        }
        setProProgress((current) => current ? { ...current, status: "failed" } : current);
        setErrorCode(reason instanceof ApiError ? (reason.code ?? null) : null);
        setError(messageOf(reason));
      } finally {
        if (activeRequest.current === controller) {
          activeRequest.current = null;
          setSubmitting(false);
        }
      }
    },
    [applyDetail],
  );

  const cancel = useCallback(async () => {
    if (activeRequest.current && proProgress) {
      activeRequest.current.abort();
      return;
    }
    if (taskId === null) return;
    try {
      applyDetail(await cancelResearchTask(taskId));
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [taskId, applyDetail, proProgress]);

  const reset = useCallback(() => {
    requestGeneration.current += 1;
    const pending = activeRequest.current;
    activeRequest.current = null;
    pending?.abort();
    setSubmitting(false);
    setProProgress(null);
    pendingRequestId.current = null;
    loadedSourceCount.current = 0;
    setDetail(null);
    setSources([]);
    setReport(null);
    setError(null);
    setErrorCode(null);
  }, []);

  return { detail, sources, report, error, errorCode, submitting, proProgress, now, submit, cancel, reset };
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
