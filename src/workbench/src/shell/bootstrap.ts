import type { AppState } from "../workbench/state";

export type AppBootstrapState = Pick<
  AppState,
  "conversations"
>;

/**
 * 壳层启动数据。
 * 本地后端目前只服务研究任务、热榜与知乎账户接口；会话列表没有真实来源，
 * 保持为空由各视图呈现空态，不用示例数据顶替。
 */
export function loadAppBootstrap(): AppBootstrapState {
  return {
    conversations: [],
  };
}

export function applyAppBootstrap(previous: AppState, bootstrap: AppBootstrapState): AppState {
  return {
    ...previous,
    ...bootstrap,
  };
}
