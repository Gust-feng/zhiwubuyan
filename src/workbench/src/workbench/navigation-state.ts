export type WorkbenchView = "home" | "explore" | "ask" | "voices" | "mine";

export type WorkbenchNavigationState = {
  readonly view: WorkbenchView;
  readonly researchTaskId: string | null;
  readonly homeFocusRequest: number;
  /** 从首页带进众声的议题；只在众声保留，作为跨板块衔接的上下文。 */
  readonly voicesIssue: string | null;
};

export type WorkbenchNavigationAction =
  | { readonly type: "navigate"; readonly target: WorkbenchView; readonly researchTaskId?: string | null }
  | { readonly type: "focus-home-input" }
  | { readonly type: "open-voices"; readonly issue: string };

export function createInitialWorkbenchNavigationState(): WorkbenchNavigationState {
  return {
    view: "home",
    researchTaskId: null,
    homeFocusRequest: 0,
    voicesIssue: null,
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
    case "focus-home-input":
      return { ...state, homeFocusRequest: state.homeFocusRequest + 1 };
  }
}
