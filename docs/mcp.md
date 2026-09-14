# MCP 服务接入

开放平台提供与公共内容能力对应的 4 个 MCP（Model Context Protocol）服务，可直接接入支持 MCP 的 Agent / 工作流运行时。所有服务仅提供工具（tools）能力，不提供 resources 与 prompts，统一使用 Access Secret 鉴权。

- 鉴权头：`Authorization: Bearer <access_secret>`，建议在连接与后续每次请求中都携带。
- 工具返回为 MCP `text` 类型，正文是面向大模型消费的结构化文本（多为 XML），建议原样交给模型，不要自行裁剪字段。
- 等价的原始 HTTP 接口见 [content-api.md](content-api.md)；若需要更精细的参数与字段控制，优先使用 HTTP API。

| 能力 | 传输方式 | SSE / HTTP 端点 | 工具名 |
|---|---|---|---|
| 全网搜索 | MCP over SSE | `/api/mcp/global_search/v1/sse`（+ `/message`） | `global_search` |
| 知乎热榜 | MCP over SSE | `/api/mcp/hot_list/v1/sse`（+ `/message`） | `hot_list` |
| 知乎搜索 | MCP over SSE | `/api/mcp/zhihu_search/v1/sse`（+ `/message`） | `zhihu_search` |
| 知乎直答 | MCP Streamable HTTP | `POST /api/mcp/zhida/v1/stream` | `zhida` |

---

## 1. SSE 类服务（搜索 / 热榜）

全网搜索、热榜、知乎搜索均采用「先建 SSE 连接，再向 message 端点发 JSON-RPC」的模式。

### 1.1 建立 SSE 连接

```bash
curl -N 'https://developer.zhihu.com/api/mcp/zhihu_search/v1/sse' \
  -H 'Authorization: Bearer <access_secret>' \
  -H 'Accept: text/event-stream'
```

服务端首先返回 `endpoint` 事件，给出带 `sessionId` 的 message 地址：

```text
event: endpoint
data: /api/mcp/zhihu_search/v1/message?sessionId=xxx
```

后续 `initialize`、`tools/list`、`tools/call` 都发送到该 message 地址。

### 1.2 初始化会话

```bash
curl -X POST "$MESSAGE_URL" \
  -H 'Authorization: Bearer <access_secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "clientInfo": { "name": "demo-client", "version": "1.0.0" },
      "capabilities": {}
    }
  }'
```

message 端点通常先返回 HTTP `202 Accepted`，真正的 JSON-RPC 响应通过已建立的 SSE 通道异步返回。

### 1.3 列出工具

```bash
curl -X POST "$MESSAGE_URL" \
  -H 'Authorization: Bearer <access_secret>' \
  -H 'Content-Type: application/json' \
  -d '{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }'
```

### 1.4 调用工具

`tools/call` 的结果通过 SSE 通道返回，而不是直接出现在 POST 响应体中：

```text
event: message
data: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"<zhihu_search ...>...</zhihu_search>"}]}}
```

---

## 2. 各工具入参与返回

### 2.1 `zhihu_search`（知乎搜索）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | String | 是 | 关键词，长度 2–100 字符，建议尽量具体 |
| `count` | Number | 否 | 条数，1–10，默认 10 |

返回文本形态（示意）：

```text
<zhihu_search query="RAG">
<search_item title="RAG 评测方法综述" content_type="Article" url="https://..." author_name="张三" author_avatar="https://..." author_badge_text="" edit_time="2025-03-01 10:00:00 +0000 UTC" authority_level="2" ranking_score="0.9800">
正文摘要...
</search_item>
</zhihu_search>
```

### 2.2 `global_search`（全网搜索）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | String | 是 | 关键词，长度 2–100 字符 |
| `count` | Number | 否 | 条数，1–20，默认 10 |
| `filter` | String | 否 | 过滤表达式，语法同 HTTP 全网搜索，例如 `host=="example.com" AND publish_time>=1778494631` |
| `search_db` | String | 否 | `all` / `realtime` / `static`，默认 `all` |

> 仅检索知乎站内内容时请使用 `zhihu_search`；`global_search` 不支持 `zhihu.com` 子域。

### 2.3 `hot_list`（热榜）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `limit` | Number | 否 | 条数，1–30，默认 30 |

返回文本形态（示意）：

```text
<hot_list limit="30" total="3">
  <item rank="1">
    <title>如何看待当前 AI Agent 的发展趋势？</title>
    <url>https://www.zhihu.com/question/123456789</url>
    <thumbnail_url>https://...</thumbnail_url>
    <summary>摘要</summary>
  </item>
</hot_list>
```

热榜偏实时，顺序与内容会随时间变化；`thumbnail_url`、`summary` 为空时输出空标签。

---

## 3. 直答 MCP（Streamable HTTP）

直答使用单一 stream 端点承载 `initialize` / `tools/list` / `tools/call`，无需先建 SSE。

| 项 | 值 |
|---|---|
| 端点 | `POST https://developer.zhihu.com/api/mcp/zhida/v1/stream` |
| 协议版本 | `2025-10-28` |
| 工具名 | `zhida` |

### 3.1 工具入参

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | String | 是 | 用户问题 |
| `model` | String | 是 | `zhida-fast-1p5`（推荐）/ `zhida-thinking-1p5` / `zhida-agent` |
| `member_id` | Number | 否 | 预留字段，可不传 |

### 3.2 调用示例

```bash
curl -X POST 'https://developer.zhihu.com/api/mcp/zhida/v1/stream' \
  -H 'Authorization: Bearer <access_secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0", "id": 3, "method": "tools/call",
    "params": {
      "name": "zhida",
      "arguments": { "query": "怎么理解 RAG", "model": "zhida-fast-1p5" }
    }
  }'
```

返回标准 `CallToolResult`：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "最终答案文本" }],
    "isError": false
  }
}
```

> MCP 层默认等待直答完整输出后再返回结果；需要增量输出或思考过程时，请改用直答原生 HTTP 接口（见 [content-api.md 第 4 节](content-api.md#4-知乎直答)）。

---

## 4. 选型建议

- 运行时本身就是 MCP Client、希望零封装直接挂载工具：使用 MCP。
- 需要稳定控制参数、错误处理、缓存与流式增量，或在自有服务端集成：使用原始 HTTP API（[content-api.md](content-api.md)）。
- MCP 与 HTTP 共享同一账号额度池，缓存与频控策略同样适用，见 [README.md 第 6 节](README.md#6-调用额度与缓存策略)。
