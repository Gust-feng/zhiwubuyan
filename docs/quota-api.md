# 开放 API 额度接口

## 请求

```text
GET https://developer.zhihu.com/api/v1/quota
```

请求携带 `Authorization: Bearer <access_secret>` 和秒级 `X-Request-Timestamp`。查询本身不消耗业务额度。

可选查询参数 `APIIDs` 为逗号分隔的能力标识：

```text
GET /api/v1/quota?APIIDs=knowledge,tools
```

支持 `global_search`、`zhihu_search`、`hot_list`、`user_data`、`zhida_openai`、`knowledge` 和 `tools`。

## 响应

成功响应仍使用 `{ "Code": 0, "Message": "success", "Data": [] }` 外壳，`Data` 中每项包含：

| 字段 | 说明 |
|---|---|
| `APIID` | 能力标识 |
| `APIName` | 展示名称 |
| `TotalQuota` | 当日总额度 |
| `TotalUsed` | 当日已用额度 |
| `RemainingQuota` | 当日剩余额度 |

额度按账号汇总，多个 Access Secret 共用同一额度池。产品层可以在设置页或请求失败后查询额度，但不应在每次业务请求前预检，也不能把历史邀测数字硬编码为运行时限制。

错误 `10001` 表示 APIID 或参数非法，`20001` 表示鉴权失败，`30001` 表示频率限制，`90001` 表示请求失败。
