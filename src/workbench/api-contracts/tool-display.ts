/**
 * 会话活动展示的只读数据形状（DTO）。
 * 这里只有"已发生事实"的展示形状，不包含任何执行、权限或目录能力。
 */

export type ToolFileDisplayOperation =
  | "create"
  | "write"
  | "append"
  | "edit"
  | "delete";

export type ToolFactValue =
  | null
  | string
  | number
  | boolean
  | readonly ToolFactValue[]
  | { readonly [key: string]: ToolFactValue | undefined };

export type PanelToolFactValue = ToolFactValue;

export type ToolErrorDomain =
  | "tool_error"
  | "runtime_error"
  | "model_error"
  | "ui_submit_error"
  | "process_error";

export type ToolErrorFacts = Readonly<Record<string, ToolFactValue>>;

/** 产生失败的工具调用阶段。 */
export type ToolFailureAttribution = "schema_validation" | "execution_failure";

export type DelegatedAgentUsage = {
  readonly requestCount?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly uncachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly estimatedCostUsd?: number;
};

/** 一次委派执行的事实记录，父运行拥有工具结果本身。 */
export type DelegatedAgentExecutionMetadata = {
  readonly modelRounds: number;
  readonly toolCallCount: number;
  readonly usage: DelegatedAgentUsage;
};

export type ToolDisplayCategory = "read" | "search" | "web" | "command" | "edit" | "other";

export type ToolDisplayResultFacts = {
  readonly truncated?: boolean;
  readonly continuation?: {
    readonly ref?: string;
    readonly nextInput?: ToolFactValue;
    readonly note?: string;
  };
};

export type ToolDisplayProjection = ToolDisplayResultFacts & (
  | { readonly kind: "search_results"; readonly query?: string; readonly message?: string; readonly results: readonly { readonly title: string; readonly url?: string; readonly source?: string }[] }
  | { readonly kind: "directory_listing"; readonly path?: string; readonly unreadableDirectories?: number; readonly unreadableSamples?: readonly { readonly path?: string; readonly errorCode?: string }[]; readonly entries: readonly { readonly path: string; readonly kind?: string }[] }
  | { readonly kind: "file_search_results"; readonly query?: string; readonly path?: string; readonly skippedUnreadableFiles?: number; readonly matches: readonly { readonly path: string; readonly line?: number; readonly preview?: string }[] }
  | { readonly kind: "read_result"; readonly title?: string; readonly url?: string; readonly uri?: string; readonly contentPreview?: string; readonly error?: string }
  | { readonly kind: "web_fetch"; readonly title?: string; readonly url?: string }
  | { readonly kind: "http_response"; readonly method?: string; readonly url?: string; readonly statusCode?: number; readonly statusText?: string; readonly bodyPreview?: string }
  | { readonly kind: "file_change_summary"; readonly path?: string; readonly operation?: ToolFileDisplayOperation; readonly preview?: string }
  | { readonly kind: "file_diff_preview"; readonly path?: string; readonly operation?: ToolFileDisplayOperation; readonly preview?: string }
  | { readonly kind: "file_change_group"; readonly files: readonly { readonly path: string; readonly operation?: ToolFileDisplayOperation; readonly preview?: string }[] }
  | { readonly kind: "command_summary"; readonly command?: string; readonly args?: readonly string[]; readonly commandLine?: string; readonly exitCode?: number; readonly timedOut?: boolean; readonly stdoutPreview?: string; readonly stderrPreview?: string }
  | { readonly kind: "agent_task"; readonly agentName?: string; readonly task?: string; readonly result?: string }
  | { readonly kind: "knowledge_operation"; readonly operation: "search" | "read" | "create_note" | "update_note" | "collect"; readonly status?: string; readonly query?: string; readonly spaceId?: string; readonly noteId?: string; readonly title?: string; readonly revision?: number; readonly count?: number; readonly items?: readonly { readonly noteId: string; readonly title?: string; readonly spaceId?: string; readonly revision?: number; readonly snippet?: string }[] }
  | { readonly kind: "space_operation"; readonly operation: "list" | "create" | "move" | "add_reference" | "mount" | "create_managed_folder" | "create_entry" | "rename_entry" | "delete_entry" | "update_caption" | "remove_reference" | "rename"; readonly status?: string; readonly spaceId?: string; readonly title?: string; readonly targetId?: string; readonly destinationSpaceId?: string; readonly count?: number; readonly items?: readonly { readonly spaceId: string; readonly title?: string; readonly folderCount?: number; readonly referenceItemCount?: number }[] }
  | { readonly kind: "note_operation"; readonly operation: "write"; readonly status?: string; readonly scope?: "global"; readonly characters?: number }
  | { readonly kind: "generic_tool_summary"; readonly category: ToolDisplayCategory; readonly action?: string; readonly summary?: string; readonly items?: readonly string[] }
  | { readonly kind: "raw_tool_result"; readonly toolName: string; readonly label: string; readonly value?: ToolFactValue }
);
