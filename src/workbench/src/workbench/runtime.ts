import React, { useEffect, useMemo, useRef, useState } from "react";
import { useConversationSummaryRefresh } from "../features/conversations/conversation-refresh";
import { useConversationProjectionChanges } from "../features/conversations/conversation-projection-changes";
import { createAppRunController } from "../features/conversations/run/controller";
import {
  currentRunProjectionDeps,
  projectCurrentRun,
  type CurrentRunProjection,
} from "../features/conversations/run/projection";

import { createAppSidebarConversationController } from "../features/conversations/sidebar-controller";
import { createAppComposerController } from "../features/conversations/composer-controller";
import { shouldKeepRefreshing, stopLiveUpdates } from "../features/conversations/run/runtime-controls";
import { resetTranscriptCache } from "../features/conversations/transcript/store";
import {
  contextWindowUsageFrom,
  contextWindowTokensForActiveRun,
  latestModelUsageFromEvents,
  latestModelUsageFromTranscript,
  type ContextWindowUsage,
} from "../features/conversations/context-window-usage";
import { isConversationWaitingForUser } from "../features/conversations/conversation-state";
import type { AppState } from "./state";
import { useAppBootstrap, type AppBootstrapLoadState } from "./use-app-bootstrap";
export type { AppBootstrapLoadState } from "./use-app-bootstrap";
import type { ContextAttachment } from "../contracts/context";
import type { OrdinaryWorkView } from "../contracts/run";

export type AppWorkbenchRuntimeOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly setGoal: React.Dispatch<React.SetStateAction<string>>;
  readonly goal: string;
  readonly attachments: readonly ContextAttachment[];
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly setInputCloseSignal: React.Dispatch<React.SetStateAction<number>>;
};

export type AppWorkbenchRuntime = {
  readonly bootstrap: AppBootstrapLoadState;
  readonly retryBootstrap: () => void;
  readonly currentRun: CurrentRunProjection;
  readonly contextUsage?: ContextWindowUsage;
  readonly modelResponding: boolean;
  readonly pendingConfirmation?: OrdinaryWorkView["pendingConfirmation"];
  readonly pendingCount: number;
  readonly confirmationBusy: boolean;
  readonly contextBusy: boolean;
  readonly pendingConversationIds: ReadonlySet<string>;

  readonly runActions: Pick<
    ReturnType<typeof createAppRunController>,
    "loadConversation" | "startTask" | "startNewConversation" | "cancelRun" | "decideConfirmation" | "resetChat"
  >;
  readonly sidebarActions: Pick<
    ReturnType<typeof createAppSidebarConversationController>,
    "renameConversation" | "toggleConversationPinned" | "deleteConversation"
  >;
  readonly composerActions: Pick<
    ReturnType<typeof createAppComposerController>,
    "selectAttachment" | "uploadAttachments" | "removeAttachment"
  >;
};

export function useAppWorkbenchRuntime(options: AppWorkbenchRuntimeOptions): AppWorkbenchRuntime {
  const mountedRef = useRef(true);
  const { state: bootstrap, retry: retryBootstrap } = useAppBootstrap({ mountedRef, setApp: options.setApp });
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [cancellingRunId, setCancellingRunId] = useState<string | undefined>(undefined);
  const [pendingConversationIds, setPendingConversationIds] = useState<ReadonlySet<string>>(() => new Set());


  const appRef = useRef(options.app);
  appRef.current = options.app;
  const pollTimer = useRef<number | undefined>(undefined);
  const streamRef = useRef<EventSource | undefined>(undefined);
  const fallbackPollRef = useRef<AbortController | undefined>(undefined);
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const viewEpochRef = useRef(0);
  const submissionAttemptRef = useRef<{ readonly key: string; readonly id: string } | undefined>(undefined);
  const attachmentUploadAttemptRef = useRef<{ readonly key: string; readonly id: string } | undefined>(undefined);

  const conversationLoadAbortRef = useRef<AbortController | undefined>(undefined);
  const conversationLoadTargetRef = useRef<string | undefined>(undefined);
  const mutationConversationIdsRef = useRef<Set<string>>(new Set());

  useConversationSummaryRefresh({
    conversations: options.app.conversations,
    setApp: options.setApp,
    mountedRef,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      conversationLoadAbortRef.current?.abort();
      conversationLoadAbortRef.current = undefined;
      conversationLoadTargetRef.current = undefined;
      stopLiveUpdates(pollTimer, streamRef, fallbackPollRef);
      resetTranscriptCache();

    };
  }, []);

  const currentRun = useMemo(() => projectCurrentRun(options.app), currentRunProjectionDeps(options.app));
  const hasNormalConversationContext = options.app.conversation !== undefined || currentRun.run !== undefined;
  const latestModelUsage = useMemo(
    () => latestModelUsageFromEvents(currentRun.events) ?? latestModelUsageFromTranscript(currentRun.transcriptNodes),
    [currentRun.events, currentRun.transcriptNodes],
  );
  const contextUsage = useMemo(() => {
    if (!hasNormalConversationContext) {
      return undefined;
    }
    return contextWindowUsageFrom({
      contextWindowTokens: contextWindowTokensForActiveRun({
        runContextWindowTokens: currentRun.capabilityResolution?.modelContextWindowTokens,
        selectedModelContextWindowTokens: undefined,
      }),
      modelUsage: latestModelUsage,
    });
  }, [
    currentRun.capabilityResolution?.modelContextWindowTokens,
    currentRun.run,
    hasNormalConversationContext,
    latestModelUsage,
  ]);
  const modelResponding = currentRun.run !== undefined &&
    currentRun.run.runId !== cancellingRunId &&
    shouldKeepRefreshing(currentRun.run.status);
  const pendingConfirmation = currentRun.workView?.pendingConfirmation;
  const pendingConversationCount = options.app.conversations.filter(isConversationWaitingForUser).length;
  const pendingCount = Math.max(pendingConversationCount, pendingConfirmation === undefined ? 0 : 1);

  const runController = useMemo(() => createAppRunController({
    app: options.app,
    setApp: options.setApp,
    setGoal: options.setGoal,
    attachments: options.attachments,
    setAttachments: options.setAttachments,
    goal: options.goal,
    confirmationBusy,
    setConfirmationBusy,
    mountedRef,
    pollTimer,
    streamRef,
    fallbackPollRef,
    activeRunIdRef,
    viewEpochRef,
    submissionAttemptRef,
    conversationLoadAbortRef,
    conversationLoadTargetRef,
    setCancellingRunId,
  }), [
    confirmationBusy,
    options.app,
    options.attachments,
    options.goal,
    options.setApp,
    options.setAttachments,
    options.setGoal,
  ]);

  useConversationProjectionChanges({
    appRef,
    setApp: options.setApp,
    mountedRef,
    activeRunIdRef,
    viewEpochRef,
    startLiveUpdates: runController.startLiveUpdates,
  });

  const sidebarConversationController = useMemo(() => createAppSidebarConversationController({
    app: options.app,
    appRef,
    setApp: options.setApp,
    mountedRef,
    mutationConversationIdsRef,
    setMutationConversationIds: setPendingConversationIds,
    resetChat: runController.resetChat,
    setInputCloseSignal: options.setInputCloseSignal,
    setGoal: options.setGoal,
    setAttachments: options.setAttachments,
  }), [
    options.app,
    options.setApp,
    options.setAttachments,
    options.setGoal,
    options.setInputCloseSignal,
    runController.resetChat,
  ]);

  const composerController = useMemo(() => createAppComposerController({
    setApp: options.setApp,
    mountedRef,
    contextBusy,
    setContextBusy,
    attachmentUploadAttemptRef,
    setAttachments: options.setAttachments,
    attachments: options.attachments,
  }), [
    contextBusy,
    options.attachments,
    options.setApp,
    options.setAttachments,
  ]);

  return {
    bootstrap,
    retryBootstrap,
    currentRun,
    contextUsage,
    modelResponding,
    pendingConfirmation,
    pendingCount,
    confirmationBusy,
    contextBusy,
    pendingConversationIds,

    runActions: {
      loadConversation: runController.loadConversation,
      startTask: runController.startTask,
      startNewConversation: runController.startNewConversation,
      cancelRun: runController.cancelRun,
      decideConfirmation: runController.decideConfirmation,
      resetChat: runController.resetChat,
    },
    sidebarActions: {
      renameConversation: sidebarConversationController.renameConversation,
      toggleConversationPinned: sidebarConversationController.toggleConversationPinned,
      deleteConversation: sidebarConversationController.deleteConversation,
    },
    composerActions: {
      selectAttachment: composerController.selectAttachment,
      uploadAttachments: composerController.uploadAttachments,
      removeAttachment: composerController.removeAttachment,
    },
  };
}
