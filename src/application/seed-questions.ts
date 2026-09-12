import { ProductError } from "../platform/zhihu/errors.ts";
import type { ZhidaGateway, ZhidaModel } from "../platform/zhihu/zhida.ts";

const SEED_MODEL: ZhidaModel = "zhida-fast-1p5";
/** 送入直答的主题条数上限；与 voices 的经验一致，条数过多模型会不再稳定返回 JSON。 */
const TOPIC_LIMIT = 8;
const TOPIC_LENGTH = 80;
const QUESTION_LIMIT = 5;
const CACHE_TTL_MS = 15 * 60 * 1000;

export type SeedQuestions = {
  /** 生成时实际使用的主题，即前端传来的收藏标题（已去重、截断）。 */
  topics: readonly string[];
  generatedAt: string;
  model: string;
  questions: string[];
};

export type SeedQuestionsInput = {
  topics: readonly string[];
};

/** 把用户自己收藏的标题提炼成几条可直接开始研究的问题。
 *  每次调用消耗一次直答额度，因此按主题集合做短缓存，并合并进行中的相同请求。 */
export function createSeedQuestionsCommand(input: { zhida: ZhidaGateway; clock?: () => Date }) {
  const clock = input.clock ?? (() => new Date());
  const cache = new Map<string, { at: number; seeds: SeedQuestions }>();
  const inFlight = new Map<string, Promise<SeedQuestions>>();

  async function compose(topics: readonly string[]): Promise<SeedQuestions> {
    const raw = await input.zhida.answer({ model: SEED_MODEL, prompt: buildPrompt(topics) });
    const questions = parseQuestions(raw.content);
    if (questions.length === 0) {
      throw new ProductError("PROTOCOL_ERROR", "直答没能从这些收藏里提炼出研究问题，请再试一次。");
    }
    return { topics, generatedAt: clock().toISOString(), model: raw.model, questions };
  }

  return {
    async execute(request: SeedQuestionsInput): Promise<SeedQuestions> {
      const topics = normalizeTopics(request.topics);
      if (topics.length === 0) {
        throw new ProductError("INVALID_INPUT", "没有可用的收藏标题，无法生成研究问题。");
      }
      const key = topics.join("\u0000");
      const cached = cache.get(key);
      if (cached && clock().getTime() - cached.at < CACHE_TTL_MS) return cached.seeds;

      const running = inFlight.get(key);
      if (running) return running;

      const task = compose(topics)
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

function normalizeTopics(topics: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of topics) {
    if (typeof raw !== "string") continue;
    const topic = raw.trim().slice(0, TOPIC_LENGTH);
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    out.push(topic);
    if (out.length >= TOPIC_LIMIT) break;
  }
  return out;
}

function buildPrompt(topics: readonly string[]): string {
  return [
    `你在「知无不言」产品里负责帮用户把「想深入了解什么」变成能直接开始研究的问题。下面 ${topics.length} 条是用户自己收藏的知乎内容标题。`,
    "",
    "任务：",
    "1. 从这些收藏里提炼 3 到 5 条值得做深度研究的问题，每条都要能独立理解、独立查证。",
    "2. 问题要具体、有范围（对象、时间或维度至少占一样），不要写成「如何看待 X」这类空泛句式。",
    "3. 只围绕这些收藏透露的兴趣提问，不要引入用户没有表达过的领域；同一主题只留最有研究价值的一种问法。",
    "4. 每条 15 到 40 个字，不以序号开头。",
    "5. 只输出 JSON，不要输出其他内容，格式：",
    '{"questions":["...","..."]}',
    "",
    "收藏的标题：",
    topics.map((topic, index) => `T${index + 1}. ${topic}`).join("\n"),
  ].join("\n");
}

function parseQuestions(text: string): string[] {
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
  const questions = (Array.isArray(record.questions) ? record.questions : []).flatMap((item) => {
    if (typeof item !== "string") return [];
    const question = item.trim();
    return question ? [question] : [];
  });
  return [...new Set(questions)].slice(0, QUESTION_LIMIT);
}
