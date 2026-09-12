import React, { useCallback, useState } from "react";
import { PersonalWorkbench } from "./personal-workbench/personal-workbench";
import { useAppShellEffects } from "./shell/effects";
import { persistSidebarCollapsedPreference, useAppShellState } from "./shell/state";
import { useAppQueuedMessages } from "./features/conversations/queued-message-state";
import { useAppWorkbenchConfigState } from "./features/settings/workbench-config-state";
import { useAppWorkbenchRuntime } from "./workbench/runtime";
import { workbenchSettingsDialogPropsFrom } from "./features/settings/controllers/dialog-props";
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
  const configState = useAppWorkbenchConfigState(app);
  const {
    aiMode,
    modelForm,
    setModelForm,
    composerReasoningEffort,
    setComposerReasoningEffort,
    setComposerSelectedModelId,
    modelCatalogs,
    setModelCatalogs,
    ordinaryAgentSystemPrompt,
    setOrdinaryAgentSystemPrompt,
    modelOptions,
    selectedModelId,
    selectedModelSupportsReasoningEffort,
    selectedModelContextWindowTokens,
  } = configState;
  const shellState = useAppShellState();
  const {
    settingsOpen,
    settingsGroup,
    sidebarCollapsed,
    setSidebarCollapsed,
    modelUsageDisplayEnabled,
    setModelUsageDisplayEnabled,
    developerModeEnabled,
    conversationFollowUpMode,
    inputCloseSignal,
    setInputCloseSignal,
    openSettings,
    closeSettings,
    changeModelUsageDisplay,
    changeDeveloperMode,
  } = shellState;
  const runtime = useAppWorkbenchRuntime({
    app,
    setApp,
    setGoal,
    goal,
    aiMode,
    composerReasoningEffort,
    setComposerSelectedModelId,
    modelForm,
    setModelForm,
    setModelCatalogs,
    setOrdinaryAgentSystemPrompt,
    attachments,
    setAttachments,
    selectedModelId,
    selectedModelSupportsReasoningEffort,
    selectedModelContextWindowTokens,
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
    savingModel,
    savingOrdinaryAgentPrompt,
    runActions,
    sidebarActions,
    settingsController,
    composerActions,
  } = runtime;
  const {
    startTask,
    cancelRun,
    decideConfirmation,
  } = runActions;
  const {
    selectInputModel,
    selectAttachment,
    uploadAttachments,
    removeAttachment,
  } = composerActions;
  useAppShellEffects({
    sidebarCollapsed,
    persistSidebarCollapsed: persistSidebarCollapsedPreference,
    setModelUsageDisplayEnabled,
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
    models: modelOptions,
    selectedModelId,
    contextUsage,
    reasoningEffort: composerReasoningEffort,
    reasoningEffortEnabled: selectedModelSupportsReasoningEffort,
    onReasoningEffortChange: setComposerReasoningEffort,
    closeSignal: inputCloseSignal,
    onModelSelect: selectInputModel,
    onOpenSettings: () => openSettings("models"),
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

  const settingsDialogProps = workbenchSettingsDialogPropsFrom({
    settingsOpen,
    closeSettings,
    settingsGroup,
    app,
    forms: {
      ordinaryAgentSystemPrompt,
      setOrdinaryAgentSystemPrompt,
    },
    preferences: {
      developerModeEnabled,
      onDeveloperModeChange: changeDeveloperMode,
    },
    saving: {
      ordinaryAgent: savingOrdinaryAgentPrompt,
    },
    actions: settingsController,
  });
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
      showModelUsage={modelUsageDisplayEnabled}
      developerModeEnabled={developerModeEnabled}
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
      onOpenSettings={() => openSettings("models")}
      settingsDialogProps={settingsDialogProps}
    />
  );
}
