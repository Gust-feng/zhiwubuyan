import { randomUUID } from "node:crypto";
import type { OAuthToken } from "../platform/zhihu/oauth.ts";

/** 登录会话存储：OAuth token 只存服务端，cookie 只携带随机会话 ID。 */
export type SessionStore = {
  create(token: OAuthToken): Promise<string>;
  read(id: string | undefined, now: number): Promise<OAuthToken | undefined>;
  drop(id: string | undefined): Promise<void>;
};

/** 本地单进程实现：进程内存 Map，随令牌过期清扫。 */
export function createMemorySessionStore(): SessionStore {
  const store = new Map<string, OAuthToken>();
  return {
    async create(token) {
      const now = Date.now();
      for (const [id, session] of store) {
        if (now >= session.expiresAt) store.delete(id);
      }
      const id = randomUUID();
      store.set(id, token);
      return id;
    },
    async read(id, now) {
      if (!id) return undefined;
      const session = store.get(id);
      if (!session) return undefined;
      if (now >= session.expiresAt) {
        store.delete(id);
        return undefined;
      }
      return session;
    },
    async drop(id) {
      if (id) store.delete(id);
    },
  };
}

/** Vercel KV（Upstash Redis REST）的结构化子集；由调用方传入，避免本地开发加载 KV 依赖。 */
export type KvClient = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options: { ex: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

/** Vercel serverless 实现：实例间共享，TTL 与令牌同寿。 */
export function createKvSessionStore(kv: KvClient): SessionStore {
  const keyOf = (id: string) => `sess:${id}`;
  return {
    async create(token) {
      const id = randomUUID();
      const ttl = Math.max(1, Math.round((token.expiresAt - Date.now()) / 1000));
      await kv.set(keyOf(id), token, { ex: ttl });
      return id;
    },
    async read(id, now) {
      if (!id) return undefined;
      const value = await kv.get(keyOf(id));
      if (!value || typeof value !== "object") return undefined;
      const session = value as OAuthToken;
      if (typeof session.accessToken !== "string" || typeof session.expiresAt !== "number") return undefined;
      if (now >= session.expiresAt) {
        await kv.del(keyOf(id));
        return undefined;
      }
      return session;
    },
    async drop(id) {
      if (id) await kv.del(keyOf(id));
    },
  };
}
