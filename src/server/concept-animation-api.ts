import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AnimationRecord,
  type ConceptAnimationErrorCode,
  type ConceptAnimationResult,
} from "../contracts/concept-animation.ts";
import { ANIMATION_LIST_DEFAULT_LIMIT, type AnimationRecordStore, toAnimationRecord } from "../application/animation-records.ts";
import type { ConceptAnimationCommand } from "../application/concept-animation.ts";
import { readJsonLimited, readOptionalInt, writeJson } from "./http-utils.ts";

/**
 * 成象路由：生成、历史列表、单条读取与删除。
 *
 * 只做解析、调用应用命令、映射响应，不持有登录与身份——那两项由挂载方提供：
 * 本机运行面直接以固定 scope 调用；网页端由 zhihu-api 完成登录与限流后，
 * 传入会话派生的 scope，避免第二套认证/身份解析路径。
 */

export type ConceptAnimationApiDeps = {
  /** 每次请求新建生成命令；返回 null 表示当前运行面未配置模型。 */
  createCommand: () => ConceptAnimationCommand | null;
  store: AnimationRecordStore;
  now?: () => Date;
  nextId?: () => string;
  /** 请求体上限；生成请求很小，给一个保守值。 */
  maxBodyBytes?: number;
};

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const RECORDS_PATH = "/api/concept-animations";
const RECORD_PREFIX = `${RECORDS_PATH}/`;

export function createConceptAnimationApi(deps: ConceptAnimationApiDeps) {
  const now = deps.now ?? (() => new Date());
  const nextId = deps.nextId ?? (() => crypto.randomUUID());
  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async function handleConceptAnimationApi(
    scope: string,
    url: URL,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const pathname = url.pathname;

    // 生成：解析请求 → 生成 → 成功则落库 → 返回结果（含记录 id）。
    if (pathname === "/api/concept-animation" && request.method === "POST") {
      const command = deps.createCommand();
      if (command === null) {
        return writeJson(response, 503, {
          code: "ANIMATION_MODEL_NOT_CONFIGURED",
          message: "成象的模型尚未配置，请在服务端填写 ANIMATION_MODEL_* 或 MODEL_* 环境变量。",
        });
      }
      const body = await readJsonLimited(request, maxBodyBytes);
      const result = await command.generate(body);
      let recordId: string | null = null;
      if (result.status === "completed") {
        const record = toAnimationRecord({
          id: nextId(),
          topic: readTopic(body),
          instruction: readInstruction(body),
          createdAt: now().toISOString(),
          result,
        });
        await deps.store.save(scope, record);
        recordId = record.id;
      }
      return writeJson(response, result.status === "completed" ? 200 : errorStatus(result), {
        ok: result.status === "completed",
        data: result,
        ...(recordId === null ? {} : { recordId }),
      });
    }

    if (pathname === RECORDS_PATH && request.method === "GET") {
      const limit = readOptionalInt(url.searchParams.get("limit"), ANIMATION_LIST_DEFAULT_LIMIT);
      const offset = readOptionalInt(url.searchParams.get("offset"), 0);
      const list = await deps.store.list(scope, { limit, offset });
      return writeJson(response, 200, { ok: true, data: list });
    }

    if (pathname.startsWith(RECORD_PREFIX)) {
      const id = pathname.slice(RECORD_PREFIX.length);
      if (!id || id.includes("/")) return false;
      if (request.method === "GET") {
        const record = await deps.store.get(scope, id);
        if (record === undefined) return writeJson(response, 404, { code: "NOT_FOUND", message: "没有这条成象记录。" });
        return writeJson(response, 200, { ok: true, data: record });
      }
      if (request.method === "DELETE") {
        const removed = await deps.store.remove(scope, id);
        if (!removed) return writeJson(response, 404, { code: "NOT_FOUND", message: "没有这条成象记录。" });
        return writeJson(response, 200, { ok: true, data: { id } });
      }
    }

    return false;
  };
}

/** 生成失败时的 HTTP 状态映射，保留 429/504/502 语义，不一律拍成 400。 */
export function conceptAnimationErrorStatus(result: ConceptAnimationResult): number {
  return errorStatus(result);
}

function errorStatus(result: ConceptAnimationResult): number {
  const code: ConceptAnimationErrorCode | undefined = result.error?.code;
  if (code === "INVALID_INPUT") return 400;
  if (code === "RATE_LIMITED") return 429;
  if (code === "TIMEOUT") return 504;
  return 502;
}

function readTopic(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>).topic;
  return typeof value === "string" ? value.trim() : "";
}

function readInstruction(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>).instruction;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? undefined : trimmed;
}

/** 供挂载方在读取记录后做契约校验（路由只透传，不重复解析）。 */
export function parseAnimationRecord(value: unknown): AnimationRecord | undefined {
  const parsed = AnimationRecord.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
