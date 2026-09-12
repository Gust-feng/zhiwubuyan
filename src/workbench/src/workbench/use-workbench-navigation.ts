import { useCallback, useReducer } from "react";
import {
  createInitialWorkbenchNavigationState,
  reduceWorkbenchNavigation,
  type WorkbenchNavigationState,
  type WorkbenchView,
} from "./navigation-state";
import { consumeZhihuLoginReturnToMine } from "./zhihu-auth-navigation";

export type WorkbenchNavigationController = {
  readonly state: WorkbenchNavigationState;
  readonly navigate: (target: WorkbenchView, researchTaskId?: string | null) => void;
  readonly setBrainSelection: (id: string | null) => void;
  readonly setMineNoteSelection: (id: string | null) => void;
  readonly focusHomeInput: () => void;
};

export function useWorkbenchNavigation(): WorkbenchNavigationController {
  const [state, dispatch] = useReducer(
    reduceWorkbenchNavigation,
    undefined,
    createInitialNavigationState,
  );

  const navigate = useCallback((target: WorkbenchView, researchTaskId?: string | null) => {
    dispatch({ type: "navigate", target, researchTaskId });
  }, []);
  const setBrainSelection = useCallback((id: string | null) => {
    dispatch({ type: "set-brain-selection", id });
  }, []);
  const setMineNoteSelection = useCallback((id: string | null) => {
    dispatch({ type: "set-mine-note-selection", id });
  }, []);
  const focusHomeInput = useCallback(() => {
    dispatch({ type: "focus-home-input" });
  }, []);

  return {
    state,
    navigate,
    setBrainSelection,
    setMineNoteSelection,
    focusHomeInput,
  };
}

function createInitialNavigationState(): WorkbenchNavigationState {
  const initial = createInitialWorkbenchNavigationState();
  if (!consumeZhihuLoginReturnToMine()) return initial;
  return { ...initial, view: "mine", previousView: "mine" };
}
