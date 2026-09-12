import { ProductError } from "../platform/zhihu/errors.ts";
import type { ZhidaGateway, ZhidaModel } from "../platform/zhihu/zhida.ts";

/**
 * 首页问答：直接调用知乎直答给出快速回答。
 * 与深度研究的 Pro 产出是两种对象——这里不取证、不产生来源引用，
 * 答案正文来自直答生成内容，界面必须如实标注这一点。
 */

/** 首页问答的两档：快速（默认）与深度思考。 */
export const HOME_ANSWER_TIERS = ["fast", "thinking"] as const;
export type HomeAnswerTier = (typeof HOME_ANSWER_TIERS)[number];

const TIER_MODEL: Record<HomeAnswerTier, ZhidaModel> = {
  fast: "zhida-fast-1p5",
  thinking: "zhida-thinking-1p5",
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const QUESTION_MAX = 500;

export type HomeAnswer = {
  question: string;
  tier: HomeAnswerTier;
  model: string;
  content: string;
  generatedAt: string;
};

export type HomeAnswerInput = {
  question: string;
  tier?: HomeAnswerTier;
};

export function createHomeAnswerCommand(input: { zhida: ZhidaGateway; clock?: () => Date }) {
  const clock = input.clock ?? (() => new Date());
  const cache = new Map<string, { at: number; answer: HomeAnswer }>();
  const inFlight = new Map<string, Promise<HomeAnswer>>();

  async function compose(question: string, tier: HomeAnswerTier): Promise<HomeAnswer> {
    const answer = await input.zhida.answer({ model: TIER_MODEL[tier], prompt: question });
    return {
      question,
      tier,
      model: answer.model,
      content: answer.content,
      generatedAt: clock().toISOString(),
    };
  }

  return {
    async execute(request: HomeAnswerInput): Promise<HomeAnswer> {
      const question = request.question.trim();
      if (!question) throw new ProductError("INVALID_INPUT", "问题不能为空。");
      if (question.length > QUESTION_MAX) {
        throw new ProductError("INVALID_INPUT", "问题过长，请精简后再问。");
      }
      const tier = request.tier ?? "fast";
      const key = `${question}\u0000${tier}`;

      const cached = cache.get(key);
      if (cached && clock().getTime() - cached.at < CACHE_TTL_MS) return cached.answer;

      const running = inFlight.get(key);
      if (running) return running;

      const task = compose(question, tier)
        .then((answer) => {
          cache.set(key, { at: clock().getTime(), answer });
          return answer;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, task);
      return task;
    },
  };
}
