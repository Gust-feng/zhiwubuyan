/** 真实 HTTP + 可控上游验证 Pro 多轮编排的流式传输、失败和中止；不消耗真实额度。 */
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
/** 拆题与覆盖判断走非流式 fast：这里按提示词给出对应 JSON。 */
const PLAN_JSON = { objective: "测试目标", questions: [
  { text: "子问题一", priority: "high" },
  { text: "子问题二", priority: "normal" },
  { text: "子问题三", priority: "normal" },
] };
const COVERAGE_JSON = { answers: [
  { questionId: "q1", coverage: "supported", text: "有依据。", gaps: [] },
  { questionId: "q2", coverage: "unanswered", text: "暂无。", gaps: ["缺少资料"] },
  { questionId: "q3", coverage: "unanswered", text: "暂无。", gaps: ["缺少资料"] },
], nextQueries: [], stop: true };
let modelCalls = 0;
const callsByModel: Record<string, number> = {};
let timeoutMs = 5_000;
let finishUpstream: (() => void) | undefined;
let upstreamSignals: Array<AbortSignal | undefined> = [];
const runtime = createRuntime({
  accessSecret: "test-secret",
  fetch: async (_url, init) => {
    if (_url.includes("/api/v1/content/zhihu_search") || _url.includes("/api/v1/content/global_search")) {
      return new Response(JSON.stringify({ Code: 0, Message: "ok", Data: {
        Items: [{ Title: "测试参考资料", Url: "https://www.zhihu.com/question/1/answer/2", ContentText: "测试摘要。", AuthorName: "测试作者" }],
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const input = JSON.parse(init.body ?? "{}") as { model: string; stream?: boolean; messages: Array<{ content: string }> };
    modelCalls += 1;
    callsByModel[input.model] = (callsByModel[input.model] ?? 0) + 1;
    upstreamSignals.push(init.signal);
    // 拆题与覆盖判断：非流式 JSON，供编排继续。
    if (input.model === "zhida-fast-1p5") {
      const prompt = input.messages[0]?.content ?? "";
      const content = prompt.includes("拆题员") ? JSON.stringify(PLAN_JSON) : JSON.stringify(COVERAGE_JSON);
      return new Response(JSON.stringify({ model: input.model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(input.model, "zhida-agent");
    assert.equal(input.stream, true);
    const question = /研究问题：([^\n]+)/.exec(input.messages[0]?.content ?? "")?.[1] ?? input.messages[0]?.content ?? "";
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
  // 普通 JSON 客户端仍收到完整结果；编排产出计划、覆盖判断与报告。
  modelCalls = 0;
  upstreamSignals = [];
  const json = await post("normal", { accept: "application/json" });
  assert.equal(json.status, 200);
  const complete = await json.json() as { data: { answer: { content: string; material: { sources: unknown[] } }; status: string; sourceCount: number; plan: { questions: unknown[] } | null; analysis: { answers: unknown[] } | null; usage: { inputTokens: number; modelRequests: number; searchRequests: number } } };
  assert.equal(complete.data.answer.content, "第一段中文。");
  assert.equal(complete.data.status, "completed");
  assert.equal(complete.data.sourceCount, 0);
  // 编排必须产出计划与覆盖判断，报告与资料随答案返回。
  assert.equal(complete.data.plan?.questions.length, 3);
  assert.equal(complete.data.analysis?.answers.length, 3);
  assert.equal(complete.data.answer.material.sources.length, 1);
  assert.equal(complete.data.usage.inputTokens, 7);
  // 记账口径：拆题 + 覆盖(1 轮) + 成稿 = 3 次模型调用；首轮 3 个子问题各 1 次检索。
  assert.equal(callsByModel["zhida-agent"], 1);
  assert.equal(complete.data.usage.modelRequests, 3);
  assert.equal(complete.data.usage.searchRequests, 3);

  // 上游尚未完成时，浏览器必须已经收到拆题、覆盖、资料与第一个正文片段。
  const response = await post("gated");
  assert.match(response.headers.get("content-type")!, /text\/event-stream/);
  const stream = reader(response);
  const take = async () => ResearchProEvent.parse(JSON.parse((await stream.read()).value!.data));
  const started = await take();
  assert.equal(started.type, "started");
  const plan = await take();
  assert.equal(plan.type, "plan");
  if (plan.type === "plan") assert.equal(plan.plan.questions.length, 3);
  const coverage = await take();
  assert.equal(coverage.type, "coverage");
  if (coverage.type === "coverage") assert.equal(coverage.analysis.answers.length, 3);
  const material = await take();
  assert.equal(material.type, "material");
  if (material.type === "material") assert.equal(material.material.sources.length, 1);
  const first = await take();
  assert.deepEqual(first, { type: "answer_delta", text: "第一段中文。" });
  assert(finishUpstream);
  finishUpstream();
  const second = await take();
  assert.deepEqual(second, { type: "answer_delta", text: "第二段。" });
  const completed = await take();
  assert.equal(completed.type, "completed");
  if (completed.type === "completed") assert.equal(completed.detail.answer?.content, "第一段中文。第二段。");
  assert.equal((await stream.read()).done, true);
  stream.releaseLock();

  for (const question of ["truncated", "failure", "empty"]) {
    const received = await events(await post(question));
    assert.equal(received.at(-1)?.type, "failed", question);
    assert(!received.some((event) => event.type === "completed"), question);
  }

  timeoutMs = 300;
  upstreamSignals = [];
  const timedOut = await events(await post("timeout"));
  assert(upstreamSignals.length > 0 && upstreamSignals.every((signal) => signal?.aborted), "路由超时必须中止上游");
  assert(timedOut.at(-1)?.type === "failed");
  assert.equal((timedOut.at(-1) as Extract<ResearchProEvent, { type: "failed" }>).error.code, "TIMEOUT");
  timeoutMs = 5_000;

  upstreamSignals = [];
  const disconnectStream = reader(await post("disconnect"));
  await disconnectStream.read();
  await disconnectStream.read();
  await disconnectStream.cancel();
  await delay(100);
  assert(upstreamSignals.length > 0 && upstreamSignals.every((signal) => signal?.aborted), "浏览器停止必须中止上游");

  const beforeRejected = modelCalls;
  assert.equal((await post("normal", { anonymous: true })).status, 401);
  const rejected = await (await post("normal", { tier: "ultra" })).json() as { code?: string };
  assert.equal(rejected.code, "RESEARCH_TIER_UNAVAILABLE");
  assert.equal((await post("normal", { questionOverride: "x".repeat(2001) })).status, 400);
  assert.equal(modelCalls, beforeRejected, "拒绝请求不能消耗上游额度");
  const list = await (await fetch(base)).json() as { data: { items: unknown[] } };
  assert.deepEqual(list.data.items, []);
  console.log(JSON.stringify({ ok: true, checks: "research-pro-route: plan, coverage, incremental, utf8, failure, timeout, disconnect, auth, tier, input" }));
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
