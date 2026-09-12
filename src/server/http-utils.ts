import type { IncomingMessage, ServerResponse } from "node:http";
import { ProductError } from "../platform/zhihu/errors.ts";

export function writeJson(response: ServerResponse, status: number, body: unknown): boolean {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
  return true;
}

export function redirect(response: ServerResponse, status: number, location: string): void {
  response.writeHead(status, { Location: location });
  response.end();
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  return await readJsonLimited(request, 1_000_000);
}

export async function readJsonLimited(request: IncomingMessage, limitBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) throw new ProductError("INVALID_INPUT", "请求内容过大。");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ProductError("INVALID_INPUT", "请求内容不是合法 JSON。");
  }
}

export function asRequest(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductError("INVALID_INPUT", "请求内容必须是对象。");
  }
  return value as Record<string, unknown>;
}

export function readRequiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new ProductError("INVALID_INPUT", message);
  return value.trim();
}

/** 可选字符串：缺省、非字符串或空白一律返回 undefined，由应用层决定默认行为。 */
export function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function readOptionalInt(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function isSecureRequest(request: IncomingMessage): boolean {
  return request.headers["x-forwarded-proto"] === "https";
}

export const SESSION_COOKIE = "kanshan_session";

export function readSessionId(request: IncomingMessage): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    if (pair.slice(0, index).trim() === SESSION_COOKIE) {
      return decodeURIComponent(pair.slice(index + 1).trim());
    }
  }
  return undefined;
}

export function sessionCookie(id: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
