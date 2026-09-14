import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CurrentRunProjection } from "../../features/conversations/run/projection";
import { projectChatActiveView } from "../../features/conversations/transcript/live-view";
import type { ChatInputProps } from "../../contracts/composer";
import { WorkbenchBootstrapLoading } from "../../components/workbench-bootstrap-loading";
import type { Conversation, ConversationSummary } from "../../contracts/conversation";
import type { PendingConfirmation } from "../../contracts/run";

import { SurfaceErrorBoundary } from "./app/components/SurfaceErrorBoundary";



import { Sidebar } from "./app/components/Sidebar";

import { ConversationSurface } from "./app/components/ConversationSurface";
import { WorkbenchConversationPane } from "./app/components/WorkbenchConversationPane";
import { WorkbenchPanes } from "./app/components/WorkbenchPanes";
import { WorkbenchViewRenderer } from "./app/components/WorkbenchViewRenderer";
import { WorkbenchViewTransition } from "./app/components/WorkbenchViewTransition";
import { WorkbenchStatusCenter, type WorkbenchStatusNotice } from "./app/components/WorkbenchStatusCenter";
import { projectLiveConversationState } from "./app/components/conversation-surface-state";
import type { WorkbenchView } from "../../workbench/navigation-state";
import { useWorkbenchNavigation } from "../../workbench/use-workbench-navigation";
import { useConversationMode } from "../../workbench/use-conversation-mode";
import { useWorkbenchEnvironment } from "../../workbench/use-workbench-environment";
import { useWorkbenchLayout, type WorkbenchLayoutMode } from "../../workbench/use-workbench-layout";
import { useWorkbenchSurface, WorkbenchSurfaceProvider } from "../../workbench/surface";
import { ZhihuSessionProvider } from "../../workbench/zhihu-account";
import { EntrySeedsPrimer } from "../../workbench/entry-seeds-primer";
import { ZhihuLoginProvider } from "../../features/auth/login-request";
import { PreviewLayoutContext } from "../../workbench/preview-layout";

export type PersonalWorkbenchProps = {
  readonly personalKnowledgePersistenceEnabled?: boolean;
  readonly bootstrapState: {
    readonly status: "loading" | "ready" | "retrying" | "error";
    readonly error?: string;
    readonly onRetry: () => void;
  };
  readonly sidebarCollapsed: boolean;
  readonly onToggleSidebar: () => void;
  readonly conversation?: Conversation;
  readonly conversations: readonly ConversationSummary[];
  readonly currentRun: CurrentRunProjection;
  readonly inputProps: ChatInputProps;
  readonly error?: string;
  readonly onDismissError?: () => void;
  readonly pendingConfirmation?: PendingConfirmation | NonNullable<CurrentRunProjection["workView"]>["pendingConfirmation"];
  readonly confirmationBusy: boolean;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly onStartNewConversation: () => Promise<boolean>;
  readonly onResetConversation: () => void;
  readonly onOpenConversation: (conversationId: string) => boolean | Promise<boolean>;
  readonly pendingConversationIds?: ReadonlySet<string>;
  readonly onRenameConversation: (conversationId: string, title: string) => void | Promise<void>;
  readonly onToggleConversationPinned: (conversationId: string, pinned: boolean) => void | Promise<void>;
  readonly onDeleteConversation: (conversationId: string) => void | Promise<void>;
};

/** Reading navigation and the canonical conversation share one stable workbench layout. */
export function PersonalWorkbench(props: PersonalWorkbenchProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const navigation = useWorkbenchNavigation();
  const {
    state: navigationState,
    navigate: reduceNavigation,
    openVoices,
    openSearch,
    focusHomeInput,
  } = navigation;
  const {
    view,
    researchTaskId,
    homeFocusRequest,
    voicesIssue,
    search: searchRequest,
  } = navigationState;
  const navigationIntentRef = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  // 异步提交/打开会话的 .then 可能晚于本次 render 执行，这里始终镜像最新事实。
  const activeConversation = props.conversation;
  const visibleConversation = activeConversation;
  const conversationProjection = projectConversationSurface(props, visibleConversation);
  const conversationState = projectLiveConversationState({
    projection: conversationProjection,
    error: visibleConversation === undefined ? undefined : props.error,
    runStatus: visibleConversation === undefined ? undefined : props.currentRun.run?.status,
  });
  const { knowledgeLoadState, knowledgeError, retryKnowledge, refreshKnowledge, dismissKnowledgeError } = useWorkbenchEnvironment({
    rootRef,
    personalKnowledgePersistenceEnabled: props.personalKnowledgePersistenceEnabled === true,
  });
  const layout = useWorkbenchLayout();
  const { surface } = useWorkbenchSurface();
  // 一级内容页与个人档案都是单一阅读表面，不带右侧对话分栏。
  const singleSurfaceView = view === "home" || view === "search" || view === "explore" || view === "mine" || view === "ask";
  // 网页端没有本地会话，右侧对话分栏无从加载，整站按单一阅读面呈现。
  const layoutMode = surface === "web" || singleSurfaceView ? "reading" : layout.mode;
  const conversationItems = props.conversations;
  const { mode: conversationMode, setMode: setConversationMode } = useConversationMode(rootRef);

  const revealConversation = useCallback((): void => {
    layout.showConversation();
  }, [layout.showConversation]);

  const activateReading = useCallback(() => {
    navigationIntentRef.current += 1;
    layout.showReading();
  }, [layout.showReading]);

  const openReadingPreview = useCallback(() => {
    activateReading();
  }, [activateReading]);

  // 启动恢复只在挂载后执行一次；没有可恢复的表面时，工作台停留在首页。
  const startupRecoveryAttemptedRef = useRef(false);
  useEffect(() => {
    if (startupRecoveryAttemptedRef.current) return;
    startupRecoveryAttemptedRef.current = true;
    if (!requiresImmediateConversationView(props)) return;
    revealConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 启动恢复只执行一次，闭包读取挂载时事实
  }, []);

  const navigate = (target: WorkbenchView, targetResearchTaskId?: string | null): void => {
    // Record explicit intent synchronously so an already-resolving home
    // submission cannot navigate back after the user chose another surface.
    navigationIntentRef.current += 1;
    viewRef.current = target;
    const updateNavigation = (): void => {
      reduceNavigation(target, targetResearchTaskId);
      if (target === "home") layout.setMode("reading");
      else layout.showReading();
    };
    if (conversationMode === "focus") {
      setConversationMode("normal", updateNavigation);
      return;
    }
    updateNavigation();
  };

  const homeInput = useMemo<ChatInputProps>(() => ({
    ...props.inputProps,
    autoFocus: view === "home",
    placeholder: "想从哪里开始？",
    onSubmit: () => {
      if (props.inputProps.value.trim().length === 0) return;
      const intent = navigationIntentRef.current;
      void props.onStartNewConversation().then((started) => {
        if (navigationIntentRef.current !== intent) return;
        if (started) {
          revealConversation();
        } else if (viewRef.current === "home") {
          focusHomeInput();
        }
      });
    },
  }), [view, props.inputProps, props.onStartNewConversation, revealConversation, focusHomeInput]);

  /** Open an existing Conversation and let the host select its presentation surface. */
  const openConversationInSurface = useCallback(async (conversationId: string): Promise<boolean> => {
    const intent = navigationIntentRef.current;
    const opened = await props.onOpenConversation(conversationId);
    if (opened === false) return false;
    if (navigationIntentRef.current === intent) revealConversation();
    return true;
  }, [props.onOpenConversation, revealConversation]);

  const conversationInput = useMemo<ChatInputProps>(() => ({
    ...props.inputProps,
    // Browsing and layout changes never take focus away from the reader.
    autoFocus: false,
    busy: props.inputProps.busy,
    allowInputWhileBusy: props.inputProps.allowInputWhileBusy,
    placeholder: visibleConversation !== undefined ? "继续对话..." : "从一个想法开始",
    onSubmit: visibleConversation !== undefined ? props.inputProps.onSubmit : () => {
      if (props.inputProps.value.trim().length === 0) return;
      const intent = navigationIntentRef.current;
      void props.onStartNewConversation().then((started) => {
        if (started && navigationIntentRef.current === intent) revealConversation();
      });
    },
  }), [visibleConversation, props.inputProps, props.onStartNewConversation, revealConversation]);
  const newConversation = () => {
    if (props.inputProps.busy || props.inputProps.running === true) return;
    navigationIntentRef.current += 1;
    props.onResetConversation();
    layout.showConversation();
  };
  const changeLayout = (mode: WorkbenchLayoutMode): void => {
    if (mode === "split" && layout.compact) return;
    if (mode === (layout.splitEnabled ? "split" : layoutMode)) return;
    navigationIntentRef.current += 1;
    if (mode === "reading" && rootRef.current?.querySelector(".ui-workbench-conversation")?.contains(document.activeElement)) {
      const trigger = rootRef.current.querySelector<HTMLButtonElement>('[data-split-toggle]')
        ?? rootRef.current.querySelector<HTMLButtonElement>('[data-explorer-toggle]');
      trigger?.focus({ preventScroll: true });
    }
    layout.setMode(mode);
  };
  const toggleCollaboration = (): void => {
    const opening = !layout.splitEnabled;
    if (opening && !props.sidebarCollapsed) props.onToggleSidebar();
    changeLayout(opening ? "split" : "reading");
  };
  const statusNotices = useMemo<readonly WorkbenchStatusNotice[]>(() => {
    const notices: WorkbenchStatusNotice[] = [];
    if (props.bootstrapState.status === "error") {
      notices.push({
        id: "bootstrap-error",
        message: props.bootstrapState.error ?? "工作台启动数据加载失败。",
        onRetry: props.bootstrapState.onRetry,
      });
    }
    if (props.bootstrapState.status === "retrying") {
      notices.push({ id: "bootstrap-retrying", message: "正在重新连接工作台...", retrying: true });
    }
    if (props.bootstrapState.status === "ready" && knowledgeLoadState.status === "error") {
      notices.push({
        id: "knowledge-load-error",
        message: knowledgeLoadState.message,
        onRetry: () => void retryKnowledge().catch(() => undefined),
      });
    }
    if (props.bootstrapState.status === "ready" && knowledgeLoadState.status === "ready" && knowledgeError !== undefined) {
      notices.push({
        id: "knowledge-refresh-error",
        message: knowledgeError,
        onRetry: () => void refreshKnowledge().catch(() => undefined),
        onDismiss: dismissKnowledgeError,
      });
    }
    if (props.error !== undefined && props.bootstrapState.status === "ready" && knowledgeError === undefined) {
      notices.push({ id: "conversation-error", message: props.error, onDismiss: props.onDismissError });
    }
    return notices;
  }, [
    dismissKnowledgeError,
    knowledgeError,
    knowledgeLoadState,
    props.bootstrapState,
    props.error,
    props.onDismissError,
    refreshKnowledge,
    retryKnowledge,
  ]);
  const showLoadingFallback = props.bootstrapState.status === "loading" && view !== "home";
  return (
    <WorkbenchSurfaceProvider>
    <div
      ref={rootRef}
      className="ui-workbench-root flex h-screen min-h-0 w-full overflow-hidden"
      spellCheck={false}
      style={{
        backgroundColor: "var(--ui-canvas)",
        color: "var(--ui-text-1)",
        fontFamily: '"Noto Sans SC", Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      <ZhihuSessionProvider>
      {/* 尽早开始生成两个入口的种子，不等用户打开入口。 */}
      <EntrySeedsPrimer />
      <ZhihuLoginProvider>
      <style>{`
        @keyframes viewFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .ui-workbench-root .view-enter { animation: viewFadeIn 140ms ease; }
      `}</style>
      <Sidebar
        view={view}
        collapsed={props.sidebarCollapsed}
        onNavigate={navigate}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main
          aria-label={viewLabel(view)}
          className="ui-workbench-main flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <WorkbenchPanes
            mode={layoutMode}
            onActivePaneChange={layout.setActivePane}
            onContentResize={layout.onContentResize}
            reading={<PreviewLayoutContext.Provider value={{
              splitEnabled: layout.splitEnabled,
              canSplit: !layout.compact,
              onToggleSplit: toggleCollaboration,
            }}><WorkbenchViewTransition view={view}>
            {showLoadingFallback ? <WorkbenchBootstrapLoading /> : (
              <SurfaceErrorBoundary resetKey={view} label="这个视图暂时无法打开">
                  <WorkbenchViewRenderer
                    view={view}
                    conversations={props.conversations}
                    onOpenConversation={openConversationInSurface}
                    explorerCollapsed={layout.explorerCollapsed}
                    onActivateReading={activateReading}
                    onOpenPreview={openReadingPreview}
                    homeInput={homeInput}
                    homeFocusRequest={homeFocusRequest}
                    researchTaskId={researchTaskId}
                    voicesIssue={voicesIssue}
                    searchRequest={searchRequest}
                    onOpenVoices={openVoices}
                    onOpenSearch={openSearch}
                    navigate={navigate}
                  />
              </SurfaceErrorBoundary>
            )}
          </WorkbenchViewTransition></PreviewLayoutContext.Provider>}
            conversation={<WorkbenchConversationPane
              conversation={visibleConversation}
              conversations={conversationItems}
              visible={layoutMode !== "reading"}
              pendingIds={props.pendingConversationIds ?? EMPTY_ID_SET}
              onOpen={openConversationInSurface}
              onRename={props.onRenameConversation}
              onTogglePinned={props.onToggleConversationPinned}
              onDelete={props.onDeleteConversation}
              newConversationDisabled={props.inputProps.busy || props.inputProps.running === true}
              onNewConversation={newConversation}
              onClose={layout.splitEnabled ? () => changeLayout("reading") : undefined}
              onEnterFocus={() => setConversationMode("focus")}
            >
              <ConversationSurface
                conversation={visibleConversation}
                projection={conversationProjection}
                state={conversationState}
                input={conversationInput}
                currentRun={props.currentRun}
                confirmationBusy={props.confirmationBusy}
                onDecision={props.onDecision}
                focus={conversationMode === "focus"}
                onExitFocus={() => setConversationMode("normal")}
              />
            </WorkbenchConversationPane>}
          />
        </main>
      </div>

      <WorkbenchStatusCenter notices={statusNotices} />

      </ZhihuLoginProvider>
      </ZhihuSessionProvider>
    </div>
    </WorkbenchSurfaceProvider>
  );
}

function viewLabel(view: WorkbenchView): string {
  switch (view) {
    case "home": return "首页";
    case "search": return "检索";
    case "explore": return "探索";
    case "ask": return "深度研究";
    case "voices": return "众声";
    case "imagery": return "成象";
    case "mine": return "我的知乎";
  }
}

const EMPTY_ID_SET: ReadonlySet<string> = new Set();

function projectConversationSurface(
  props: PersonalWorkbenchProps,
  conversation: Conversation | undefined,
) {
  return projectChatActiveView({
    conversation,
    run: conversation === undefined ? undefined : props.currentRun.run,
    workView: conversation === undefined ? undefined : props.currentRun.workView,
    transcriptNodes: conversation === undefined ? [] : props.currentRun.transcriptNodes,
    detail: conversation === undefined ? undefined : props.currentRun.detail,
    live: conversation === undefined ? undefined : props.currentRun.live,
    error: conversation === undefined ? undefined : props.error,
    pendingConfirmation: conversation === undefined ? undefined : props.pendingConfirmation,
  });
}

function requiresImmediateConversationView(props: Pick<PersonalWorkbenchProps, "currentRun" | "pendingConfirmation">): boolean {
  return props.pendingConfirmation !== undefined
    || props.currentRun.run?.status === "running";
}
