import React, { useCallback, useState } from "react";
import { PersonalWorkbench } from "./personal-workbench/personal-workbench";
import { useAppShellEffects } from "./shell/effects";
import { persistSidebarCollapsedPreference, useAppShellState } from "./shell/state";
import { useAppQueuedMessages } from "./features/conversations/queued-message-state";
import { useAppWorkbenchRuntime } from "./workbench/runtime";
import { useAppWorkbenchTaskState } from "./features/conversations/task-state";
import { workbenchInputPropsFrom } from "./features/conversations/composer-input-props";
import { createInitialAppState } from "./workbench/state";

export function App(): React.ReactElement {
  const [app, setApp] = useState(createInitialAppState);
  const taskState = useAppWorkbenchTaskState();
  const {
    goal,
    setGoal,
    attachments,
    setAttachments,
  } = taskState;
  const shellState = useAppShellState();
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    conversationFollowUpMode,
    inputCloseSignal,
    setInputCloseSignal,
  } = shellState;
  const runtime = useAppWorkbenchRuntime({
    app,
    setApp,
    setGoal,
    goal,
    attachments,
    setAttachments,
    setInputCloseSignal,
  });
  const {
    bootstrap,
    retryBootstrap,
    currentRun,
    contextUsage,
    modelResponding,
    pendingConfirmation,
    confirmationBusy,
    contextBusy,
    pendingConversationIds,
    runActions,
    sidebarActions,
    composerActions,
  } = runtime;
  const {
    startTask,
    cancelRun,
    decideConfirmation,
  } = runActions;
  const {
    selectAttachment,
    uploadAttachments,
    removeAttachment,
  } = composerActions;
  useAppShellEffects({
    sidebarCollapsed,
    persistSidebarCollapsed: persistSidebarCollapsedPreference,
  });
  const {
    enqueueMessage,
    queuedMessages,
    removeQueuedMessage,
    updateQueuedMessage,
    clearQueuedMessages,
    guideQueuedMessage,
  } = useAppQueuedMessages({
    busy: app.busy,
    queueScopeId: app.conversation?.conversationId ?? currentRun.run?.conversationId,
    currentRun: currentRun.run,
    startTask,
  });
  const { inputProps: baseInputProps } = workbenchInputPropsFrom({
    goal,
    setGoal,
    attachments,
    selectAttachment,
    uploadAttachments,
    removeAttachment,
    contextBusy,
    busy: app.busy,
    contextUsage,
    closeSignal: inputCloseSignal,
    enqueueMessage,
    startTask,
    clearQueuedMessages,
    cancelRun,
    modelResponding,
    followUpMode: conversationFollowUpMode,
  });
  const inputProps = {
    ...baseInputProps,
    queuedMessages,
    onRemoveQueuedMessage: removeQueuedMessage,
    onUpdateQueuedMessage: updateQueuedMessage,
    onGuideQueuedMessage: guideQueuedMessage,
  };
  const startNewConversation = useCallback(() => {
    clearQueuedMessages();
    return runActions.startNewConversation();
  }, [clearQueuedMessages, runActions.startNewConversation]);
  const openConversation = useCallback((conversationId: string) => {
    clearQueuedMessages();
    return runActions.loadConversation(conversationId);
  }, [clearQueuedMessages, runActions.loadConversation]);
  const resetConversation = useCallback(() => {
    clearQueuedMessages();
    runActions.resetChat();
  }, [clearQueuedMessages, runActions.resetChat]);

  return (
    <PersonalWorkbench
      bootstrapState={{
        status: bootstrap.status,
        ...(bootstrap.status === "error" ? { error: bootstrap.message } : {}),
        onRetry: retryBootstrap,
      }}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      conversation={app.conversation}
      conversations={app.conversations}
      currentRun={currentRun}
      inputProps={inputProps}
      error={app.error}
      onDismissError={() => setApp((previous) => ({ ...previous, error: undefined }))}
      pendingConfirmation={pendingConfirmation}
      confirmationBusy={confirmationBusy}
      onDecision={(decision, guidance) => void decideConfirmation(decision, guidance)}
      onStartNewConversation={startNewConversation}
      onResetConversation={resetConversation}
      onOpenConversation={openConversation}
      pendingConversationIds={pendingConversationIds}
      onRenameConversation={sidebarActions.renameConversation}
      onToggleConversationPinned={sidebarActions.toggleConversationPinned}
      onDeleteConversation={sidebarActions.deleteConversation}
    />
  );
}
