import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isProductError } from "../platform/zhihu/errors.ts";
import { createRuntime } from "../application/runtime.ts";

loadLocalEnv();

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error("用法: node src/cli/research-brief.ts <研究问题>");
  process.exit(1);
}

try {
  const runtime = createRuntime();
  const brief = await runtime.researchBrief.execute({
    question,
    includeGlobal: true,
    includeHot: false,
  });
  console.log(JSON.stringify(brief, null, 2));
} catch (error) {
  if (isProductError(error)) {
    console.error(JSON.stringify({
      code: error.code,
      message: error.message,
      detail: error.detail,
    }, null, 2));
    process.exit(1);
  }
  throw error;
}

function loadLocalEnv(): void {
  const path = resolve(process.cwd(), ".env");
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Local credentials are optional for fixture verification.
  }
}
