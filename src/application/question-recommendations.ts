import type { QuestionRecommendationsResult } from "../platform/zhihu/user-data.ts";

/**
 * 问题推荐的短时缓存。
 * 推荐按账号画像生成，同一次浏览里刷新页面不该换一批问题；上游额度在 creator 组且每日有限，
 * 频繁进入入口也不该反复消耗。按用户隔离，只缓存成功结果，并合并并发请求。
 */

const RECOMMENDATIONS_TTL_MS = 30 * 60 * 1000;
/** 按用户缓存，键随访问账号增长；设上限避免长驻进程无界增长。 */
const RECOMMENDATIONS_MAX_ENTRIES = 200;

export function createQuestionRecommendationsCommand(input: { clock?: () => Date } = {}) {
  const clock = input.clock ?? (() => new Date());
  const cache = new Map<string, { at: number; result: QuestionRecommendationsResult }>();
  const inFlight = new Map<string, Promise<QuestionRecommendationsResult>>();

  function remember(key: string, result: QuestionRecommendationsResult): void {
    // 命中即提到队尾；淘汰从队首取最久未用的。
    cache.delete(key);
    cache.set(key, { at: clock().getTime(), result });
    while (cache.size > RECOMMENDATIONS_MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (oldest.done === true) break;
      cache.delete(oldest.value);
    }
  }

  return {
    async recommendations(request: {
      /** 用户身份标识；推荐是个人化结果，不同账号不能共用同一份缓存。 */
      cacheKey: string;
      load: () => Promise<QuestionRecommendationsResult>;
    }): Promise<QuestionRecommendationsResult> {
      const cached = cache.get(request.cacheKey);
      if (cached !== undefined && clock().getTime() - cached.at < RECOMMENDATIONS_TTL_MS) {
        remember(request.cacheKey, cached.result);
        return cached.result;
      }

      const running = inFlight.get(request.cacheKey);
      if (running !== undefined) return running;

      const task = request.load()
        .then((result) => {
          remember(request.cacheKey, result);
          return result;
        })
        .finally(() => {
          inFlight.delete(request.cacheKey);
        });
      inFlight.set(request.cacheKey, task);
      return task;
    },
  };
}
