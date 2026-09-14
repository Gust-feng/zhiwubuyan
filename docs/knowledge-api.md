# 知识库接口

知识库接口使用 `https://developer.zhihu.com`，统一携带 `Authorization: Bearer <access_secret>`、秒级 `X-Request-Timestamp` 和 JSON 请求头。所有知识库 ID 按十进制字符串传输。

## 列出知识库

```text
GET /api/v1/knowledge/bases?Scope=all
```

`Scope` 可取 `all`、`created`、`subscribed`，结果不分页。条目通常包含 `KnowledgeBaseID`、`Name`、`Relation`、`IsDefault`、`Visibility`、`ContentCount`、`UpdatedAt` 和可选 `Description`。

## 列出知识库内容

```text
GET /api/v1/knowledge/bases/{KnowledgeBaseID}/items?Cursor=<cursor>&Limit=20
```

`Limit` 范围为 1-20。只有 `Data.HasMore=true` 时才使用 `Data.NextCursor` 请求下一页。条目通常包含 `RecallContentID`、`ContentType`、`Title`、摘要、时间和 `OriginUrl`。

## RAG 检索

```text
POST /api/v1/knowledge/search
Content-Type: application/json
```

```json
{
  "Query": "退款规则",
  "KnowledgeBaseIDs": ["7526139256098382426"],
  "RecallScopes": ["personal"],
  "Limit": 10
}
```

`KnowledgeBaseIDs` 与 `RecallScopes` 至少提供一种。scope 可取 `personal`、`subscription`、`public`，`Limit` 范围为 1-10。结果 `Data.Content` 是有序字符串数组，产品层应保留其来源上下文。

## 上传文件

```text
POST /api/v1/knowledge/files
Content-Type: multipart/form-data
```

multipart 字段为 `File`（单个非空文件，最大 100 MiB）和可选 `KnowledgeBaseID`。上传是有副作用的同步请求，不自动重试。超时或断线后先调用内容列表确认是否已入库，再决定后续动作。

## 错误

| Code | 含义 | 处理 |
|---:|---|---|
| `10001` | 参数、ID、文件或枚举非法 | 修正请求 |
| `20001` | 无权访问 | 停止并展示权限错误 |
| `30001` | 频率或额度限制 | 使用缓存并等待 |
| `40004` | 知识库不存在 | 重新列出可用知识库 |
| `40005` | 文件仍在处理 | 查询状态，不重传 |
| `40006` | 文件解析失败 | 展示失败原因 |
| `50002` | 检索失败 | 保留错误并允许用户稍后重试 |
