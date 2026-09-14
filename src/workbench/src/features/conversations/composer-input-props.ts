import type {
  ChatInputProps,
  ConversationFollowUpMode,
} from "../../contracts/composer";
import type { ContextAttachment } from "../../contracts/context";
import type { ContextWindowUsage } from "./context-window-usage";

export type WorkbenchInputPropsOptions = {
  readonly goal: string;
  readonly setGoal: (value: string) => void;
  readonly attachments: readonly ContextAttachment[];
  readonly selectAttachment: () => void | Promise<void>;
  readonly uploadAttachments: (files: readonly File[]) => void | Promise<void>;
  readonly removeAttachment: (attachmentId: string) => void;
  readonly contextBusy: boolean;
  readonly busy: boolean;
  readonly contextUsage?: ContextWindowUsage;
  readonly closeSignal: number;
  readonly enqueueMessage: (content: string) => void;
  readonly startTask: (explicitGoal?: string) => void | Promise<boolean>;
  readonly clearQueuedMessages: () => void;
  readonly cancelRun: () => void | Promise<void>;
  readonly modelResponding: boolean;
  readonly followUpMode: ConversationFollowUpMode;
};

export type WorkbenchInputPropsViewModel = {
  readonly inputProps: ChatInputProps;
};

export function workbenchInputPropsFrom(
  options: WorkbenchInputPropsOptions,
): WorkbenchInputPropsViewModel {
  const inputProps: ChatInputProps = {
    value: options.goal,
    onChange: options.setGoal,
    attachments: options.attachments,
    onSelectAttachment: () => void options.selectAttachment(),
    onUploadAttachmentFiles: (files: readonly File[]) => void options.uploadAttachments(files),
    onRemoveAttachment: options.removeAttachment,
    contextBusy: options.contextBusy,
    busy: options.busy,
    running: options.modelResponding,
    contextUsage: options.contextUsage,
    closeSignal: options.closeSignal,
    onSubmit: () => {
      if (options.modelResponding && options.followUpMode === "guide") {
        options.setGoal("");
        void options.startTask();
      } else if (options.busy || options.modelResponding) {
        options.enqueueMessage(options.goal);
        options.setGoal("");
      } else {
        void options.startTask();
      }
    },
    allowInputWhileBusy: true,
    onCancel: () => {
      options.clearQueuedMessages();
      void options.cancelRun();
    },
  };
  return {
    inputProps,
  };
}
