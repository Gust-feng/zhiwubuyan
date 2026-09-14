import { useEffect, useSyncExternalStore, type RefObject } from "react";
import type { PersonalKnowledgeLoadState } from "../personal-workbench/workbench/app/components/personalKnowledgeClient";
import {
  clearPersonalKnowledgeError,
  getPersonalKnowledgeError,
  getPersonalKnowledgeLoadState,
  initializePersonalKnowledge,
  refreshPersonalKnowledge,
  setPersonalKnowledgePersistenceEnabled,
  subscribePersonalKnowledge,
} from "../personal-workbench/workbench/app/components/personalKnowledgeClient";
import { handleReadingSizeWheel, applyPrefs, loadPrefs } from "../shell/reading-preferences";

export type WorkbenchEnvironmentInput = {
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly personalKnowledgePersistenceEnabled: boolean;
};

export type WorkbenchEnvironmentState = {
  readonly knowledgeLoadState: PersonalKnowledgeLoadState;
  readonly knowledgeError?: string;
  readonly retryKnowledge: () => Promise<void>;
  readonly refreshKnowledge: () => Promise<void>;
  readonly dismissKnowledgeError: () => void;
};

export function useWorkbenchEnvironment(input: WorkbenchEnvironmentInput): WorkbenchEnvironmentState {
  const knowledgeLoadState = useSyncExternalStore(
    subscribePersonalKnowledge,
    getPersonalKnowledgeLoadState,
    getPersonalKnowledgeLoadState,
  );
  const knowledgeError = useSyncExternalStore(
    subscribePersonalKnowledge,
    getPersonalKnowledgeError,
    getPersonalKnowledgeError,
  );

  useEffect(() => {
    setPersonalKnowledgePersistenceEnabled(input.personalKnowledgePersistenceEnabled);
  }, [input.personalKnowledgePersistenceEnabled]);

  useEffect(() => {
    if (input.personalKnowledgePersistenceEnabled) {
      void initializePersonalKnowledge().catch(() => undefined);
    }
  }, [
    input.personalKnowledgePersistenceEnabled,
  ]);

  useEffect(() => {
    const root = input.rootRef.current;
    if (root === null) return undefined;
    const onWheel = (event: WheelEvent): void => {
      handleReadingSizeWheel(event);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [input.rootRef]);

  useEffect(() => {
    applyPrefs(loadPrefs());
  }, []);

  return {
    knowledgeLoadState,
    knowledgeError,
    retryKnowledge: initializePersonalKnowledge,
    refreshKnowledge: refreshPersonalKnowledge,
    dismissKnowledgeError: clearPersonalKnowledgeError,
  };
}
