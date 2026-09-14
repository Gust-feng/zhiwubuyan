# 用户数据接口

用户数据接口读取某知乎账号**公开范围内**的创作、关注与收藏数据。通用请求头、错误码与分页约定见 [README.md](README.md)；第三方登录与代表他人访问见 [oauth.md](oauth.md)。

- Base URL：`https://developer.zhihu.com`
- 全部为 GET 请求。
- 必备请求头：`Authorization: Bearer <access_secret>`、`X-Request-Timestamp: <秒级时间戳>`；内容、关注、近期收藏接口另需 `Content-Type: application/json`。

---

## 1. 身份模型（两种调用身份）

同一组接口通过请求头区分数据归属：

| 场景 | `Authorization` | `X-OAuth-Token` | 返回的数据 |
|---|---|---|---|
| 读取开发者本人账号 | Bearer Access Secret | 不传 | 该 Access Secret 所属账号的公开数据 |
| 代表授权用户访问 | Bearer Access Secret | 传该用户 OAuth access_token | 该授权用户公开范围内的数据 |

- Access Secret 用于识别并鉴权调用方，每次必传。
- OAuth token 用于标识当前被代表的用户，仅在访问其他授权用户时需要。
- 所有接口只返回公开范围数据，不返回私密内容。

---

## 2. 用户创作　`GET /api/v1/user/contents`

获取账号公开范围内的回答、文章、视频、想法和问题。

### 2.1 请求参数（Query）

| 名称 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `ContentType` | String | 是 | - | `all` / `answer` / `article` / `zvideo` / `pin` / `question` |
| `Offset` | Int64 | 否 | 0 | 分页偏移量 |
| `Limit` | Int64 | 否 | 20 | 最大 50 |
| `SortField` | String | 否 | `ts` | 排序字段：`ts`（时间）/ `like_count`（点赞） |
| `SortOrder` | String | 否 | `desc` | `asc` / `desc` |

### 2.2 响应

`Data.Items[]`（`ContentItem`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `ContentType` | String | 小写类型：`answer` / `article` / `zvideo` / `pin` / `question` |
| `Url` | String | 内容链接 |
| `CreatedAt` | Int64 | 创建时间（秒） |
| `LikeCount` | Int64 | 点赞数 |
| `CommentCount` | Int64 | 评论数 |
| `FavoriteCount` | Int64 | 收藏数 |
| `Title` | String | 标题 |
| `Summary` | String | 摘要（**不是正文全文**） |

`Data.Paging`：分页信息，结构见 [README.md 第 5 节](README.md#5-分页约定)。

### 2.3 示例

```bash
curl -G 'https://developer.zhihu.com/api/v1/user/contents' \
  --data-urlencode 'ContentType=all' \
  --data-urlencode 'Limit=20' \
  -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
  -H "X-Request-Timestamp: $(date +%s)"
```

---

## 3. 用户关注　`GET /api/v1/user/followees`

获取账号关注的用户列表。

### 3.1 请求参数（Query）

| 名称 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `Offset` | Int64 | 否 | 0 | 分页偏移量 |
| `Limit` | Int64 | 否 | 20 | 最大 50 |

### 3.2 响应

`Data.Items[]`（`FolloweeItem`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `Fullname` | String | 用户昵称 |
| `UrlToken` | String | 用户主页标识 |
| `Url` | String | 用户主页 URL |
| `AvatarUrl` | String | 头像 URL |
| `Headline` | String | 一句话介绍 |
| `Gender` | Int16 | 性别：`0` 未知/保密，`1` 女，`2` 男 |
| `FollowerCount` | Int64 | 粉丝数 |

### 3.3 示例

```bash
curl -G 'https://developer.zhihu.com/api/v1/user/followees' \
  --data-urlencode 'Limit=20' \
  -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
  -H "X-Request-Timestamp: $(date +%s)"
```

> 平台仅开放「关注（followees）」列表，未开放「粉丝（followers）」列表。

---

## 4. 收藏夹列表　`GET /api/v1/user/favlists`

获取账号的收藏夹元信息。

### 4.1 请求参数（Query）

| 名称 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `Limit` | Int64 | 否 | 20 | 最大 50 |

> 该接口无分页，服务端忽略 `Offset`，因此不提供翻页能力，也不承诺遍历全部收藏夹。

### 4.2 响应

`Data.Items[]`（收藏夹记录）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `UrlToken` | Int64 | 收藏夹标识，用于查询收藏夹内容 |
| `Url` | String | 收藏夹链接 |
| `Title` | String | 收藏夹名称 |
| `Description` | String | 收藏夹描述 |
| `IsPublic` | Bool | 是否公开 |

---

## 5. 收藏夹内容　`GET /api/v1/user/favlist_contents`

获取指定收藏夹中的公开内容。需先通过收藏夹列表拿到 `UrlToken`。

### 5.1 请求参数（Query）

| 名称 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `FavlistUrlToken` | Int64 | 是 | - | 收藏夹标识，来自收藏夹列表的 `UrlToken` |
| `Offset` | Int64 | 否 | 0 | 分页偏移量 |
| `Limit` | Int64 | 否 | 20 | 最大 50 |

### 5.2 响应

`Data.Items[]` 为收藏内容对象（见第 7 节），`Data.Paging` 为分页信息。

### 5.3 调用链示例

```bash
# 第一步：取收藏夹 UrlToken
curl -G 'https://developer.zhihu.com/api/v1/user/favlists' \
  --data-urlencode 'Limit=20' \
  -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
  -H "X-Request-Timestamp: $(date +%s)"

# 第二步：用 UrlToken 拉取该夹内容
curl -G 'https://developer.zhihu.com/api/v1/user/favlist_contents' \
  --data-urlencode 'FavlistUrlToken=123456789' \
  --data-urlencode 'Offset=0' \
  --data-urlencode 'Limit=20' \
  -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
  -H "X-Request-Timestamp: $(date +%s)"
```

---

## 6. 近期收藏　`GET /api/v1/user/collections`

获取账号最近一批收藏内容。

### 6.1 请求参数（Query）

| 名称 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `Limit` | Int64 | 否 | 20 | 最大 50 |

> 该接口没有 `Offset`、也没有 `Paging`，只返回最近一批数据，**不等于完整收藏历史**。

---

## 7. 收藏内容公共对象

`favlist_contents` 与 `collections` 的 `Items[]` 使用同一结构：

| 字段 | 类型 | 说明 |
|---|---|---|
| `ContentType` | String | 小写：`answer` / `article` / `zvideo` / `pin` / `question` |
| `Url` | String | 内容链接 |
| `CreatedAt` | Int64 | 内容创建时间（秒） |
| `FavTime` | Int64 | 收藏时间（秒） |
| `LikeCount` | Int64 | 点赞数 |
| `CommentCount` | Int64 | 评论数 |
| `FavoriteCount` | Int64 | 收藏数 |
| `Title` | String | 标题 |
| `Summary` | String | 摘要（非全文） |
| `Favlists` | Array | 内容所在收藏夹列表，元素含 `UrlToken` / `Title` / `Url` |
| `Author` | Object | 否，内容作者；下游未返回时缺省 |

`Author` 字段：`Name`（名称）、`UrlToken`、`Url`、`Gender`（0/1/2）、`Headline`（签名）。

---

## 8. 响应外壳与错误码

成功外壳：`{ "Code": 0, "Message": "success", "Data": {} }`。

| Code | 含义 |
|---:|---|
| 0 | 成功 |
| 10001 | 参数错误 |
| 20001 | 鉴权失败 |
| 30001 | 频率限制 |
| 30002 | 配额限制 |
| 90001 | 内部错误 |

---

## 9. 边界与注意事项

- 创作与收藏接口返回的都是**标题 + 摘要**，不返回正文全文；完整内容通过 `Url` 跳转，不做批量抓取。
- 收藏夹列表、近期收藏无分页；只有创作、关注、收藏夹内容支持 `Paging` 翻页，且 `NextOffset` 为字符串，回传需做整数解析。
- 空收藏夹、空列表属于正常空数据，不算接口失败。
- 代表其他授权用户访问时，鉴权失败应终止访问，不得静默回退到开发者本人账号数据。
