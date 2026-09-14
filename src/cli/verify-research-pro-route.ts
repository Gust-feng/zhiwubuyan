/** 真实 HTTP + 可控上游验证 Pro 流式传输、失败和中止；不消耗真实额度。 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { createRuntime } from "../application/runtime.ts";
import { ResearchProEvent } from "../contracts/research.ts";
import { createZhihuApiHandler } from "../server/zhihu-api.ts";
import { createMemorySessionStore } from "../server/session-store.ts";
import { SESSION_COOKIE, writeJson } from "../server/http-utils.ts";

const encoder = new TextEncoder();
const data = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const delta = (content: string) => data({ choices: [{ delta: { content }, finish_reason: null }] });
const end = data({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 11 } }) + "data: [DONE]\r\n\r\n";
let calls = 0;
let timeoutMs = 5_000;
let finishUpstream: (() => void) | undefined;
let upstreamSignal: AbortSignal | undefined;
const runtime = createRuntime({
  accessSecret: "test-secret",
  fetch: async (_url, init) => {
    calls++;
    const input = JSON.parse(init.body ?? "{}");
    assert.equal(input.model, "zhida-agent");
    assert.equal(input.stream, true);
    const question = input.messages[0].content;
    upstreamSignal = init.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const push = (text: string) => {
          // 在每个 UTF-8 字节边界切分，包括中文和 CRLF。
          for (const byte of encoder.encode(text)) controller.enqueue(Uint8Array.of(byte));
        };
        const abort = () => controller.error(new DOMException("Stopped", "AbortError"));
        init.signal?.addEventListener("abort", abort, { once: true });
        const close = () => { init.signal?.removeEventListener("abort", abort); controller.close(); };
        push(": keep-alive\r\n\r\n");
        push(data({ choices: [{ delta: { reasoning_content: "内部推理不能作为正文" } }] }));
        if (question !== "empty") push(delta("第一段中文。"));
        if (question === "gated") {
          finishUpstream = () => { push(delta("第二段。") + end); close(); };
        } else if (question === "timeout" || question === "disconnect") {
          // 等待路由把超时或断开传到同一个上游信号。
        } else if (question === "truncated") {
          close();
        } else if (question === "failure") {
          push(data({ choices: [{ delta: {}, finish_reason: "error", error: { message: "test failure" } }] }) + end);
          close();
        } else {
          push(end);
          close();
        }
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  },
});
const sessions = createMemorySessionStore();
const sessionId = await sessions.create({ accessToken: "test-oauth", tokenType: "Bearer", expiresAt: Date.now() + 60_000 });
const handle = createZhihuApiHandler({
  runtime,
  sessions,
  oauthConfig: undefined,
  capabilities: ["research"],
  surface: "web",
  researchProEnabled: true,
  get researchProTimeoutMs() { return timeoutMs; },
});
const server = createServer(async (request, response) => {
  try {
    if (!await handle(new URL(request.url!, "http://localhost"), request, response)) writeJson(response, 404, {});
  } catch (cause) {
    console.error(cause);
    response.destroy();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}/api/research-tasks`;
function post(question: string, options: { accept?: string; anonymous?: boolean; tier?: string; questionOverride?: string } = {}) {
  return fetch(base, {
    method: "POST",
    signal: AbortSignal.timeout(5_000),
    headers: {
      "content-type": "application/json",
      accept: options.accept ?? "text/event-stream",
      ...(options.anonymous ? {} : { cookie: `${SESSION_COOKIE}=${sessionId}` }),
    },
    body: JSON.stringify({ requestId: crypto.randomUUID(), question: options.questionOverride ?? question, tier: options.tier ?? "pro", allowWebSupplement: false }),
  });
}
function reader(response: Response) {
  assert(response.body);
  return response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream()).getReader();
}
async function events(response: Response) {
  const stream = reader(response);
  const received: ResearchProEvent[] = [];
  while (true) {
    const item = await stream.read();
    if (item.done) break;
    received.push(ResearchProEvent.parse(JSON.parse(item.value.data)));
  }
  stream.releaseLock();
  return received;
}

try {
  // 普通 JSON 客户端仍收到完整答案，上游只调用一次。
  const json = await post("normal", { accept: "application/json" });
  assert.equal(json.status, 200);
  const complete = await json.json() as { data: { answer: { content: string }; status: string; sourceCount: number; usage: { inputTokens: number } } };
  assert.equal(complete.data.answer.content, "第一段中文。");
  assert.equal(complete.data.status, "completed");
  assert.equal(complete.data.sourceCount, 0);
  assert.equal(complete.data.usage.inputTokens, 7);
  assert.equal(calls, 1);

  // 上游尚未完成时，浏览器必须已经收到第一个正文片段。
  const response = await post("gated");
  assert.match(response.headers.get("content-type")!, /text\/event-stream/);
  const stream = reader(response);
  const started = ResearchProEvent.parse(JSON.parse((await stream.read()).value!.data));
  assert.equal(started.type, "started");
  const first = ResearchProEvent.parse(JSON.parse((await stream.read()).value!.data));
  assert.deepEqual(first, { type: "answer_delta", text: "第一段中文。" });
  assert(finishUpstream);
  finishUpstream();
  const second = ResearchProEvent.parse(JSON.parse((await stream.read()).value!.data));
  assert.deepEqual(second, { type: "answer_delta", text: "第二段。" });
  const completed = ResearchProEvent.parse(JSON.parse((await stream.read()).value!.data));
  assert.equal(completed.type, "completed");
  if (completed.type === "completed") assert.equal(completed.detail.answer?.content, "第一段中文。第二段。");
  assert.equal((await stream.read()).done, true);
  stream.releaseLock();

  for (const question of ["truncated", "failure", "empty"]) {
    const received = await events(await post(question));
    assert.equal(received.at(-1)?.type, "failed", question);
    assert(!received.some((event) => event.type === "completed"), question);
  }

  timeoutMs = 80;
  const timedOut = await events(await post("timeout"));
  assert(upstreamSignal?.aborted);
  assert(timedOut.at(-1)?.type === "failed");
  assert.equal((timedOut.at(-1) as Extract<ResearchProEvent, { type: "failed" }>).error.code, "TIMEOUT");
  timeoutMs = 5_000;

  const disconnectStream = reader(await post("disconnect"));
  await disconnectStream.read();
  await disconnectStream.read();
  await disconnectStream.cancel();
  await delay(100);
  assert(upstreamSignal?.aborted, "浏览器停止必须中止上游");

  const beforeRejected = calls;
  assert.equal((await post("normal", { anonymous: true })).status, 401);
  const rejected = await (await post("normal", { tier: "ultra" })).json() as { code?: string };
  assert.equal(rejected.code, "RESEARCH_TIER_UNAVAILABLE");
  assert.equal((await post("normal", { questionOverride: "x".repeat(2001) })).status, 400);
  assert.equal(calls, beforeRejected, "拒绝请求不能消耗上游额度");
  const list = await (await fetch(base)).json() as { data: { items: unknown[] } };
  assert.deepEqual(list.data.items, []);
  console.log(JSON.stringify({ ok: true, checks: "research-pro-route: incremental, utf8, failure, timeout, disconnect, auth, tier, input" }));
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
