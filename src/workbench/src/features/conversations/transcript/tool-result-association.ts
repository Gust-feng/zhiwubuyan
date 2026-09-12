import type { PanelToolCallResult as ToolCallResult } from "@api-contracts/ordinary-agent";
import type { ActivityItem } from "@api-contracts/ui-read-model";
import type { TranscriptNode } from "../../../contracts/run";

export function toolResultForActivity(
  item: ActivityItem,
  nodes: readonly TranscriptNode[],
  toolResultsByRunId: Readonly<Record<string, readonly ToolCallResult[]>>,
): ToolCallResult | undefined {
  if (item.toolInvocationId === undefined) return undefined;
  const runId = nodes.find((node) => node.nodeId === item.nodeId)?.runId;
  if (runId === undefined) return undefined;
  return toolResultsByRunId[runId]?.find((result) => result.invocationId === item.toolInvocationId);
}