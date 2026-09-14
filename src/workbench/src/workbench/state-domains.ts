import type { LiveRunBuffer } from "@api-contracts/ui-read-model";
import type { Conversation, ConversationSummary } from "../contracts/conversation";
import type {
  OrdinaryRun,
  OrdinaryRunDetail,
  OrdinaryWorkView,
  RunCapabilityResolution,
  RunEvent,
  TranscriptNode,
} from "../contracts/run";

/** Conversation summaries and the currently opened Ordinary conversation. */
export type AppConversationState = {
  readonly conversations: readonly ConversationSummary[];
  readonly conversation?: Conversation;
};

/** Agent Run facts and their observable transcript projection. */
export type AppRunObservationState = {
  readonly run?: OrdinaryRun;
  readonly workView?: OrdinaryWorkView;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly capabilityResolutionRunId?: string;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly transcriptNodesByRunId: Record<string, readonly TranscriptNode[]>;
  readonly events: readonly RunEvent[];
  readonly live?: LiveRunBuffer;
  readonly detail?: OrdinaryRunDetail;
  readonly busy: boolean;
  readonly error?: string;
};