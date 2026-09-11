import { createRuntime } from "../application/runtime.ts";
import { isProductError, type ProductError } from "../platform/zhihu/errors.ts";
import type { FetchLike } from "../platform/zhihu/client.ts";

const QUESTION = "怎么理解 RAG";
const NOW = () => new Date("2026-09-11T12:00:00.000Z");

const successFetch = fixtureFetch({
  "/api/v1/content/zhihu_search": {
    Code: 0,
    Message: "success",
    Data: {
      HasMore: false,
      SearchHashId: "9007199254740993",
      Items: [{
        Title: "RAG 评测方法综述",
        ContentType: "Article",
        ContentID: "9007199254740993",
        ContentText: "本文介绍主流 RAG 评测框架",
        Url: "https://zhuanlan.zhihu.com/p/123456789",
        AuthorName: "张三",
      }],
    },
  },
  "/api/v1/content/global_search": {
    Code: 0,
    Message: "success",
    Data: {
      HasMore: false,
      Items: [{
        Title: "Agent Memory 实践",
        ContentType: "Webpage",
        ContentID: "ext-1",
        ContentText: "外部来源对检索增强的补充说明",
        Url: "https://example.com/rag",
        AuthorName: "李四",
      }],
    },
  },
});

const emptyFetch = fixtureFetch({
  "/api/v1/content/zhihu_search": {
    Code: 0,
    Message: "success",
    Data: { HasMore: false, SearchHashId: "empty", Items: [], EmptyReason: "no_match" },
  },
  "/api/v1/content/global_search": {
    Code: 0,
    Message: "success",
    Data: { HasMore: false, Items: [] },
  },
});

const authFetch: FetchLike = async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ Code: 20001, Message: "鉴权失败", Data: {} }),
});

const failures: string[] = [];

const success = await createRuntime({
  accessSecret: "test-secret",
  fetch: successFetch,
  clock: NOW,
}).researchBrief.execute({ question: QUESTION, includeGlobal: true, includeHot: false });

assert(success.empty === false, "成功路径不应为空");
assert(success.sources.length === 2, "成功路径应引用知乎和全网来源");
assert(success.sources[0]?.id === "zhihu_search:9007199254740993", "大整数内容 ID 必须保持字符串精度");
assert(success.conclusion.includes("RAG 评测方法综述"), "结论必须引用真实来源标题");

const empty = await createRuntime({
  accessSecret: "test-secret",
  fetch: emptyFetch,
  clock: NOW,
}).researchBrief.execute({ question: QUESTION, includeGlobal: true, includeHot: false });

assert(empty.empty === true, "空结果必须标记 empty=true");
assert(empty.sources.length === 0, "空结果不得伪造来源");
assert(empty.collections[0]?.emptyReason === "no_match", "空结果原因必须保留");

let authError: ProductError | undefined;
try {
  await createRuntime({
    accessSecret: "bad-secret",
    fetch: authFetch,
    clock: NOW,
  }).researchBrief.execute({ question: QUESTION, includeGlobal: true, includeHot: false });
} catch (error) {
  if (isProductError(error)) authError = error;
  else throw error;
}

assert(authError?.code === "AUTH_INVALID", "鉴权失败不得被当成空结果");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  paths: {
    success: { empty: success.empty, sourceCount: success.sources.length },
    empty: { empty: empty.empty, emptyReason: empty.collections[0]?.emptyReason },
    auth: { code: authError?.code },
  },
}, null, 2));

function fixtureFetch(routes: Record<string, unknown>): FetchLike {
  return async (input) => {
    const url = new URL(input);
    const body = routes[url.pathname];
    if (!body) {
      return { ok: false, status: 404, text: async () => JSON.stringify({ Code: 90001, Message: url.pathname }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) failures.push(message);
}
