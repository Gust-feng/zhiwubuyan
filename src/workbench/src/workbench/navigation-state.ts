import type { HomeFeedScope } from "../personal-workbench/workbench/app/components/use-home-feed";

export type WorkbenchView = "home" | "search" | "explore" | "ask" | "voices" | "imagery" | "mine";

/** 检索视图的取数条件：首页提交后带入，检索结果以独立视图呈现。 */
export type WorkbenchSearchRequest = {
  readonly query: string;
  readonly scope: HomeFeedScope;
};

export type WorkbenchNavigationState = {
  readonly view: WorkbenchView;
  readonly researchTaskId: string | null;
  readonly homeFocusRequest: number;
  /** 从首页带进众声的议题；只在众声保留，作为跨板块衔接的上下文。 */
  readonly voicesIssue: string | null;
  /** 从首页带进检索视图的条件；未发起过检索时为 null。 */
  readonly search: WorkbenchSearchRequest | null;
};

export type WorkbenchNavigationAction =
  | { readonly type: "navigate"; readonly target: WorkbenchView; readonly researchTaskId?: string | null }
  | { readonly type: "focus-home-input" }
  | { readonly type: "open-voices"; readonly issue: string }
  | { readonly type: "open-search"; readonly query: string; readonly scope: HomeFeedScope };

export function createInitialWorkbenchNavigationState(): WorkbenchNavigationState {
  return {
    view: "home",
    researchTaskId: null,
    homeFocusRequest: 0,
    voicesIssue: null,
    search: null,
  };
}

export function reduceWorkbenchNavigation(
  state: WorkbenchNavigationState,
  action: WorkbenchNavigationAction,
): WorkbenchNavigationState {
  switch (action.type) {
    case "navigate":
      return {
        ...state,
        view: action.target,
        researchTaskId: action.target === "ask" ? action.researchTaskId ?? null : state.researchTaskId,
      };
    case "open-voices":
      return { ...state, view: "voices", voicesIssue: action.issue.trim() || null };
    case "open-search":
      return { ...state, view: "search", search: { query: action.query.trim(), scope: action.scope } };
    case "focus-home-input":
      return { ...state, homeFocusRequest: state.homeFocusRequest + 1 };
  }
}
