import { PRODUCT_DATA_FORMAT_ID } from "@api-contracts/product";

export const PREFERENCE_STORAGE_PREFIX = `${PRODUCT_DATA_FORMAT_ID}:`;

export function localPreferenceKey(name: string): string {
  return `${PREFERENCE_STORAGE_PREFIX}${name}`;
}

export function readLocalPreference(key: string): string | undefined {
  const storageKey = localPreferenceKey(key);
  if (typeof localStorage === "undefined") return undefined;
  try {
    return localStorage.getItem(storageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeLocalPreference(key: string, value: string): boolean {
  const storageKey = localPreferenceKey(key);
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(storageKey, value);
    return true;
  } catch {
    // 存储不可用时按未保存处理，功能仍可正常运行。
    return false;
  }
}