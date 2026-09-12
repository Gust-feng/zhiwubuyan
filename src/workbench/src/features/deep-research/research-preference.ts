import { readLocalPreference, writeLocalPreference } from "../../shell/local-preferences";

/**
 * 研究偏好的本地默认值：只决定研究入口的初始选择，单次研究仍可在入口覆盖。
 * Ultra 仅在桌面端可用，网页端选到 Ultra 时由提交后的后端响应给出锁定提示。
 */
export type ResearchDefaultTier = "pro" | "ultra";

const RESEARCH_TIER_STORAGE_KEY = "research.default-tier";
const RESEARCH_WEB_SUPPLEMENT_STORAGE_KEY = "research.default-web-supplement";

export function getDefaultResearchTier(): ResearchDefaultTier {
  return readLocalPreference(RESEARCH_TIER_STORAGE_KEY) === "ultra" ? "ultra" : "pro";
}

export function saveDefaultResearchTier(tier: ResearchDefaultTier): void {
  writeLocalPreference(RESEARCH_TIER_STORAGE_KEY, tier);
}

export function getDefaultResearchWebSupplement(): boolean {
  return readLocalPreference(RESEARCH_WEB_SUPPLEMENT_STORAGE_KEY) === "true";
}

export function saveDefaultResearchWebSupplement(enabled: boolean): void {
  writeLocalPreference(RESEARCH_WEB_SUPPLEMENT_STORAGE_KEY, enabled ? "true" : "false");
}
