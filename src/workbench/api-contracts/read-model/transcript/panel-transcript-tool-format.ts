export type CommandDisplayProjectionLike = {
  readonly kind: "command_summary";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly commandLine?: string;
};

export function commandText(display: CommandDisplayProjectionLike): string | undefined {
  if (typeof display.commandLine === "string" && display.commandLine.trim().length > 0) {
    return display.commandLine.trim();
  }
  const parts = [display.command, ...(display.args ?? [])]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return parts.length === 0 ? undefined : parts.join(" ");
}

export function genericItemLabel(value: string): string {
  return value.replace(/^(?:file|dir|directory|item)\s+/i, "").trim() || value;
}