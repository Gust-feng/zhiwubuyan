import type {
  AppConversationState,
  AppRunObservationState,
} from "./state-domains";
export type {
  AppConversationState,
  AppRunObservationState,
} from "./state-domains";

export type AppState =
  & AppConversationState
  & AppRunObservationState;

export function createInitialAppState(): AppState {
  return {
    conversations: [],
    transcriptNodes: [],
    transcriptNodesByRunId: {},
    events: [],
    busy: false,
  };
}