export function parseJsonPreserveIntegers(text: string): unknown {
  const chunks: string[] = [];
  const rewritten = text.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token) => {
    if (token.startsWith("\"")) return token;
    if (!/^-?\d+$/.test(token)) return token;
    if (token.length < 16) return token;
    const index = chunks.push(token) - 1;
    return `"__int64:${index}__"`;
  });
  return reviveIntegers(JSON.parse(rewritten), chunks);
}

function reviveIntegers(value: unknown, chunks: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => reviveIntegers(item, chunks));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = reviveIntegers(item, chunks);
    }
    return result;
  }
  if (typeof value === "string") {
    const match = /^__int64:(\d+)__$/.exec(value);
    if (match) return chunks[Number(match[1])] ?? value;
  }
  return value;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return "";
}

export function readOptionalString(value: unknown): string | undefined {
  const text = readString(value).trim();
  return text.length > 0 ? text : undefined;
}

export function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function readInt64String(value: unknown): string | undefined {
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return undefined;
}
