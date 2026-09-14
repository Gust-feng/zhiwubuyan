import type { Limits as LimitsType, ResearchTier } from "../contracts/research.ts";
import type { ZhidaModel } from "../platform/zhihu/zhida.ts";

/**
 * 研究档位的模型映射与预算默认值。
 *
 * 这些是产品事实，被本机研究引擎与网页端编排共用：
 * 网页端编排只用直答与检索，不能因为要读档位映射就把本机存储（libsql）拖进函数包，
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

/**
 * 网页端 Pro 编排的任务预算（ADR-0014）。单请求内跑完，总预算按函数执行上限倒推，
 * 落在 Hobby 的 300 秒上限内，因此不分部署计划档都能承接。
 * 与 Ultra 共用 Limits 形状；其中单元/修复相关字段在本档不使用，取满足 schema 下限的占位值。
 */
export const PRO_LIMITS: LimitsType = {
  maxConcurrentUnits: 3,
  maxConcurrentSearches: 3,
  maxSearchRequests: 16,
  maxModelRequests: 10,
  maxSources: 24,
  timeoutMs: 240_000,
  synthesisModelReserve: 4,
  synthesisTimeReserveMs: 120_000,
  unitMaxSteps: 4,
  unitMaxSearchRequests: 6,
  unitTimeoutMs: 60_000,
  maxRepairPasses: 0,
};

/**
 * Pro 编排的运行参数：拆题与覆盖判断用直答 fast（仓库已多次验证该模型能稳定返回 JSON），
 * 成稿用直答 agent（检索增强、可流式）。轮数固定有界，避免把 serverless 请求拖到不可预测。
 */
export const PRO_ORCHESTRATION = {
  /** 拆题 + 覆盖判断使用的模型；成稿沿用 TIER_ZHIDA_MODEL.pro。 */
  planningModel: "zhida-fast-1p5",
  /** 最多轮数：1 轮初始取证 + 最多 2 轮补查。 */
  maxRounds: 3,
  /** 拆题产出的子问题数上限（下限 3 由 schema 约束）。 */
  maxQuestions: 5,
  /** 单次检索的条数：站内 6，全网补充 4。 */
  zhihuCount: 6,
  webCount: 4,
  /** 首轮全网补充的检索次数上限，避免挤占后续轮次预算。 */
  maxWebSearches: 3,
  /** 单个子问题在一轮内的补查查询数上限。 */
  maxQueriesPerRound: 5,
  /** 单次检索超时。 */
  perSearchTimeoutMs: 15_000,
  /** 最终资料条数上限，与 AnswerMaterial.sources 上限一致。 */
  materialLimit: 24,
} as const;
