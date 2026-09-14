import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createConceptAnimationCommand } from "../application/concept-animation.ts";
import { createChatModelClient } from "../platform/model/chat.ts";
import { readConceptAnimationModel, readConceptAnimationTuning } from "../platform/model/config.ts";

/**
 * 概念动画实时生成入口：用当前环境里配置的模型，把一个概念生成成单文件 HTML 动画。
 *
 * 用法：pnpm concept-animation "冒泡排序" [--instruction "多用对比"] [--json]
 * 产物写到 output/concept-animation/<slug>.html（output 不入版本库），
 * 直接用浏览器打开即可查看。这是本机开发/验收入口，不是产品能力本身。
 */

loadLocalEnv();

const { topic, instruction, asJson } = parseArgs(process.argv.slice(2));
if (!topic) {
  console.error('用法：pnpm concept-animation "要讲解的概念" [--instruction "额外要求"] [--json]');
  process.exit(1);
}

const model = readConceptAnimationModel(process.env);
if (model === null) {
  console.error(
    [
      "尚未配置概念动画所用的模型。请在 .env 中填写下面一组（或复用深度研究的 MODEL_*）：",
      "  ANIMATION_MODEL_API_KEY=",
      "  ANIMATION_MODEL_BASE_URL=",
      "  ANIMATION_MODEL_ID=",
      "  ANIMATION_MODEL_PROVIDER=（可选，默认 openai-compatible）",
    ].join("\n"),
  );
  process.exit(1);
}

const timeoutMs = readTimeout(process.env.ANIMATION_MODEL_TIMEOUT_MS);
const command = createConceptAnimationCommand({
  model: createChatModelClient(model),
  providerLabel: model.providerLabel,
  tuning: readConceptAnimationTuning(process.env),
  signal: Number.isFinite(timeoutMs) ? AbortSignal.timeout(timeoutMs) : undefined,
});

const startedAt = Date.now();
const result = await command.generate({ topic, instruction });
const elapsedMs = Date.now() - startedAt;

let filePath: string | null = null;
if (result.status === "completed") {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const dir = join(projectRoot, "output", "concept-animation");
  mkdirSync(dir, { recursive: true });
  filePath = join(dir, `${slugify(topic)}.html`);
  writeFileSync(filePath, result.html, "utf8");
}

const summary = {
  status: result.status,
  topic,
  title: result.title,
  file: filePath,
  bytes: result.html.length,
  model: result.model,
  repairs: result.repairs,
  strippedReferences: result.strippedReferences,
  validation: result.validation,
  error: result.error,
  elapsedMs,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else if (result.status === "completed") {
  console.log(`已生成：${filePath}`);
  console.log(`标题：${result.title}｜大小：${result.html.length} 字节｜重生成：${result.repairs} 次｜耗时：${(elapsedMs / 1000).toFixed(1)}s`);
  if (result.strippedReferences > 0) {
    console.log(`提示：已移除 ${result.strippedReferences} 处外部引用，产物已强制自包含。`);
  }
  console.log("用浏览器打开上面的文件即可查看动画。");
} else {
  console.error(`生成失败（${result.error?.code}）：${result.error?.message}`);
}
// 用 exitCode 而非 process.exit()：后者在仍有活跃连接时退出会触发 libuv 断言崩溃（Windows）。
process.exitCode = result.status === "completed" ? 0 : 1;

function parseArgs(argv: string[]): { topic: string; instruction?: string; asJson: boolean } {
  const positional: string[] = [];
  let instruction: string | undefined;
  let asJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--instruction" || arg === "-i") {
      instruction = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      asJson = true;
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }
  return { topic: positional.join(" ").trim(), instruction, asJson };
}

function slugify(topic: string): string {
  const base = topic
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const hash = createHash("sha1").update(topic).digest("hex").slice(0, 8);
  return `${base || "concept"}-${hash}`;
}

function readTimeout(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}

/** 与 pnpm dev:api 一致：本地 .env 只补空缺，不覆盖已有环境变量。 */
function loadLocalEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(index + 1).trim();
  }
}
