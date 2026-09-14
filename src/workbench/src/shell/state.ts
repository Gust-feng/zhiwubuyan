import { useState, type Dispatch, type SetStateAction } from "react";
import { readLocalPreference, writeLocalPreference } from "./local-preferences";
import { getConversationFollowUpMode } from "../features/conversations/follow-up-preference";
import type { ConversationFollowUpMode } from "../contracts/composer";

export type AppShellState = {
  readonly sidebarCollapsed: boolean;
  readonly setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  readonly conversationFollowUpMode: ConversationFollowUpMode;
  readonly pinningConversationIds: ReadonlySet<string>;
  readonly setPinningConversationIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  readonly inputCloseSignal: number;
  readonly setInputCloseSignal: Dispatch<SetStateAction<number>>;
};

export function useAppShellState(): AppShellState {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsedPreference);
  const [conversationFollowUpMode] = useState(getConversationFollowUpMode);
  const [pinningConversationIds, setPinningConversationIds] = useState<ReadonlySet<string>>(() => new Set());
  const [inputCloseSignal, setInputCloseSignal] = useState(0);

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    conversationFollowUpMode,
    pinningConversationIds,
    setPinningConversationIds,
    inputCloseSignal,
    setInputCloseSignal,
  };
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "shell.sidebar-collapsed";

function loadSidebarCollapsedPreference(): boolean {
  return readLocalPreference(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

export function persistSidebarCollapsedPreference(collapsed: boolean): void {
  writeLocalPreference(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
}
