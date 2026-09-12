import type { AppState } from "../workbench/state";

export type AppBootstrapState = Pick<
  AppState,
  "config" | "skills" | "subAgents" | "conversations"
>;

/**
 * 壳层启动数据。
 * 本地后端目前只服务研究任务、热榜与知乎账户接口；模型配置、技能、子代理与会话列表
 * 没有真实来源，保持为空由各视图呈现空态，不用示例数据顶替。
 */
export function loadAppBootstrap(): AppBootstrapState {
  return {
    skills: [],
    subAgents: [],
    conversations: [],
  };
}

export function applyAppBootstrap(previous: AppState, bootstrap: AppBootstrapState): AppState {
  return {
    ...previous,
    ...bootstrap,
  };
}
