import type { ContextWindowUsage } from "../features/conversations/context-window-usage";
import type { ContextAttachment } from "./context";

export type QueuedChatMessage = {
  readonly id: string;
  readonly content: string;
};

export type ConversationFollowUpMode = "guide" | "queue";

type AttachmentInputProps = {
  readonly attachments: readonly ContextAttachment[];
  readonly onSelectAttachment: () => void;
  readonly onUploadAttachmentFiles?: (files: readonly File[]) => void | Promise<void>;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly contextBusy?: boolean;
};

export type ChatInputProps = AttachmentInputProps & {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly busy: boolean;
  readonly allowInputWhileBusy?: boolean;
  readonly contextUsage?: ContextWindowUsage;
  readonly onSubmit: () => void;
  readonly onCancel?: () => void;
  readonly cancelLabel?: string;
  readonly autoFocus?: boolean;
  readonly running?: boolean;
  readonly placeholder?: string;
  readonly variant?: "embedded" | "floating";
  readonly queuedMessages?: readonly QueuedChatMessage[];
  readonly onRemoveQueuedMessage?: (id: string) => void;
  readonly onUpdateQueuedMessage?: (id: string, content: string) => void;
  readonly onGuideQueuedMessage?: (id: string) => Promise<boolean> | void;
  readonly closeSignal?: number;
};