# 知乎开放平台接口文档

本目录整理应用对接「知乎数据开放平台」所需的接口、鉴权方式、数据字段与工程约定，作为服务端接入的唯一事实来源。产品层的能力边界和 Mastra 使用方式见 [架构基线](architecture/架构基线.md)。

已确定采用 **Mastra Agent + Workflows** 作为底层框架，正式决策见 [ADR-0003](architecture/decisions/0003-mastra-foundation.md)，理由、代价与接入验证见 [技术选型](agent-framework-selection.md)。依赖声明与隔离实验不代表产品运行和真实研究验收完成。

当前工作台的页面职责、首页信息流、独立板块与实施顺序见[工作台核心布局设计](design/核心布局设计.md)。该文件是现行布局维护入口；预览图片不代替业务能力验证。

个人档案（登录用户自身的创作 / 收藏 / 关注，经规则组装成视图）已确认设计，见[个人档案设计](design/个人档案设计.md)与 [ADR-0010](architecture/decisions/0010-personal-archive.md)；只用 `user_data`，不调用生成式模型，不属于本期深度研究交付。

当前只开发深度研究后端，范围以 [ADR-0005](architecture/decisions/0005-deep-research-mvp-scope.md) 为准。运行架构按 [ADR-0006](architecture/decisions/0006-supervised-research-runtime.md)：主管动态规划、受限调查单元并行取证、核验可触发回查。知乎是主要证据来源；创建即执行，进度轮询，结果保存在本机。聊天、个人资料、暂停恢复、成果版本和桌面接入后置；下文的开放平台接口目录不等于本期开发清单。

实施入口为[深度研究开发方案](deep-research-development-plan.md)、[三个实施阶段](research/implementation-tasks.md)、[开发提示词](research/implementation-prompt.md)与[后端 API](backend-api.md)。配套[契约示例](research/contract-examples.md)、[质量案例](research/quality-cases.md)、[框架验证记录](research/framework-verification.md)；流程概览见[研究工作流](deep-research-workflow.md)。旧综合设计保留为[历史参考](research/deferred/README.md)。

- 开放平台首页：<https://developer.zhihu.com/>
- 文档中心：<https://developer.zhihu.com/docs>
- 个人中心 / 凭证与用量：<https://developer.zhihu.com/profile>
- 接口基础域名（Base URL）：`https://developer.zhihu.com`

> 文档依据开放平台官方接口说明整理。接口字段、额度与协议可能随邀测调整；当本文与平台后台或官方答疑不一致时，以平台「个人中心 / 文档中心」的最新口径为准，差异点记录在[第 9 节](#9-待确认事项与联系)。

---

## 1. 能力地图

平台能力分为公共内容、知识库和用户数据三个数据域，外加可选的第三方登录与 MCP 传输能力。

### 1.1 公共内容域（不涉及具体用户授权）

| 能力 | 方法 | 路径 | 说明 | 详见 |
|---|---|---|---|---|
| 知乎站内搜索 | GET | `/api/v1/content/zhihu_search` | 检索问题 / 回答 / 文章，单页最多 10 条 | [content-api.md](content-api.md) |
| 全网搜索 | GET | `/api/v1/content/global_search` | 检索站外网页，单页最多 20 条，支持过滤 | [content-api.md](content-api.md) |
| 知乎热榜 | GET | `/api/v1/content/hot_list` | 当前热榜，单次最多 30 条 | [content-api.md](content-api.md) |
| 知乎直答 | POST | `/v1/chat/completions` | 生成式回答，OpenAI 兼容形态，可流式 | [content-api.md](content-api.md) |
| 开放 API 额度 | GET | `/api/v1/quota` | 查询当前账号各能力的当日额度 | [quota-api.md](quota-api.md) |

### 1.2 知识库域

| 能力 | 方法 | 路径 | 说明 | 详见 |
|---|---|---|---|---|
| 知识库列表 | GET | `/api/v1/knowledge/bases` | 列出可访问的知识库 | [knowledge-api.md](knowledge-api.md) |
| 知识库内容 | GET | `/api/v1/knowledge/bases/{id}/items` | 游标分页查看内容 | [knowledge-api.md](knowledge-api.md) |
| 知识库检索 | POST | `/api/v1/knowledge/search` | RAG 检索 | [knowledge-api.md](knowledge-api.md) |
| 文件上传 | POST | `/api/v1/knowledge/files` | 上传单个文件 | [knowledge-api.md](knowledge-api.md) |

### 1.3 用户数据域（读取某账号公开范围内的数据）

| 能力 | 方法 | 路径 | 说明 | 详见 |
|---|---|---|---|---|
| 用户创作 | GET | `/api/v1/user/contents` | 回答 / 文章 / 视频 / 想法 / 问题 | [user-data-api.md](user-data-api.md) |
| 用户关注 | GET | `/api/v1/user/followees` | 该账号关注的用户列表 | [user-data-api.md](user-data-api.md) |
| 收藏夹列表 | GET | `/api/v1/user/favlists` | 收藏夹元信息 | [user-data-api.md](user-data-api.md) |
| 收藏夹内容 | GET | `/api/v1/user/favlist_contents` | 指定收藏夹内的内容 | [user-data-api.md](user-data-api.md) |
| 近期收藏 | GET | `/api/v1/user/collections` | 最近一批收藏（非完整历史） | [user-data-api.md](user-data-api.md) |

### 1.4 第三方登录（可选）

让访问者使用知乎账号登录本应用、并代表其读取用户数据时，使用 OAuth 授权码流程，详见 [oauth.md](oauth.md)。仅调用公共内容、或只读取开发者本人账号数据时，不需要 OAuth。

### 1.5 MCP 接入（可选）

平台另提供与上述能力对应的 4 个 MCP 服务，适合直接接入支持 MCP 的 Agent 运行时，详见 [mcp.md](mcp.md)。

赛事故事与知识内容接口是独立的公开内容域，详见 [hackathon-content-api.md](hackathon-content-api.md)。

---

## 2. 接入前置：获取 Access Secret

公共内容接口与用户数据接口统一使用 **Access Secret** 作为调用方凭证。

1. 打开 <https://developer.zhihu.com/profile>，使用知乎账号登录。
2. 点击「申请新 Access Secret」并妥善保存（仅在生成时完整展示一次）。
3. 服务端通过环境变量注入，例如 `ZHIHU_ACCESS_SECRET`。

Access Secret 规则：

- 单个知乎账号最多可申请 20 个 Access Secret。
- 同一账号下所有 Secret 共享同一个试用额度池；后台页面测试与 API 调用共享额度。
- Access Secret 具备完整 API 访问权限；删除后无法恢复，泄露后应立即删除并重新申请。

---

## 3. 鉴权与通用请求约定

### 3.1 必备请求头

每个请求都必须携带以下请求头：

| 请求头 | 值 | 说明 |
|---|---|---|
| `Authorization` | `Bearer <access_secret>` | 调用方鉴权 |
| `X-Request-Timestamp` | 秒级 Unix 时间戳 | 服务端会校验，例如 `1742822400` |
| `Content-Type` | `application/json` | JSON 接口固定值 |

代表 OAuth 授权用户调用用户数据接口时，额外携带 `X-OAuth-Token: <oauth_access_token>`，详见 [oauth.md](oauth.md)。

### 3.2 参数命名：PascalCase

查询参数与请求体字段使用**首字母大写的 PascalCase**，例如 `Query`、`Count`、`Limit`、`Offset`、`ContentType`、`FavlistUrlToken`。写成小写会返回参数错误（`Code=10001`）。

### 3.3 统一响应外壳

内容接口与用户数据接口成功时返回：

```json
{ "Code": 0, "Message": "success", "Data": { } }
```

> 注意：HTTP 状态码可能为 200，但响应体 `Code` 仍可能是非 0 的业务错误。**必须以响应体 `Code` 判断成败，不能只看 HTTP 状态码。**

直答接口（`/v1/chat/completions`）使用 OpenAI 风格结构，错误体为 `error.{message,type,param,code}`，与上述外壳不同，详见 [content-api.md](content-api.md#4-知乎直答)。

### 3.4 最小连通性验证

```bash
curl -G 'https://developer.zhihu.com/api/v1/content/zhihu_search' \
  --data-urlencode 'Query=RAG 入门' \
  --data-urlencode 'Count=3' \
  -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
  -H "X-Request-Timestamp: $(date +%s)"
```

Windows PowerShell 下可使用 `curl.exe`，时间戳可用 `[int][double]::Parse((Get-Date -UFormat %s))` 生成。

---

## 4. 错误码与处理

| Code | 含义 | 处理建议 |
|---:|---|---|
| 0 | 成功 | — |
| 10001 | 参数错误 | 核对 PascalCase 字段名、必填项、取值范围、枚举值 |
| 20001 | 鉴权失败 | 核对 Access Secret / 请求头；不要把鉴权失败误判为「无结果」 |
| 30001 | 频率限制 | 停止主动重试，退避并优先读取缓存 |
| 30002 | 配额限制 | 当日该能力额度耗尽，走缓存兜底并查询额度接口 |
| 90001 | 内部错误 | 保留 request id 稍后重试；直答 POST 不做无上限自动重试 |

OAuth 相关接口的业务字段 `code:20000` 表示成功，属于特例，详见 [oauth.md](oauth.md)。

---

## 5. 分页约定

需要分页的用户数据接口使用 `Offset` / `Limit` 入参，并在响应中返回 `Paging`：

```json
{ "IsEnd": false, "NextOffset": "40", "Totals": 128 }
```

- `IsEnd=false` 时，将 `NextOffset` 原样作为下一次请求的 `Offset`。
- 注意类型差异：请求 `Offset` 为整数，响应 `NextOffset` 为**字符串**，回传前需做整数解析，解析失败应报错而非静默截断。
- 收藏夹列表、近期收藏没有分页，详见 [user-data-api.md](user-data-api.md)。

---

## 6. 调用额度与缓存策略

### 6.1 当前额度查询

实时额度通过以下接口查询，查询本身不消耗业务额度：

```text
GET /api/v1/quota
```

`Data` 返回 `APIID`、`APIName`、`TotalQuota`、`TotalUsed` 和 `RemainingQuota`。可用 APIID 包括 `global_search`、`zhihu_search`、`hot_list`、`user_data`、`zhida_openai`、`knowledge`、`tools`。应用运行时不得将下表或历史额度写死为成败依据。

### 6.2 历史邀测参考额度（非运行时事实）

| 能力 | 每日额度 |
|---|---:|
| 知乎搜索 | 5,000 |
| 全网搜索 | 5,000 |
| 知乎热榜 | 100 |
| 知乎直答 | 100 |

- 额度按账号汇总、所有 Access Secret 共享；具体剩余量以 `/api/v1/quota` 和个人中心为准。
- 邀测阶段免费；正式计费需联系开放平台商务。

### 6.3 工程侧缓存建议

1. 搜索结果按「归一化 Query + 过滤条件」做缓存，短时间内重复请求直接命中缓存。
2. 直答通常是额度更紧的能力：相同输入只请求一次并落库；默认使用 `zhida-fast-1p5`，复杂任务再用 `zhida-thinking-1p5`，实际额度以 `/api/v1/quota` 为准。
3. 热榜结果缓存数分钟即可，避免轮询。
4. 命中 `30001/30002` 时不重试，降级为缓存内容并在响应中标注数据时间。

---

## 7. 凭证与数据安全

- Access Secret、OAuth App Key、OAuth Access Token 只允许存在于服务端（环境变量 / 平台 Secret / 进程内存），禁止写入前端包、URL、日志、Git 仓库与界面。
- 仓库应通过 `.gitignore` 屏蔽 `.env` 等本地密钥文件；诊断日志只输出长度或哈希前缀，不输出完整凭证。
- 只读取完成任务所需的最小数据范围；公共搜索返回摘要与链接，不批量抓取正文。
- 面向访问者的 OAuth 最终授权确认必须由用户本人操作。

### 通用服务端客户端骨架（TypeScript）

```ts
const BASE_URL = "https://developer.zhihu.com";

function buildHeaders(secret: string, extra?: Record<string, string>): HeadersInit {
  return {
    Authorization: `Bearer ${secret}`,
    "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
    "Content-Type": "application/json",
    ...extra,
  };
}

/** 内容 / 用户数据接口统一封装：校验业务 Code，返回 Data */
export async function zhihuGet<T>(
  path: string,
  secret: string,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: buildHeaders(secret, extraHeaders) });
  const body = await res.json();
  if (body.Code !== 0) {
    throw new Error(`ZhihuAPI ${body.Code}: ${body.Message ?? "unknown error"}`);
  }
  return body.data ?? body.Data;
}
```

---

## 8. 文档导航

| 文档 | 内容 |
|---|---|
| [知乎开放平台数据清单.md](知乎开放平台数据清单.md) | 数据能力总览：各数据域提供什么数据、关键限制与边界速查 |
| [content-api.md](content-api.md) | 知乎搜索、全网搜索、热榜、直答的完整参数与字段 |
| [quota-api.md](quota-api.md) | 开放 API 额度查询与能力标识 |
| [user-data-api.md](user-data-api.md) | 创作、关注、收藏相关 5 个接口与身份模型 |
| [knowledge-api.md](knowledge-api.md) | 知识库列表、检索与上传 |
| [hackathon-content-api.md](hackathon-content-api.md) | 赛事故事与知识内容 |
| [oauth.md](oauth.md) | 知乎账号授权登录、令牌交换、公网回调与安全边界 |
| [mcp.md](mcp.md) | 4 个 MCP 服务的端点、工具定义与调用步骤 |

---

## 9. 待确认事项与联系

- 接口额度、模型档位与协议字段处于邀测迭代期，正式接入前以平台后台与官方答疑为准。
- 开放平台 API 接入、权限申请、商务合作：**openplatform@zhihu.com**（工作日 09:00–18:00，一般 1 个工作日内回复）。
- OAuth 的 `app_id` / `app_key` 申请：**product-platform@zhihu.com**，所需材料见 [oauth.md](oauth.md)。
