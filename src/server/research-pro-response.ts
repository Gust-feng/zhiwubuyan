import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { createResearchProCommand, ResearchProInput } from "../application/research-pro.ts";
import type { ResearchProEvent } from "../contracts/research.ts";
import { isProductError } from "../platform/zhihu/errors.ts";
import { writeJson } from "./http-utils.ts";

export async function respondResearchPro(
  command: ReturnType<typeof createResearchProCommand>,
  input: ResearchProInput,
  request: IncomingMessage,
  response: ServerResponse,
  timeoutMs = 290_000,
): Promise<boolean> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const disconnect = () => controller.abort();
  response.once("close", disconnect);
  const streaming = request.headers.accept?.includes("text/event-stream") === true;
  async function emit(event: ResearchProEvent) {
    controller.signal.throwIfAborted();
    if (!response.write(`data: ${JSON.stringify(event)}\n\n`)) {
      await once(response, "drain", { signal: controller.signal });
    }
  }
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    if (streaming) {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();
      heartbeat = setInterval(() => {
        if (!response.destroyed && !response.writableNeedDrain) response.write(": keep-alive\n\n");
      }, 15_000);
    }
    const result = await command.execute(input, {
      signal: controller.signal,
      onEvent: streaming ? emit : undefined,
    });
    if (streaming) response.end();
    else writeJson(response, 200, { ok: true, data: result.detail });
  } catch (cause) {
    if (response.destroyed) return true;
    const code = timedOut ? "TIMEOUT" : isProductError(cause)
      ? (cause.code === "AUTH_INVALID" || cause.code === "RATE_LIMITED" || cause.code === "QUOTA_EXHAUSTED" || cause.code === "PROTOCOL_ERROR"
        ? cause.code : "UPSTREAM_ERROR")
      : "UPSTREAM_ERROR";
    const message = timedOut ? "知乎直答响应超时，请重新研究。"
      : isProductError(cause) ? cause.message : "知乎直答暂时无法连接，请重新研究。";
    if (streaming) {
      const event: ResearchProEvent = { type: "failed", error: { code, message } };
      response.end(`data: ${JSON.stringify(event)}\n\n`);
    } else {
      const status = timedOut ? 504 : code === "RATE_LIMITED" || code === "QUOTA_EXHAUSTED" ? 429 : 502;
      writeJson(response, status, { ok: false, error: { code, message } });
    }
  } finally {
    clearTimeout(timer);
    if (heartbeat) clearInterval(heartbeat);
    response.off("close", disconnect);
  }
  return true;
}
