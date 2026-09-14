import {
  ConceptAnimationRequest,
  type ConceptAnimationErrorCode,
  type ConceptAnimationModelInfo,
  type ConceptAnimationResult,
  type ConceptAnimationValidation,
} from "../contracts/concept-animation.ts";
import { isProductError, ProductError } from "../platform/zhihu/errors.ts";
import type { ChatModelClient } from "../platform/model/chat.ts";
import type { ConceptAnimationTuning } from "../platform/model/config.ts";
import type { AnimationMaterial, AnimationMaterialProvider } from "./animation-material.ts";
import { buildConceptAnimationPrompt } from "./concept-animation-prompt.ts";

/**
 * 概念动画应用命令：把一次生成收敛成一个可展示的结果。
 *
 * 模型产出的是自由文本，这里负责三件事：
 * 1. 从文本里取出 HTML 文档（容忍带 Markdown 围栏的返回）；
 * 2. 安全加固——移除任何外链脚本/样式/框架，保证产物自包含；
 * 3. 校验结构与"是否真有动画"，未过则按问题清单让模型整份重做一次。
 *
 * 只做判断与清洗，不解析动画内部结构：动效的可读性由提示词约束，
 * 这里不维护第二套分镜模型。
 */

export type ConceptAnimationCommandOptions = {
  model: ChatModelClient;
  /** 展示用的模型来源标签；不影响调用。 */
  providerLabel?: string;
  tuning?: ConceptAnimationTuning;
  /** 校验未过后的整份重生成次数；默认一次，设 0 可关闭。 */
  maxRepairs?: number;
  /** 中止信号：超时由调用方组合后传入。 */
  signal?: AbortSignal;
  /**
   * 生成前取一批知乎检索摘要作为参考资料；不传则本次不接入外部资料。
   * 取料与缓存都在命令外，命令本身保持纯净、可离线测试。
   */
  material?: AnimationMaterialProvider;
};

export type ConceptAnimationCommand = {
  generate(request: unknown): Promise<ConceptAnimationResult>;
};

const DEFAULT_MAX_REPAIRS = 1;

export function createConceptAnimationCommand(options: ConceptAnimationCommandOptions): ConceptAnimationCommand {
  const { model } = options;
  const providerLabel = options.providerLabel ?? "openai-compatible";
  const tuning = options.tuning ?? {};
  const maxRepairs = Math.max(0, options.maxRepairs ?? DEFAULT_MAX_REPAIRS);
  const modelInfo: ConceptAnimationModelInfo = { provider: providerLabel, modelId: model.modelId };

  const failure = (
    code: ConceptAnimationErrorCode,
    message: string,
    extra?: { validation?: ConceptAnimationValidation; repairs?: number; material?: AnimationMaterial },
  ): ConceptAnimationResult => ({
    status: "failed",
    html: "",
    title: "",
    model: modelInfo,
    validation: extra?.validation ?? { passed: false, issues: [message] },
    repairs: extra?.repairs ?? 0,
    strippedReferences: 0,
    references: extra?.material?.references ?? [],
    materialStatus: extra?.material?.status ?? "unavailable",
    error: { code, message },
  });

  return {
    async generate(rawRequest) {
      const parsed = ConceptAnimationRequest.safeParse(rawRequest);
      if (!parsed.success) {
        return failure("INVALID_INPUT", "概念动画请求不符合契约：topic 为 1–200 字，instruction 最多 2000 字。");
      }
      const { topic, instruction, useMaterial } = parsed.data;

      // 取料只在开启且注入了 provider 时发生；失败/空结果由 provider 降级为 unavailable。
      const material: AnimationMaterial = useMaterial && options.material !== undefined
        ? await options.material.load(topic)
        : { status: "skipped", references: [] };

      let repairs = 0;
      let lastIssues: string[] | undefined;

      for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
        const prompt = buildConceptAnimationPrompt({
          topic,
          instruction,
          repairIssues: lastIssues,
          references: material.references,
        });

        let content: string;
        try {
          const completion = await model.complete(
            [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            { temperature: tuning.temperature, maxTokens: tuning.maxTokens, signal: options.signal },
          );
          content = completion.content;
        } catch (error) {
          return failure(mapErrorCode(error), mapErrorMessage(error), { repairs, material });
        }

        const extracted = extractHtmlDocument(content);
        if (extracted === null) {
          lastIssues = ["没有返回可识别的 HTML 文档，只返回了文字说明"];
          if (attempt < maxRepairs) {
            repairs += 1;
            continue;
          }
          return failure("MODEL_OUTPUT_INVALID", "模型没有返回可用的 HTML 动画。", { repairs, material });
        }

        const hardened = hardenDocument(extracted);
        const validation = validateDocument(hardened.html);
        if (validation.passed) {
          return {
            status: "completed",
            html: hardened.html,
            title: readTitle(hardened.html) || topic,
            model: modelInfo,
            validation,
            repairs,
            strippedReferences: hardened.stripped,
            references: material.references,
            materialStatus: material.status,
            error: null,
          };
        }

        lastIssues = validation.issues;
        if (attempt < maxRepairs) {
          repairs += 1;
          continue;
        }
        return failure("MODEL_OUTPUT_INVALID", `生成的动画未通过校验：${validation.issues.join("；")}`, {
          validation,
          repairs,
          material,
        });
      }

      // 循环必定在内部返回；这里只为类型完备。
      return failure("INTERNAL_ERROR", "生成流程意外结束。", { repairs, material });
    },
  };
}

/** 从模型返回文本中取出 HTML 文档：优先代码围栏，其次整段文档。 */
export function extractHtmlDocument(raw: string): string | null {
  const fenced = /```(?:html)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced && fenced[1]) {
    const inner = firstDocument(fenced[1]);
    if (inner !== null) return inner;
  }
  return firstDocument(raw);
}

function firstDocument(text: string): string | null {
  const lower = text.toLowerCase();
  const doctype = lower.indexOf("<!doctype html");
  const htmlTag = lower.indexOf("<html");
  const start = doctype >= 0 ? doctype : htmlTag;
  if (start < 0) return null;
  const end = lower.lastIndexOf("</html>");
  const slice = end > start ? text.slice(start, end + "</html>".length) : text.slice(start);
  const trimmed = slice.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type HardenedDocument = { html: string; stripped: number };

/** 移除一切外部引用，保证产物离线自包含；返回被移除的引用数量。 */
export function hardenDocument(html: string): HardenedDocument {
  let output = html;
  let stripped = 0;

  const removals: RegExp[] = [
    // 外链脚本：整段删除；内联脚本（无 src）不受影响。
    /<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>\s*<\/script\s*>/gi,
    /<link\b[^>]*\/?>/gi,
    /<base\b[^>]*\/?>/gi,
    /<iframe\b[\s\S]*?<\/iframe\s*>|<iframe\b[^>]*\/?>/gi,
    /<object\b[\s\S]*?<\/object\s*>/gi,
    /<embed\b[^>]*\/?>/gi,
    /<img\b[^>]*\bsrc\s*=\s*(?:"https?:[^"]*"|'https?:[^']*'|https?:[^\s>]+)[^>]*\/?>/gi,
  ];
  for (const pattern of removals) {
    output = replaceCounting(output, pattern, "", () => {
      stripped += 1;
    });
  }
  // javascript: 伪协议：清空属性值而不是整段删除，避免破坏标签结构。
  output = replaceCounting(output, /\b(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '$1=""', () => {
    stripped += 1;
  });

  return { html: output, stripped };
}

/** 校验产物：结构、是否真有动画、是否仍然自包含，以及骨架是否被正确使用。 */
export function validateDocument(html: string): ConceptAnimationValidation {
  const issues: string[] = [];
  if (html.trim() === "") {
    return { passed: false, issues: ["内容为空"] };
  }
  const lower = html.toLowerCase();

  if (!lower.includes("<!doctype html") && !lower.includes("<html")) {
    issues.push("缺少 <!DOCTYPE html> 或 <html> 结构");
  }
  if (!lower.includes("<body") && !lower.includes("<main") && !lower.includes("<section")) {
    issues.push("缺少 <body> / <main> / <section> 结构");
  }
  if (!hasAnimation(lower)) {
    issues.push("没有检测到实际动画（需要内联脚本、Web Animations、被引用的 @keyframes 或 SVG animate）");
  }
  if (hasExternalReference(html)) {
    issues.push("仍然引用了外部资源，未做到自包含");
  }
  // 骨架约定以 steps 数组承载分镜；占位符未替换或步数过少，说明没有认真填充内容。
  if (/\{\{[^}]*\}\}/.test(html)) {
    issues.push("保留了骨架里的 {{...}} 占位符，没有替换成真实内容");
  }
  const stepCount = (html.match(/narration\s*:/g) ?? []).length;
  if (stepCount < 3) {
    issues.push(`分镜过少（检测到 ${stepCount} 步），讲解至少需要 3 个分镜`);
  }

  return { passed: issues.length === 0, issues };
}

function hasAnimation(lower: string): boolean {
  const inlineScript = /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/i.test(lower);
  const webAnimations = lower.includes(".animate(");
  const keyframesUsed = lower.includes("@keyframes") && /animation\s*:[^;}]+/.test(lower);
  const svgAnimate = /<animate\b|<animatetransform\b/.test(lower);
  return inlineScript || webAnimations || keyframesUsed || svgAnimate;
}

function hasExternalReference(html: string): boolean {
  // 只看标签属性，避免把脚本里的字符串或注释误判成外链。
  return /<[^>]+(?:src|href)\s*=\s*["'](?:\/\/|https?:)/i.test(html);
}

function readTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1]?.trim() ?? "";
}

function mapErrorCode(error: unknown): ConceptAnimationErrorCode {
  if (!isProductError(error)) return "INTERNAL_ERROR";
  switch (error.code) {
    case "RATE_LIMITED":
    case "QUOTA_EXHAUSTED":
      return "RATE_LIMITED";
    case "UPSTREAM_ERROR":
    case "PROTOCOL_ERROR":
      return "UPSTREAM_ERROR";
    case "ABORTED":
      return "TIMEOUT";
    default:
      return "INTERNAL_ERROR";
  }
}

function mapErrorMessage(error: unknown): string {
  if (error instanceof ProductError) {
    if (error.code === "ABORTED") return "生成超时，请再试一次。";
    if (error.code === "RATE_LIMITED") return "模型服务请求过于密集，稍后再试。";
    // 带上游返回的原因，便于定位（如 503 高负载、400 参数问题），不淹没在笼统文案里。
    return error.detail
      ? `模型服务暂时不可用，请再试一次。（${error.detail}）`
      : "模型服务暂时不可用，请再试一次。";
  }
  return "生成过程中出现未知问题。";
}

function replaceCounting(text: string, pattern: RegExp, replacement: string, onEach: () => void): string {
  return text.replace(pattern, (match, ...args) => {
    onEach();
    const groups = args.slice(0, -2) as unknown[];
    return replacement.replace(/\$(\d)/g, (_, digit: string) => String(groups[Number(digit) - 1] ?? ""));
  });
}
