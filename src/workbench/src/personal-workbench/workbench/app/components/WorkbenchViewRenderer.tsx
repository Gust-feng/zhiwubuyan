import { useEffect, useRef } from "react";
import type { ChatInputProps } from "../../../../contracts/composer";
import type { ConversationSummary } from "../../../../contracts/conversation";
import { isEntryView } from "../../../../components/entry-surface/entry-surface";
import { useWorkbenchSurface } from "../../../../workbench/surface";
import { useZhihuLogin } from "@ui/features/auth/login-request";
import { useZhihuSession } from "@ui/workbench/zhihu-account";
import { EntryViews } from "./EntryViews";
import { ExplorePage } from "./ExplorePage";
import { HomePage } from "./HomePage";
import { MinePage } from "./MinePage";
import { SearchPage } from "./SearchPage";
import type { WorkbenchSearchRequest, WorkbenchView } from "../../../../workbench/navigation-state";
import type { HomeFeedScope } from "./use-home-feed";

export type WorkbenchViewRendererProps = {
  readonly view: WorkbenchView;
  readonly conversations: readonly ConversationSummary[];
  readonly onOpenConversation: (conversationId: string) => boolean | Promise<boolean>;
  readonly explorerCollapsed: boolean;
  readonly onActivateReading: () => void;
  readonly onOpenPreview: () => void;
  readonly homeInput: ChatInputProps;
  readonly homeFocusRequest: number;
  readonly researchTaskId: string | null;
  readonly voicesIssue: string | null;
  readonly searchRequest: WorkbenchSearchRequest | null;
  readonly onOpenVoices: (issue: string) => void;
  readonly onOpenSearch: (query: string, scope: HomeFeedScope) => void;
  readonly navigate: (view: WorkbenchView, researchTaskId?: string | null) => void;
};

export function WorkbenchViewRenderer(input: WorkbenchViewRendererProps): React.ReactElement | null {
  const surface = useWorkbenchSurface();
  const { openLogin } = useZhihuLogin();
  const { state: sessionState } = useZhihuSession();
  // 需要登录的板块：确认未登录后拉起统一登录弹窗（只自动拉一次，关闭后不再反复弹）；
  // 会话仍在确认时只给加载态，避免已登录用户看到一次弹窗闪烁。
  const loginRequired = surface.requiresLogin(input.view);
  const unauthenticated = sessionState.status === "ready" && !sessionState.session.authenticated;
  const openedLoginRef = useRef(false);
  useEffect(() => {
    if (!(loginRequired && unauthenticated) || openedLoginRef.current) return;
    openedLoginRef.current = true;
    openLogin(input.view);
  }, [loginRequired, unauthenticated, openLogin, input.view]);
  if (input.view === "home") {
    return <HomePage onOpenVoices={input.onOpenVoices} onOpenSearch={input.onOpenSearch} />;
  }
  if (input.view === "search") {
    return input.searchRequest === null
      ? null
      : <SearchPage request={input.searchRequest} onBack={() => input.navigate("home")} />;
  }
  if (input.view === "explore") {
    return <ExplorePage />;
  }
  if (loginRequired && !unauthenticated) {
    return (
      <div className="ui-view">
        <div className="ui-view__frame">
          <div className="ui-view__sub" role="status">
            {sessionState.status === "error" ? sessionState.message : "正在确认登录状态…"}
          </div>
        </div>
      </div>
    );
  }
  if (loginRequired && unauthenticated) {
    // 弹窗由 ZhihuLoginProvider 渲染；这里只给底页一个可读的空态，不放第二套登录版式。
    return (
      <div className="ui-view">
        <div className="ui-view__frame">
          <div className="ui-view__sub" role="status">登录后即可使用这个板块。</div>
        </div>
      </div>
    );
  }
  // 深度研究与众声的入口同版式，交给常驻的 EntryViews 做逐格替换；
  // 同一个组件实例跨这两个视图保留，所以外壳不会重建。
  if (isEntryView(input.view)) {
    return <EntryViews view={input.view} researchTaskId={input.researchTaskId} voicesIssue={input.voicesIssue} />;
  }
  if (input.view === "mine") {
    return <MinePage />;
  }
  return null;
}
