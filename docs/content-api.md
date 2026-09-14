# 公共内容接口

公共内容接口用于检索知乎站内内容、站外全网内容、获取热榜，以及调用知乎直答生成回答。全部使用 Access Secret 鉴权，通用请求头、错误码与约定见 [README.md](README.md)。

- Base URL：`https://developer.zhihu.com`
- 必备请求头：`Authorization: Bearer <access_secret>`、`X-Request-Timestamp: <秒级时间戳>`、`Content-Type: application/json`
- 查询参数为 PascalCase。

---

## 1. 知乎站内搜索

检索与关键词相关的知乎问题、回答或文章。

| 项 | 值 |
|---|---|
| 路径 | `/api/v1/content/zhihu_search` |
| 方法 | GET |

### 1.1 请求参数（Query）

| 名称 | 类型 | 必填 | 默认 | 约束 / 说明 |
|---|---|---|---|---|
| `Query` | String | 是 | - | 关键词，不能为空 |
| `Count` | Int32 | 否 | 10 | 返回数量，最大 10；`<=0` 回退为 10，`>10` 截断为 10 |

### 1.2 响应 `Data`

| 字段 | 类型 | 必返 | 说明 |
|---|---|---|---|
| `HasMore` | Bool | 是 | 当前实现固定为 `false` |
| `SearchHashId` | String | 是 | 搜索请求标识 |
| `Items` | Array[Item] | 是 | 结果列表 |
| `EmptyReason` | String | 否 | 无结果时的原因 |

### 1.3 `Item` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `Title` | String | 内容标题 |
| `ContentType` | String | 内容类型，如 `Answer` / `Article` |
| `ContentID` | String | 内容标识 |
| `ContentText` | String | 内容摘要（非全文） |
| `Url` | String | 原文链接，自带溯源 utm 参数 |
| `CommentCount` | Int32 | 评论数 |
| `VoteUpCount` | Int32 | 赞同数 |
| `AuthorName` | String | 作者昵称（匿名时为「知乎用户」） |
| `AuthorAvatar` | String | 作者头像 URL |
| `AuthorBadge` | String | 作者认证图标 URL |
| `AuthorBadgeText` | String | 作者认证文案 |
| `EditTime` | Int32 | 发布 / 最后更新时间戳（秒） |
| `AuthorityLevel` | String | 权威等级：`1` 低、`2` 中、`3` 高、`4` 超高 |
| `RankingScore` | Float32 | 相关性排序分 |
| `CommentInfoList` | Array[CommentInfo] | 否，精选评论 |

`CommentInfo`：`{ "Content": "评论文本" }`。

### 1.4 示例

```bash
curl -G 'https://developer.zhihu.com/api/v1/content/zhihu_search' \
  --data-urlencode 'Query=怎么理解 RAG' \
  --data-urlencode 'Count=5' \
  -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
  -H "X-Request-Timestamp: $(date +%s)"
```

```json
{
  "Code": 0,
  "Message": "success",
  "Data": {
    "HasMore": false,
    "SearchHashId": "1234567890",
    "Items": [{
      "Title": "RAG 评测方法综述",
      "ContentType": "Article",
      "ContentID": "123456789",
      "ContentText": "本文介绍主流 RAG 评测框架，包括 RAGAS、TruLens ...",
      "Url": "https://zhuanlan.zhihu.com/p/123456789?utm_medium=openapi_platform&utm_source=xxxx",
      "CommentCount": 15,
      "VoteUpCount": 128,
      "AuthorName": "张三",
      "AuthorAvatar": "https://picx.zhimg.com/example.jpg",
      "AuthorBadge": "",
      "AuthorBadgeText": "",
      "EditTime": 1710000000,
      "CommentInfoList": [],
      "AuthorityLevel": "2",
      "RankingScore": 0.98
    }]
  }
}
```

---

## 2. 全网搜索

检索知乎站外的全网内容。

| 项 | 值 |
|---|---|
| 路径 | `/api/v1/content/global_search` |
| 方法 | GET |

### 2.1 请求参数（Query）

| 名称 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `Query` | String | 是 | - | 关键词 |
| `Count` | Int32 | 否 | 10 | 最大 20 |
| `SearchDB` | String | 否 | `all` | 索引库：`all` / `realtime`（实时库）/ `static`（静态库） |
| `Filter` | String | 否 | 高级过滤表达式，作为 URL 参数需编码 |

### 2.2 `Filter` 语法

- 支持字段：
  - `host`：站点域名，字符串值必须用双引号，支持 `==`、`!=`，例如 `host=="example.com"`。**不支持 `zhihu.com` 及其子域名**；检索知乎站内请使用知乎搜索接口。
  - `publish_time`：发布时间（秒级时间戳），数字不加引号，支持 `== != > >= < <=`，例如 `publish_time>=1778494631`。
- 逻辑符 `AND`、`OR` 必须大写，`AND` 优先级高于 `OR`，可用括号 `()` 控制优先级。
- 示例：
  - `host=="example.com"`
  - `host=="example.com" AND publish_time>=1778494631`
  - `(host=="a.com" OR host=="b.com") AND publish_time>1778494631`

### 2.3 响应 `Data`

| 字段 | 类型 | 必返 | 说明 |
|---|---|---|---|
| `HasMore` | Bool | 是 | 是否有下一页 |
| `Items` | Array[Item] | 是 | 结果列表 |

`Item` 字段与知乎搜索基本一致：`Title / ContentType / ContentID / ContentText（摘要，高亮部分用 <em>）/ Url / CommentCount / VoteUpCount / AuthorName / AuthorAvatar / AuthorBadge / AuthorBadgeText / EditTime / AuthorityLevel / CommentInfoList`。

### 2.4 示例

```bash
curl -G 'https://developer.zhihu.com/api/v1/content/global_search' \
  --data-urlencode 'Query=Agent Memory' \
  --data-urlencode 'Count=5' \
  --data-urlencode 'SearchDB=all' \
  --data-urlencode 'Filter=host=="example.com" AND publish_time>=1778494631' \
  -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
  -H "X-Request-Timestamp: $(date +%s)"
```

---

## 3. 知乎热榜

获取当前热榜内容（当前仅返回问题与文章两类）。

| 项 | 值 |
|---|---|
| 路径 | `/api/v1/content/hot_list` |
| 方法 | GET |

### 3.1 请求参数（Query）

| 名称 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `Limit` | Int32 | 否 | 30 | 最大 30；`<=0` 或 `>30` 回退为 30 |

### 3.2 响应 `Data`

| 字段 | 类型 | 必返 | 说明 |
|---|---|---|---|
| `Total` | Int64 | 是 | 实际返回条数 |
| `Items` | Array[Item] | 是 | 热榜列表 |

`Item` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `Title` | String | 热榜标题 |
| `Url` | String | 对应知乎链接 |
| `ThumbnailUrl` | String | 封面缩略图，无封面时为空字符串 `""` |
| `Summary` | String | 内容摘要，无摘要时为空字符串 `""` |

### 3.3 示例

```bash
curl 'https://developer.zhihu.com/api/v1/content/hot_list?Limit=10' \
  -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
  -H "X-Request-Timestamp: $(date +%s)"
```

---

## 4. 知乎直答

基于知乎内容生成回答，接口为 OpenAI 兼容形态，支持三档模型与流式输出。

| 项 | 值 |
|---|---|
| 路径 | `/v1/chat/completions` |
| 方法 | POST |
| 请求类型 | `application/json` |
| 响应类型 | `application/json`（`stream=false`）/ `text/event-stream`（`stream=true`） |

### 4.1 请求体（Body）

当前仅保证以下三个字段：

| 名称 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | String | 是 | 模型档位，见下表；缺失返回 `missing_required_parameter` |
| `messages` | Array[Message] | 是 | 对话消息列表 |
| `stream` | Bool | 否 | 是否流式，默认 `false` |

`Message`：`{ "role": "user", "content": "问题文本" }`。

模型档位：

| `model` | 定位 | 适用 |
|---|---|---|
| `zhida-fast-1p5` | 快速回答（默认、最省额度） | 归纳、改写、结构化等日常任务 |
| `zhida-thinking-1p5` | 深度思考 | 复杂分析，响应额外含 `reasoning_content` |
| `zhida-agent` | 智能检索与回答 | 需要内部检索增强时 |

> 其他 OpenAI 风格字段（如 temperature 等）当前不作为正式能力，不保证生效；实际可用模型还受账号授权配置影响。

### 4.2 非流式响应（`stream=false`）

```json
{
  "id": "chatcmpl-xxxx",
  "object": "chat.completion",
  "created": 1740470400,
  "model": "zhida-thinking-1p5",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "reasoning_content": "分析过程...", "content": "最终回答..." },
    "finish_reason": "stop"
  }]
}
```

### 4.3 流式响应（`stream=true`）

SSE 事件流，以 `data: [DONE]` 结束，期间包含 `: keep-alive` 心跳：

```text
data: {"id":"chatcmpl-xxxx","object":"chat.completion.chunk","created":1740470400,"model":"zhida-thinking-1p5","choices":[{"index":0,"delta":{"reasoning_content":"分析片段"},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{"content":"回答片段"},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### 4.4 错误形态

非流式错误：

```json
{ "error": { "message": "xxx", "type": "invalid_request_error", "param": "model", "code": "model_not_found" } }
```

流式过程中出错（HTTP 200 已发出）时，chunk 的 `finish_reason` 为 `error` 并携带 `error` 字段，最后仍以 `data: [DONE]` 结束。

### 4.5 示例

```bash
curl -X POST 'https://developer.zhihu.com/v1/chat/completions' \
  -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
  -H "X-Request-Timestamp: $(date +%s)" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "zhida-fast-1p5",
    "stream": false,
    "messages": [{ "role": "user", "content": "用三句话解释什么是 RAG" }]
  }'
```

### 4.6 使用边界

- 直答返回的是**生成内容**，不返回具体答主或原始条目；需要可溯源的原始观点、事实核查或观点对比时，应使用搜索接口而非直答。
- 直答额度应通过 `/api/v1/quota` 查询，不在客户端硬编码；相同输入应配合缓存并优先使用快速档，详见 [README.md 第 6 节](README.md#6-调用额度与缓存策略)。
