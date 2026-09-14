import { ProductError } from "../platform/zhihu/errors.ts";
import type { ZhidaGateway, ZhidaModel } from "../platform/zhihu/zhida.ts";

const SEED_MODEL: ZhidaModel = "zhida-fast-1p5";
/** 送入直答的素材条数上限；条数过多模型会不再稳定返回 JSON。
 *  调用方按这个上限取素材，避免取多了再被截掉。 */
export const SEED_TOPIC_LIMIT = 8;
const TOPIC_LENGTH = 80;
/** 提炼出的成品条数上限。两个入口固定取同一条数：建议卡高度因此一致，
 *  在深度研究与众声之间切换时卡片不会被顶动，也不需要前端再按条数裁剪。 */
const ITEM_LIMIT = 4;
const CACHE_TTL_MS = 15 * 60 * 1000;

/** 入口类型：两个入口的素材各取各的（深度研究用本人的收藏标题，众声用公开热榜），
 *  但「素材 → 直答提炼 → 入口能直接用的几条」这一步是同一套机制、同一份缓存，
 *  所以只留这一个 owner；新增入口时在这里加一种形态，而不是再走一遍取数与缓存。 */
export const ENTRY_SEED_KINDS = ["research", "voices"] as const;
export type EntrySeedKind = (typeof ENTRY_SEED_KINDS)[number];

export type EntrySeeds = {
  readonly kind: EntrySeedKind;
  /** 本次实际使用的素材标题（已去重、截断）；没有素材时为空。 */
  readonly topics: readonly string[];
  readonly generatedAt: string;
  /** 未调用直答时缺省——没有素材就不消耗额度，也就没有模型名。 */
  readonly model?: string;
  /** 没有素材时为空列表，此时不是失败。 */
  readonly items: readonly string[];
};

export type EntrySeedsInput = {
  kind: EntrySeedKind;
  topics: readonly string[];
};

/** 把一批素材标题提炼成入口能直接用的内容。
 *  每次调用消耗一次直答额度，因此按「入口 + 素材集合」做短缓存，并合并进行中的相同请求。 */
export function createEntrySeedsCommand(input: { zhida: ZhidaGateway; clock?: () => Date }) {
  const clock = input.clock ?? (() => new Date());
  const cache = new Map<string, { at: number; seeds: EntrySeeds }>();
  const inFlight = new Map<string, Promise<EntrySeeds>>();

  async function compose(kind: EntrySeedKind, topics: readonly string[]): Promise<EntrySeeds> {
    const raw = await input.zhida.answer({ model: SEED_MODEL, prompt: buildPrompt(kind, topics) });
    const items = parseItems(raw.content);
    if (items.length === 0) {
      throw new ProductError("PROTOCOL_ERROR", failures[kind]);
    }
    return { kind, topics, generatedAt: clock().toISOString(), model: raw.model, items };
  }

  return {
    async execute(request: EntrySeedsInput): Promise<EntrySeeds> {
      const topics = normalizeTopics(request.topics);
      // 没有素材不是失败：如实返回空列表，也不消耗直答额度。
      if (topics.length === 0) {
        return { kind: request.kind, topics: [], generatedAt: clock().toISOString(), items: [] };
      }
      const key = `${request.kind}\u0000${topics.join("\u0000")}`;
      const cached = cache.get(key);
      if (cached && clock().getTime() - cached.at < CACHE_TTL_MS) return cached.seeds;

      const running = inFlight.get(key);
      if (running) return running;

      const task = compose(request.kind, topics)
        .then((seeds) => {
          cache.set(key, { at: clock().getTime(), seeds });
          return seeds;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, task);
      return task;
    },
  };
}

/** 提炼不出内容时的说明：两个入口的成品名称不同，提示也要各自说自己的话。 */
const failures: Record<EntrySeedKind, string> = {
  research: "直答没能从这些收藏里提炼出研究问题，请再试一次。",
  voices: "直答没能从热榜里挑出可讨论的议题，请再试一次。",
};

/** 两个入口的差别只在「拿什么素材、要提炼成什么」，提示词的骨架共用：
 *  身份与素材来源一句话带过，剩下的全靠各自的要求列表把成品框住。
 *  素材由路由按来源取好后传进来，这里不关心它来自收藏还是热榜。 */
const profiles: Record<EntrySeedKind, { role: string; source: string; rules: readonly string[] }> = {
  research: {
    role: "你在「知无不言」的深度研究入口，负责把用户「想深入了解什么」变成能直接开始研究的问题",
    source: "用户自己收藏的知乎内容标题",
    rules: [
      "从这些收藏里提炼 4 条值得做深度研究的问题，每条都要能独立理解、独立查证。",
      "问题要具体、有范围（对象、时间或维度至少占一样），不要写成「如何看待 X」这类空泛句式。",
      "只围绕这些收藏透露的兴趣提问，不要引入用户没有表达过的领域；同一主题只留最有研究价值的一种问法。",
      "每条 15 到 40 个字，不以序号开头。",
    ],
  },
  voices: {
    role: "你在「知无不言」的众声入口，负责挑出此刻值得听不同说法的事，写成能直接开始整理的议题",
    source: "此刻知乎热榜上的条目标题",
    rules: [
      "从中挑出 4 条此刻存在明显观点分歧、不同人会有不同说法的议题，每条都要能独立理解。",
      "只在真正有得争的条目上选题：纯资讯、已有定论、以及纯投票式提问（如「哪个演员演好人和演坏人都像」）都不选。",
      "议题要具体、有范围（对象、时间或维度至少占一样），不要写成「如何看待 X」这类空泛句式。",
      "同一件事只留最有讨论价值的一种问法；每条 15 到 40 个字，不以序号开头。",
    ],
  },
};

function buildPrompt(kind: EntrySeedKind, topics: readonly string[]): string {
  const profile = profiles[kind];
  return [
    `${profile.role}。下面 ${topics.length} 条是${profile.source}。`,
    "",
    "任务：",
    ...profile.rules.map((rule, index) => `${index + 1}. ${rule}`),
    `${profile.rules.length + 1}. 只输出 JSON，不要输出其他内容，格式：`,
    '{"items":["...","..."]}',
    "",
    "素材：",
    topics.map((topic, index) => `T${index + 1}. ${topic}`).join("\n"),
  ].join("\n");
}

function normalizeTopics(topics: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of topics) {
    if (typeof raw !== "string") continue;
    const topic = raw.trim().slice(0, TOPIC_LENGTH);
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    out.push(topic);
    if (out.length >= SEED_TOPIC_LIMIT) break;
  }
  return out;
}

function parseItems(text: string): string[] {
  const jsonText = text.replace(/```(?:json)?/g, "").trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  } catch {
    return [];
  }
  const record = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const items = (Array.isArray(record.items) ? record.items : []).flatMap((item) => {
    if (typeof item !== "string") return [];
    const value = item.trim();
    return value ? [value] : [];
  });
  return [...new Set(items)].slice(0, ITEM_LIMIT);
}
