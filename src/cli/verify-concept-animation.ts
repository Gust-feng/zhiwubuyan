/**
 * 概念动画离线验证：用假模型驱动应用命令，确认抽取、安全加固、校验与一次修正的边界，
 * 以及产物符合共享契约。全程不触网、不消耗额度；模型真实产出质量不在此范围。
 *
 * 运行：pnpm verify:concept-animation
 */
import { createConceptAnimationCommand, extractHtmlDocument, hardenDocument, validateDocument } from "../application/concept-animation.ts";
import { buildConceptAnimationPrompt } from "../application/concept-animation-prompt.ts";
import { createAnimationMaterialProvider } from "../application/animation-material.ts";
import { createMemorySharedCache } from "../application/shared-cache.ts";
import { createFileAnimationStore } from "../storage/animation-store.ts";
import { ConceptAnimationResult as ResultSchema } from "../contracts/concept-animation.ts";
import { ProductError } from "../platform/zhihu/errors.ts";
import { chatCompletionsUrl } from "../platform/model/chat.ts";
import type { ChatCompletion, ChatModelClient } from "../platform/model/chat.ts";
import type { ContentGateway, ContentSource, SearchResult } from "../platform/zhihu/content.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

function makeModel(script: Array<string | (() => never)>): { client: ChatModelClient; calls: () => number } {
  let index = 0;
  const client: ChatModelClient = {
    modelId: "fake-model",
    async complete(): Promise<ChatCompletion> {
      const step = script[Math.min(index, script.length - 1)];
      index += 1;
      if (typeof step === "function") return step();
      return {
        content: step ?? "",
        modelId: "fake-model",
        finishReason: "stop",
        usage: { inputTokens: null, outputTokens: null },
      };
    },
  };
  return { client, calls: () => index };
}

function commandFor(script: Array<string | (() => never)>, maxRepairs?: number) {
  const fake = makeModel(script);
  const command = createConceptAnimationCommand({ model: fake.client, providerLabel: "fake", ...(maxRepairs === undefined ? {} : { maxRepairs }) });
  return { command, calls: fake.calls };
}

const VALID_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>冒泡排序</title>
<style>@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}</style>
</head><body><main><h1>冒泡排序</h1><p style="animation:fade 1s ease-out">相邻比较，大的往后走</p></main>
<script>const steps = [
  { narration: "开始" }, { narration: "比较" }, { narration: "交换" }
];</script>
</body></html>`;

// —— 正常路径：带围栏的返回被抽取，产物自包含且通过校验 ——
{
  const { command } = commandFor([`好的，这是动画：\n\n\`\`\`html\n${VALID_HTML}\n\`\`\``]);
  const result = await command.generate({ topic: "冒泡排序" });
  check(result.status === "completed", "合法 HTML 应生成成功");
  check(!result.html.includes("```"), "产物不应残留 Markdown 围栏");
  check(result.html.startsWith("<!DOCTYPE html>"), "产物应以文档声明开头");
  check(result.title === "冒泡排序", "标题应从 <title> 提取");
  check(result.repairs === 0, "首轮通过时不应有重生成");
  check(result.error === null, "成功时不应带错误");
  check(ResultSchema.safeParse(result).success, "成功结果应符合共享契约");
}

// —— 安全加固：外链脚本/样式/框架/图片被移除，内联动画保留 ——
{
  const dirty = VALID_HTML.replace(
    "<main>",
    `<main><script src="https://cdn.example.com/gsap.js"></script>` +
      `<link rel="stylesheet" href="https://cdn.example.com/x.css">` +
      `<iframe src="https://ads.example.com"></iframe>` +
      `<img src="https://cdn.example.com/pic.png">`,
  );
  const { command } = commandFor([dirty]);
  const result = await command.generate({ topic: "冒泡排序" });
  check(result.status === "completed", "移除外链后仍应生成成功");
  check(result.strippedReferences === 4, `应移除 4 处外部引用，实际 ${result.strippedReferences}`);
  check(!result.html.includes("cdn.example.com"), "产物不应残留外链域名");
  check(!result.html.includes("ads.example.com"), "iframe 应被移除");
  check(result.html.includes("const steps"), "内联动画脚本必须保留");
}

// —— 外链判定只看标签属性：脚本里的 URL 字符串不算外链 ——
{
  const withStringUrl = VALID_HTML.replace(
    "const steps =",
    'const docs = "见 https://example.com/guide"; const steps =',
  );
  const { command } = commandFor([withStringUrl]);
  const result = await command.generate({ topic: "冒泡排序" });
  check(result.status === "completed", "脚本字符串里的 URL 不应被判为外链");
  check(result.strippedReferences === 0, "不应误删脚本内容");
}

// —— 一次修正：首轮没有 HTML，次轮给对 ——
{
  const { command, calls } = commandFor(["抱歉，我无法完成。", VALID_HTML]);
  const result = await command.generate({ topic: "冒泡排序" });
  check(result.status === "completed", "修正后应生成成功");
  check(result.repairs === 1, "应记录一次重生成");
  check(calls() === 2, "应恰好调用模型两次");
}

// —— 持续不合格：如实失败，不伪造产物 ——
{
  const { command, calls } = commandFor(["没有 HTML", "还是没有 HTML"]);
  const result = await command.generate({ topic: "冒泡排序" });
  check(result.status === "failed", "始终没有 HTML 时应失败");
  check(result.error?.code === "MODEL_OUTPUT_INVALID", "错误码应为 MODEL_OUTPUT_INVALID");
  check(result.html === "", "失败时不应返回产物");
  check(calls() === 2, "重生成次数应为默认上限一次");
}

// —— 关闭重生成：只调用一次并失败 ——
{
  const { command, calls } = commandFor(["没有 HTML"], 0);
  const result = await command.generate({ topic: "冒泡排序" });
  check(result.status === "failed" && calls() === 1, "maxRepairs=0 时应只调用一次且失败");
}

// —— 空主题：契约层拒绝，不打模型 ——
{
  const { command, calls } = commandFor([VALID_HTML]);
  const result = await command.generate({ topic: "   " });
  check(result.status === "failed" && result.error?.code === "INVALID_INPUT", "空主题应报 INVALID_INPUT");
  check(calls() === 0, "非法输入不应调用模型");
}

// —— 上游错误：如实映射为 UPSTREAM_ERROR ——
{
  const { command } = commandFor([
    () => {
      throw new ProductError("UPSTREAM_ERROR", "模型服务返回错误。");
    },
  ]);
  const result = await command.generate({ topic: "冒泡排序" });
  check(result.status === "failed" && result.error?.code === "UPSTREAM_ERROR", "上游错误应映射为 UPSTREAM_ERROR");
  check(ResultSchema.safeParse(result).success, "失败结果也应符合共享契约");
}

// —— 纯函数：抽取与校验的单元边界 ——
{
  check(extractHtmlDocument("前后都是废话") === null, "没有文档时应返回 null");
  check(extractHtmlDocument(VALID_HTML)?.startsWith("<!DOCTYPE html>") === true, "纯文档应被识别");
  const hardened = hardenDocument('<a href="javascript:alert(1)">x</a>');
  check(hardened.stripped === 1 && !hardened.html.includes("javascript:"), "javascript: 伪协议应被清空");
  check(validateDocument("<html><body><p>静态</p></body></html>").passed === false, "无动画的静态页不应通过校验");
}

// —— 提示词骨架：填好后必须能通过我们自己的校验 ——
{
  const prompt = buildConceptAnimationPrompt({ topic: "测试主题" });
  const start = prompt.system.indexOf("<<<SKELETON_START>>>");
  const end = prompt.system.indexOf("<<<SKELETON_END>>>");
  check(start >= 0 && end > start, "系统提示词应包含骨架");
  const skeleton = prompt.system.slice(start + "<<<SKELETON_START>>>".length, end).trim();
  const filled = skeleton
    .replace(/\{\{[^}]*\}\}/g, "填充内容")
    // 骨架示例只有一步，补两步以满足"至少三个分镜"的校验口径。
    .replace("const steps = [", "const steps = [{ narration: 'a', async enter() {} }, { narration: 'b', async enter() {} },");
  const result = validateDocument(filled);
  check(result.passed, `骨架填入内容后应通过校验：${result.issues.join("；")}`);
  check(/\{\{/.test(skeleton), "骨架里应保留待替换的占位符供模型填充");
}

// —— 新增校验：占位符未替换、分镜过少，都应判不合格 ——
{
  const withPlaceholder = validateDocument("<html><body><main>{{标题}}</main><script>const steps=[{narration:'a'},{narration:'b'},{narration:'c'}];</script></body></html>");
  check(!withPlaceholder.passed && withPlaceholder.issues.some((i) => i.includes("占位符")), "未替换占位符应判不合格");

  const tooFewSteps = validateDocument("<html><body><main>x</main><script>const steps=[{narration:'a'}];</script></body></html>");
  check(!tooFewSteps.passed && tooFewSteps.issues.some((i) => i.includes("分镜过少")), "分镜过少应判不合格");
}

// —— 端点归一：Gemini 根域名补全 OpenAI 兼容路径，已含路径则原样 ——
{
  check(
    chatCompletionsUrl("https://generativelanguage.googleapis.com") === "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "Gemini 根域名应补全 /v1beta/openai 路径",
  );
  check(
    chatCompletionsUrl("https://api.deepseek.com/v1") === "https://api.deepseek.com/v1/chat/completions",
    "普通基址应补 /chat/completions",
  );
  check(
    chatCompletionsUrl("https://x.example/v1/chat/completions") === "https://x.example/v1/chat/completions",
    "已含完整路径应原样保留",
  );
}

// —— 取料：取到资料时注入提示词并回填 references ——
{
  const fake = makeSearchGateway([source("s1", "熵是什么", "https://www.zhihu.com/a/1", "熵是混乱度的度量"), source("s2", "熵增", "https://www.zhihu.com/a/2", "孤立系统熵不减")]);
  const material = createAnimationMaterialProvider({ content: fake.gateway, cache: createMemorySharedCache() });
  const command = createConceptAnimationCommand({ model: makeModel([VALID_HTML]).client, providerLabel: "fake", material });
  const result = await command.generate({ topic: "熵增定律" });
  check(result.status === "completed", "取到资料时应正常生成");
  check(result.materialStatus === "used", "取到资料时 materialStatus 应为 used");
  check(result.references.length === 2, `应注入 2 条参考资料，实际 ${result.references.length}`);
  check(result.references[0]?.url.startsWith("https://"), "参考资料应带真实原文链接");
  check(fake.calls() === 1, "同一次生成只应检索一次");
}

// —— 取料降级：额度耗尽/限流时报 unavailable，但生成照常 ——
{
  const fake = makeSearchGateway([], new ProductError("QUOTA_EXHAUSTED", "额度耗尽"));
  const material = createAnimationMaterialProvider({ content: fake.gateway, cache: createMemorySharedCache() });
  const command = createConceptAnimationCommand({ model: makeModel([VALID_HTML]).client, providerLabel: "fake", material });
  const result = await command.generate({ topic: "熵增定律" });
  check(result.status === "completed", "取料失败不应阻断生成");
  check(result.materialStatus === "unavailable", "取料失败时 materialStatus 应为 unavailable");
  check(result.references.length === 0, "取料失败时不应有参考资料");
}

// —— 关闭取料：useMaterial=false 时不检索、状态为 skipped ——
{
  const fake = makeSearchGateway([]);
  const material = createAnimationMaterialProvider({ content: fake.gateway, cache: createMemorySharedCache() });
  const command = createConceptAnimationCommand({ model: makeModel([VALID_HTML]).client, providerLabel: "fake", material });
  const result = await command.generate({ topic: "熵增定律", useMaterial: false });
  check(result.materialStatus === "skipped", "关闭取料时 materialStatus 应为 skipped");
  check(fake.calls() === 0, "关闭取料时不应检索");
}

// —— 取料缓存与单飞：同主题并发只检索一次 ——
{
  const fake = makeSearchGateway([source("s1", "标题", "https://www.zhihu.com/a/1", "摘要")]);
  const cache = createMemorySharedCache();
  const material = createAnimationMaterialProvider({ content: fake.gateway, cache });
  const [first, second] = await Promise.all([material.load("二分查找"), material.load("二分查找")]);
  check(fake.calls() === 1, `同主题并发应只检索一次，实际 ${fake.calls()}`);
  check(first.references.length === 1 && second.references.length === 1, "并发两路都应拿到资料");
  await material.load("二分查找");
  check(fake.calls() === 1, "缓存命中时不应再检索");
}

// —— 存储：文件实现按 scope 隔离，读回与删除正确 ——
{
  const dir = mkdtempSync(join(tmpdir(), "imagery-"));
  try {
    const store = createFileAnimationStore(dir);
    const record = recordFor("id-1", "熵增定律");
    await store.save("user-a", record);
    await store.save("user-b", recordFor("id-2", "二分查找"));
    const listA = await store.list("user-a", { limit: 20, offset: 0 });
    check(listA.total === 1 && listA.items[0]?.id === "id-1", "列表应按 scope 隔离");
    check(!("html" in (listA.items[0] ?? {})), "列表项不应带 html");
    const got = await store.get("user-a", "id-1");
    check(got?.html === record.html, "应能按 id 读回完整记录含 html");
    check((await store.get("user-b", "id-1")) === undefined, "跨 scope 不应读到别人的记录");
    check((await store.remove("user-a", "id-1")) === true, "删除已存在的记录应返回 true");
    check((await store.list("user-a", { limit: 20, offset: 0 })).total === 0, "删除后列表应为空");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(`概念动画验证失败 ${failures.length} 项：`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("概念动画验证通过：抽取、加固、校验、重生成、取料、存储与错误映射均符合预期。");

// ── 测试替身 ──

/** 假检索网关：可注入一次性错误，并统计调用次数，用于验证取料降级与缓存/单飞。 */
function makeSearchGateway(items: ContentSource[], failWith?: ProductError): { gateway: ContentGateway; calls: () => number } {
  let calls = 0;
  const gateway = {
    async searchZhihu(): Promise<SearchResult> {
      calls += 1;
      if (failWith !== undefined) throw failWith;
      return { kind: "zhihu_search", fetchedAt: new Date().toISOString(), items };
    },
    async searchGlobal(): Promise<SearchResult> {
      return { kind: "global_search", fetchedAt: new Date().toISOString(), items: [] };
    },
    async listHotContent(): Promise<SearchResult> {
      return { kind: "hot_list", fetchedAt: new Date().toISOString(), items: [] };
    },
    async listQuestionAnswers(): Promise<SearchResult> {
      return { kind: "question_answers", fetchedAt: new Date().toISOString(), items: [] };
    },
  };
  return { gateway, calls: () => calls };
}

function source(id: string, title: string, url: string, summary: string): ContentSource {
  return { id, kind: "zhihu_search", title, url, summary, fetchedAt: new Date().toISOString() };
}

function recordFor(id: string, topic: string) {
  return {
    id,
    topic,
    title: topic,
    instruction: null,
    createdAt: new Date().toISOString(),
    html: VALID_HTML,
    model: { provider: "fake", modelId: "fake-model" },
    references: [],
    materialStatus: "skipped" as const,
  };
}
