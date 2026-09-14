import type { ContentGateway, ContentSource } from "../platform/zhihu/content.ts";
import type { SharedCache } from "./shared-cache.ts";
import type { ConceptAnimationMaterialStatus, ConceptAnimationReference } from "../contracts/concept-animation.ts";

/**
 * 成象取料：生成动画前，先从知乎检索一批相关内容的摘要，作为参考资料注入提示词。
 *
 * 为什么这么做：模型凭自身知识讲抽象概念容易空泛甚至出错；知乎语料能校正事实、
 * 提供常见讲解角度。但语料只改善"讲什么"，不改善动画表现。
 *
 * 三条约束：
 * 1. 送进去的是**检索摘要**（上游 ContentText），不是原文全文；
 * 2. 取料失败（限流/额度耗尽/未配凭证）或搜不到结果时**降级为凭模型知识生成**，
 *    如实标 unavailable，不抛错阻断生成；
 * 3. 同主题短时间重复生成只取一次料：本地缓存 + 单飞，保护按账号汇总的搜索额度。
 */

export type AnimationMaterial = {
  readonly status: ConceptAnimationMaterialStatus;
  readonly references: ConceptAnimationReference[];
};

/** 空检索结果不算失败，但也不值得占缓存；只有真正取到资料才缓存。 */
const MATERIAL_TTL_MS = 15 * 60 * 1000;
/** 送入提示词的条数上限：条数过多反而稀释重点，也让画面更容易堆成文字墙。 */
const MATERIAL_LIMIT = 6;
/** 每条摘要送进提示词前的截断长度。 */
const EXCERPT_CHARS = 600;
/** 搜索一次取回多少条用于筛选。 */
const SEARCH_COUNT = 8;

export type AnimationMaterialProvider = {
  load(topic: string): Promise<AnimationMaterial>;
};

export type AnimationMaterialOptions = {
  content: ContentGateway;
  cache: SharedCache;
  /** 覆盖默认取料上限，主要供测试。 */
  limit?: number;
};

const EMPTY: AnimationMaterial = { status: "unavailable", references: [] };

export function createAnimationMaterialProvider(options: AnimationMaterialOptions): AnimationMaterialProvider {
  const limit = Math.max(1, options.limit ?? MATERIAL_LIMIT);
  const inFlight = new Map<string, Promise<AnimationMaterial>>();

  async function fetchMaterial(topic: string): Promise<AnimationMaterial> {
    const key = cacheKey(topic);
    const cached = await readCache(options.cache, key);
    if (cached !== undefined) return cached;

    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;

    const task = (async (): Promise<AnimationMaterial> => {
      try {
        const result = await options.content.searchZhihu({ query: topic, count: SEARCH_COUNT });
        const references = toReferences(result.items, limit);
        if (references.length === 0) return EMPTY;
        const material: AnimationMaterial = { status: "used", references };
        await options.cache.set(key, material, MATERIAL_TTL_MS);
        return material;
      } catch {
        // 取料是增强而非前提：任何失败都降级为凭模型知识生成，不阻断、不缓存失败结果。
        return EMPTY;
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, task);
    return task;
  }

  return { load: fetchMaterial };
}

/** 映射为展示用参考资料；标题或链接缺失的条目丢弃（无法回原文核对）。 */
function toReferences(items: readonly ContentSource[], limit: number): ConceptAnimationReference[] {
  const seen = new Set<string>();
  const references: ConceptAnimationReference[] = [];
  for (const item of items) {
    const url = item.url.trim();
    const title = item.title.trim();
    if (url === "" || title === "" || seen.has(url)) continue;
    seen.add(url);
    references.push({
      id: item.id,
      title,
      url,
      authorName: item.authorName?.trim() || null,
      excerpt: excerpt(item.summary),
    });
    if (references.length >= limit) break;
  }
  return references;
}

function excerpt(summary: string): string {
  const collapsed = summary.replace(/\s+/g, " ").trim();
  return collapsed.length > EXCERPT_CHARS ? `${collapsed.slice(0, EXCERPT_CHARS)}…` : collapsed;
}

function cacheKey(topic: string): string {
  const normalized = topic.replace(/\s+/g, " ").trim().toLowerCase();
  return `imagery-material:v1:${normalized}`;
}

async function readCache(cache: SharedCache, key: string): Promise<AnimationMaterial | undefined> {
  const value = await cache.get(key);
  if (value === null || typeof value !== "object") return undefined;
  const record = value as { status?: unknown; references?: unknown };
  const status = record.status;
  if (status !== "used" && status !== "skipped" && status !== "unavailable") return undefined;
  const references = Array.isArray(record.references) ? (record.references as ConceptAnimationReference[]) : [];
  return { status, references };
}
