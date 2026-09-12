export type WorkbenchView = "home" | "ask" | "voices" | "circles" | "briefs" | "mine" | "search" | "brain";

export type WorkbenchNavigationState = {
  readonly view: WorkbenchView;
  readonly previousView: WorkbenchView;
  readonly brainSelectedId: string | null;
  readonly mineSelectedNoteId: string | null;
  readonly researchTaskId: string | null;
  readonly homeFocusRequest: number;
};

export type WorkbenchNavigationAction =
  | { readonly type: "navigate"; readonly target: WorkbenchView; readonly researchTaskId?: string | null }
  | { readonly type: "set-brain-selection"; readonly id: string | null }
  | { readonly type: "set-mine-note-selection"; readonly id: string | null }
  | { readonly type: "focus-home-input" };

export function createInitialWorkbenchNavigationState(): WorkbenchNavigationState {
  return {
    view: "home",
    previousView: "home",
    brainSelectedId: null,
    mineSelectedNoteId: null,
    researchTaskId: null,
    homeFocusRequest: 0,
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
        previousView: action.target === "search" ? state.view : state.previousView,
        researchTaskId: action.target === "ask" ? action.researchTaskId ?? null : state.researchTaskId,
      };
    case "set-brain-selection":
      return { ...state, brainSelectedId: action.id };
    case "set-mine-note-selection":
      return { ...state, mineSelectedNoteId: action.id };
    case "focus-home-input":
      return { ...state, homeFocusRequest: state.homeFocusRequest + 1 };
  }
}
