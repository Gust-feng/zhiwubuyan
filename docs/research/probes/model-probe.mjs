/**
 * 模型接入探针：通过本地计数代理访问真实 OpenAI 兼容模型服务。
 * 只回答三类事实：一次 generate 的上游请求数、结构化输出是否解析、usage 是否返回。
 * 不用于产品；凭证经环境变量传入，不写入日志。
 */
import http from "node:http";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";

const targetBase = process.env.MODEL_API_BASE_URL ?? "https://api.deepseek.com/v1";
const apiKey = process.env.MODEL_API_KEY ?? "";
const modelId = process.env.MODEL_PROFILE_MODEL_ID ?? "deepseek-flash";
if (!apiKey) {
  console.error("缺少 MODEL_API_KEY，无法进行真实模型验证。");
  process.exit(2);
}

const target = new URL(targetBase);
let upstreamCalls = 0;

const proxy = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  upstreamCalls += 1;
  const upstream = await fetch(new URL(req.url ?? "/", target), {
    method: req.method,
    headers: {
      ...filterHeaders(req.headers),
      host: target.host,
    },
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
  instructions: "你是测试代理，只输出被要求的 JSON。",
  model: {
    id: `openai-compatible/${modelId}`,
    // provider 会在 base 后自动追加 /chat/completions
    url: `http://127.0.0.1:${address.port}`,
    apiKey,
  },
  modelSettings: { maxRetries: 0 },
});

const schema = z.object({
  summary: z.string(),
  score: z.number(),
});

const prompt = [
  { role: "system", content: "只输出符合 schema 的 JSON。" },
  { role: "user", content: "对「本地研究工作台」给出一句 summary（不超过 20 字）和 1-5 的 score。" },
];

try {
  const response = await agent.generate(prompt, {
    structuredOutput: { schema, jsonPromptInjection: "inline" },
    modelSettings: { maxRetries: 0 },
  });
  const usage = response.usage;
  console.log(JSON.stringify({
    ok: true,
    object: response.object,
    upstreamCalls,
    usage: usage
      ? { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, totalTokens: usage.totalTokens ?? null }
      : null,
    finishReason: response.finishReason ?? null,
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    upstreamCalls,
    errorName: error?.name ?? "unknown",
    message: String(error?.message ?? error).slice(0, 500),
  }, null, 2));
  process.exitCode = 1;
} finally {
  proxy.close();
}
