import {
  AnimationRecord,
  type AnimationSummary,
  type AnimationSummaryList,
  type ConceptAnimationResult,
} from "../contracts/concept-animation.ts";
/**
 * 成象记录：把一次生成结果连同主题、指令与时间保存下来，供历史列表与详情读取。
 *
 * 端口放在应用层、实现按运行面选择（本机落文件、网页落远端 KV），
 * 与个人档案快照同一范式：应用层只声明语义，不关心存储介质。
 * 记录按 scope 隔离——本机固定 "local"，网页端用登录用户身份，
 * 保证一个用户读不到另一个用户的成象。
 */
export type AnimationRecordStore = {
  list(scope: string, options: { limit: number; offset: number }): Promise<AnimationSummaryList>;
  get(scope: string, id: string): Promise<AnimationRecord | undefined>;
  save(scope: string, record: AnimationRecord): Promise<void>;
  remove(scope: string, id: string): Promise<boolean>;
};

/** 记录列表默认页大小与单 scope 保留上限：成像是沉甸甸的产物，留最近一批即可。 */
export const ANIMATION_LIST_DEFAULT_LIMIT = 20;
export const ANIMATION_RECORDS_MAX = 60;

/**
 * 由一次成功的生成结果构造可保存的记录；失败结果不落库（由调用方判断后调用）。
 */
export function toAnimationRecord(input: {
  id: string;
  topic: string;
  instruction?: string | undefined;
  createdAt: string;
  result: ConceptAnimationResult;
}): AnimationRecord {
  return {
    id: input.id,
    topic: input.topic,
    title: input.result.title,
    instruction: input.instruction ?? null,
    createdAt: input.createdAt,
    html: input.result.html,
    model: input.result.model,
    references: input.result.references,
    materialStatus: input.result.materialStatus,
  };
}

/** 记录去掉 html 后的列表项。 */
export function toAnimationSummary(record: AnimationRecord): AnimationSummary {
  const { html: _html, ...summary } = record;
  return summary;
}
