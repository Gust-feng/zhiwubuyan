import { readLocalPreference, writeLocalPreference } from "../../shell/local-preferences";

/**
 * 研究偏好的本地默认值：只决定研究入口的初始选择，单次研究仍可在入口覆盖。
 * Ultra 只在本机运行面承接；网页端即使本地存过 Ultra 也回退 Pro，
 * 避免入口默认选中一个本侧不承接的档位。
 */
export type ResearchDefaultTier = "pro" | "ultra";

const RESEARCH_TIER_STORAGE_KEY = "research.default-tier";
const RESEARCH_WEB_SUPPLEMENT_STORAGE_KEY = "research.default-web-supplement";

export function getDefaultResearchTier(ultraAvailable: boolean): ResearchDefaultTier {
  if (!ultraAvailable) return "pro";
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
