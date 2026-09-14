import type { Limits as LimitsType, ResearchTier } from "../contracts/research.ts";
import type { ZhidaModel } from "../platform/zhihu/zhida.ts";

/**
 * 研究档位的模型映射与预算默认值。
 *
 * 这两项是产品事实，被本机研究引擎与网页端快答共用：
 * 网页端只承接直答单次调用，不能因为要读档位映射就把本机存储（libsql）拖进函数包，
 * 所以把无依赖的常量单独放在这里，由 deep-research.ts 引用，而不是反向导出。
 */

/**
 * 直答档位 → 直答模型（ADR-0007：fast/thinking 为首页问答模式，pro 为深度研究 Pro）。
 * 类型取直答模型枚举而非 string：档位映射写错时在编译期就暴露，不必等一次真实上游调用。
 */
export const TIER_ZHIDA_MODEL: Record<Exclude<ResearchTier, "ultra">, ZhidaModel> = {
  fast: "zhida-fast-1p5",
  thinking: "zhida-thinking-1p5",
  pro: "zhida-agent",
};

/**
 * 本机研究（Ultra）的固定默认预算；创建任务时冻结快照。
 * 全部角色共用一份任务额度；并发与单元上限由同一账本控制。
 */
export const DEFAULT_LIMITS: LimitsType = {
  maxConcurrentUnits: 3,
  maxConcurrentSearches: 4,
  maxSearchRequests: 160,
  maxModelRequests: 200,
  maxSources: 800,
  timeoutMs: 2_700_000,
  synthesisModelReserve: 12,
  synthesisTimeReserveMs: 600_000,
  unitMaxSteps: 12,
  unitMaxSearchRequests: 8,
  unitTimeoutMs: 300_000,
  maxRepairPasses: 1,
};
