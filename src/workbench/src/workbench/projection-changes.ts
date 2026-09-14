import type { WorkbenchProjectionChange } from "@api-contracts/workbench";

type ProjectionChangeListener = (change: WorkbenchProjectionChange) => void;

const listeners = new Set<ProjectionChangeListener>();
let stream: EventSource | undefined;

/**
 * 失效通知是本机运行面能力：网页产物没有对应端点（Serverless 也不支持长连接），
 * 打开只会得到持续重连的空流。网页构建下直接不建立连接，各投影仍以 HTTP 读取为准。
 */
const streamSupported = __WORKBENCH_SURFACE__ !== "web";

/** One shared connection fans Host-owned invalidation facts out to Panel projections. */
export function subscribeWorkbenchProjectionChanges(listener: ProjectionChangeListener): () => void {
  if (!streamSupported) return () => {};
  listeners.add(listener);
  ensureStream();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stream?.close();
      stream = undefined;
    }
  };
}

function ensureStream(): void {
  if (!streamSupported || stream !== undefined || typeof EventSource === "undefined") return;
  const opened = new EventSource("/api/projection-changes");
  opened.addEventListener("workbench.projection.changed", ((message: MessageEvent<string>) => {
    try {
      const change = JSON.parse(message.data) as WorkbenchProjectionChange;
      if (!isProjectionChange(change)) return;
      for (const listener of [...listeners]) {
        try { listener(change); } catch { /* One projection cannot block the other owners. */ }
      }
    } catch {
      // A malformed optional notification must not affect the authoritative HTTP projections.
    }
  }) as EventListener);
  stream = opened;
}

function isProjectionChange(value: WorkbenchProjectionChange): boolean {
  return Number.isSafeInteger(value.revision)
    && value.revision >= 0
    && typeof value.reset === "boolean"
    && Array.isArray(value.owners);
}