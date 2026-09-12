import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Coverage, StopReason, TaskOutcome, TaskStage, Usage } from "../contracts/research.ts";

/**
 * 运行轨迹：每任务一个 JSONL 事件流，回答"这次研究为什么停、停得对不对"。
 * 只读诊断，不是产品事实源；写入失败不影响研究主链路。
 */
export type RunTraceEvent =
  | { kind: "stage"; stage: TaskStage }
  | { kind: "batch"; batch: number; units: Array<{ unitId: string; questionId: string }> }
  | {
      kind: "coverage";
      answers: Array<{ questionId: string; coverage: Coverage }>;
      usage: { searchRequests: number; modelRequests: number };
    }
  | {
      kind: "terminal";
      outcome: TaskOutcome;
      errorCode: string | null;
      stopReason: StopReason | null;
      usage: Usage;
    };

export type RunTrace = {
  append(taskId: string, event: RunTraceEvent, at: string): Promise<void>;
};

export function createRunTrace(dataDir: string): RunTrace {
  const dir = join(dataDir, "runs");
  let ensured = false;
  let queue: Promise<void> = Promise.resolve();
  return {
    append(taskId, event, at) {
      queue = queue.then(async () => {
        try {
          if (!ensured) {
            await mkdir(dir, { recursive: true });
            ensured = true;
          }
          await appendFile(join(dir, `${taskId}.jsonl`), `${JSON.stringify({ ...event, at })}\n`, "utf8");
        } catch {
          // 诊断写入失败静默跳过：不能因轨迹影响研究执行与保存。
        }
      });
      return queue;
    },
  };
}
