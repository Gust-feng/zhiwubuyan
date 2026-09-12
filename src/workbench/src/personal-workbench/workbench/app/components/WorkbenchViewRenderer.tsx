import type { ChatInputProps } from "../../../../contracts/composer";
import type { ConversationSummary } from "../../../../contracts/conversation";
import { ResearchPage } from "../../../../features/deep-research/research-page";
import { BrainPage } from "./BrainPage";
import { BriefsPage } from "./BriefsPage";
import { CirclesPage } from "./CirclesPage";
import { HomePage } from "./HomePage";
import { MinePage } from "./MinePage";
import { SearchPage } from "./SearchPage";
import { VoicesPage } from "./VoicesPage";
import type { WorkbenchView } from "../../../../workbench/navigation-state";

export type WorkbenchViewRendererProps = {
  readonly view: WorkbenchView;
  readonly conversations: readonly ConversationSummary[];
  readonly onOpenConversation: (conversationId: string) => boolean | Promise<boolean>;
  readonly explorerCollapsed: boolean;
  readonly onActivateReading: () => void;
  readonly onOpenPreview: () => void;
  readonly homeInput: ChatInputProps;
  readonly homeFocusRequest: number;
  readonly brainSelectedId: string | null;
  readonly mineSelectedNoteId: string | null;
  readonly onMineNoteSelect: (id: string | null) => void;
  readonly onBrainSelect: (id: string | null) => void;
  readonly researchTaskId: string | null;
  readonly navigate: (view: WorkbenchView, researchTaskId?: string | null) => void;
};

export function WorkbenchViewRenderer(input: WorkbenchViewRendererProps): React.ReactElement | null {
  const openResearchTask = (taskId: string): void => input.navigate("ask", taskId);
  if (input.view === "home") {
    return (
      <HomePage
        onOpenSearch={() => input.navigate("search")}
        onNavigate={input.navigate}
        onOpenResearchTask={openResearchTask}
      />
    );
  }
  if (input.view === "ask") {
    return <ResearchPage taskId={input.researchTaskId} />;
  }
  if (input.view === "voices") {
    return <VoicesPage />;
  }
  if (input.view === "circles") {
    return <CirclesPage />;
  }
  if (input.view === "briefs") {
    return <BriefsPage onOpenResearchTask={openResearchTask} />;
  }
  if (input.view === "mine") {
    return <MinePage onExit={() => input.navigate("home")} initialNoteId={input.mineSelectedNoteId} onNoteSelectionChange={input.onMineNoteSelect} />;
  }
  if (input.view === "brain") {
    return <BrainPage
      selectedId={input.brainSelectedId}
      onSelect={input.onBrainSelect}
      explorerCollapsed={input.explorerCollapsed}
      onActivateReading={input.onActivateReading}
    />;
  }
  if (input.view === "search") {
    return <SearchPage
      onOpenNote={(id) => {
        input.onMineNoteSelect(id);
        input.navigate("mine");
      }}
      onOpenConversation={input.onOpenConversation}
      conversations={input.conversations}
    />;
  }
  return null;
}
