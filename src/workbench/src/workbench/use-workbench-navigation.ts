import { useCallback, useReducer } from "react";
import {
  createInitialWorkbenchNavigationState,
  reduceWorkbenchNavigation,
  type WorkbenchNavigationState,
  type WorkbenchView,
} from "./navigation-state";
import type { HomeFeedScope } from "../personal-workbench/workbench/app/components/use-home-feed";
import { consumeZhihuLoginReturn } from "./zhihu-auth-navigation";

export type WorkbenchNavigationController = {
  readonly state: WorkbenchNavigationState;
  readonly navigate: (target: WorkbenchView, researchTaskId?: string | null) => void;
  readonly focusHomeInput: () => void;
  /** 带着议题进入众声：跨板块衔接要保留用户刚才在读的问题。 */
  readonly openVoices: (issue: string) => void;
  /** 带着检索条件进入检索视图：结果独立成页，不插回首页内容流。 */
  readonly openSearch: (query: string, scope: HomeFeedScope) => void;
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
  const openVoices = useCallback((issue: string) => {
    dispatch({ type: "open-voices", issue });
  }, []);
  const openSearch = useCallback((query: string, scope: HomeFeedScope) => {
    dispatch({ type: "open-search", query, scope });
  }, []);
  const focusHomeInput = useCallback(() => {
    dispatch({ type: "focus-home-input" });
  }, []);

  return {
    state,
    navigate,
    openVoices,
    openSearch,
    focusHomeInput,
  };
}

function createInitialNavigationState(): WorkbenchNavigationState {
  const initial = createInitialWorkbenchNavigationState();
  const restored = consumeZhihuLoginReturn(["home", "explore", "mine", "ask", "voices", "imagery"]);
  if (restored === undefined) return initial;
  return { ...initial, view: restored as WorkbenchView };
}
