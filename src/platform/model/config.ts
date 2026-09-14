import type { ChatModelConfig } from "./chat.ts";

/**
 * 从环境变量解析概念动画所用的模型配置（BYOK）。
 *
 * 优先读取 ANIMATION_MODEL_* 这一组；未配置时回退到深度研究的 MODEL_* 一组，
 * 便于本地只有一套模型时直接复用。两类凭证都不写出、不落盘，只经进程内存传递。
 */

export type ConceptAnimationModelConfig = ChatModelConfig & { providerLabel: string };

export type EnvLike = Record<string, string | undefined>;

export function readConceptAnimationModel(env: EnvLike): ConceptAnimationModelConfig | null {
  const apiKey = pick(env.ANIMATION_MODEL_API_KEY, env.MODEL_API_KEY);
  const baseUrl = pick(env.ANIMATION_MODEL_BASE_URL, env.MODEL_API_BASE_URL);
  const modelId = pick(env.ANIMATION_MODEL_ID, env.MODEL_PROFILE_MODEL_ID);
  if (!apiKey || !baseUrl || !modelId) return null;
  return {
    baseUrl,
    modelId,
    apiKey,
    providerLabel: pick(env.ANIMATION_MODEL_PROVIDER, env.MODEL_PROVIDER) ?? "openai-compatible",
  };
}

/** 概念动画的可选生成参数，全部有默认值，缺省不影响生成。 */
export type ConceptAnimationTuning = {
  temperature?: number;
  maxTokens?: number;
};

export function readConceptAnimationTuning(env: EnvLike): ConceptAnimationTuning {
  return {
    temperature: readFiniteNumber(env.ANIMATION_MODEL_TEMPERATURE),
    maxTokens: readPositiveInt(env.ANIMATION_MODEL_MAX_TOKENS),
  };
}

function pick(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function readFiniteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readPositiveInt(value: string | undefined): number | undefined {
  const parsed = readFiniteNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
