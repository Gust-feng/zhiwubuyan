/**
 * 生成模式探针：对比 plain generate 与 structuredOutput 两种模式的上游请求数。
 * 判定产品阶段调用是否需要自行解析 JSON（避免框架自动回退造成隐式第二次调用）。
 */
import http from "node:http";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";

const apiKey = process.env.MODEL_API_KEY ?? "";
const modelId = process.env.MODEL_PROFILE_MODEL_ID ?? "deepseek-flash";
if (!apiKey) {
  console.error("缺少 MODEL_API_KEY。");
  process.exit(2);
}

let upstreamCalls = 0;
let lastRequestBody = null;

const proxy = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  if (body.length > 0) {
    try {
      const parsed = JSON.parse(body.toString("utf8"));
      lastRequestBody = { hasResponseFormat: "response_format" in parsed, tools: "tools" in parsed };
    } catch {
      lastRequestBody = { parse: false };
    }
  }
  upstreamCalls += 1;
  const upstream = await fetch(new URL(req.url ?? "/", "https://api.deepseek.com"), {
    method: req.method,
    headers: { ...filterHeaders(req.headers), host: "api.deepseek.com" },
    body: body.length > 0 ? body : undefined,
  });
  const text = await upstream.text();
  res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
  res.end(text);
});

function filterHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (["host", "connection", "content-length"].includes(key)) continue;
    out[key] = value;
  }
  return out;
}

await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const address = proxy.address();

const agent = new Agent({
  name: "probe-agent",
  instructions: "只输出被要求的 JSON。",
  model: {
    id: `openai-compatible/${modelId}`,
    url: `http://127.0.0.1:${address.port}`,
    apiKey,
  },
  modelSettings: { maxRetries: 0 },
});

const results = {};

// 模式 1：plain generate + 自行 JSON 指令
try {
  upstreamCalls = 0;
  const response = await agent.generate(
    [
      { role: "user", content: '输出 JSON：{"summary":string,"score":number}，summary 不超过 20 字，score 为 1-5。只输出 JSON，不要其他文字。' },
    ],
    { modelSettings: { maxRetries: 0 } },
  );
  results.plain = {
    upstreamCalls,
    textStartsWithBrace: (response.text ?? "").trimStart().startsWith("{"),
    requestShape: lastRequestBody,
    usage: response.usage ? { input: response.usage.inputTokens ?? null, output: response.usage.outputTokens ?? null } : null,
  };
} catch (error) {
  results.plain = { upstreamCalls, error: String(error?.message ?? error).slice(0, 200) };
}

// 模式 2：structuredOutput inline
try {
  upstreamCalls = 0;
  const schema = z.object({ summary: z.string(), score: z.number() });
  const response = await agent.generate(
    [{ role: "user", content: '对「本地研究工作台」给出一句 summary（不超过 20 字）和 1-5 的 score。' }],
    { structuredOutput: { schema, jsonPromptInjection: "inline" }, modelSettings: { maxRetries: 0 } },
  );
  results.structuredInline = {
    upstreamCalls,
    objectOk: response.object != null && typeof response.object.summary === "string",
    requestShape: lastRequestBody,
  };
} catch (error) {
  results.structuredInline = { upstreamCalls, error: String(error?.message ?? error).slice(0, 200) };
}

console.log(JSON.stringify(results, null, 2));
proxy.close();
