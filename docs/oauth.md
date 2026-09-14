# 知乎账号 OAuth 授权登录

当应用需要让访问者使用知乎账号登录、并代表该访问者读取其用户数据（创作 / 关注 / 收藏）时，使用 OAuth 2.0 授权码流程。仅调用公共内容接口、或只读取开发者本人账号数据时，**不需要** OAuth，只用 Access Secret 即可（见 [README.md](README.md)）。

---

## 1. 凭证角色（三类凭证不可混用）

| 凭证 | 代表谁 | 获取方式 | 用在哪 | 存放位置 |
|---|---|---|---|---|
| Access Secret | 应用（开放平台调用方） | 个人中心自助申请 | 所有接口的 `Authorization: Bearer` | 服务端 Secret / 环境变量 |
| `app_id` | 第三方应用 | 邮件申请后发放 | 发起授权、换取令牌 | 项目公开配置 |
| `app_key` | 第三方应用密钥 | 邮件申请后发放 | 仅在服务端换取 token | 服务端 Secret，禁止入前端 |
| `authorization_code` | 用户一次授权结果 | 授权回调带回 | 一次性换取 access token | 服务端回调内存 |
| OAuth `access_token` | 已授权用户 | 用授权码换取 | 用户数据接口的 `X-OAuth-Token` | 仅存服务端进程内存 |

> 关键区分：`app_id` 是短数字；`app_key` 是较长字符串；Access Secret 是开放平台调用方密钥。三者不能互相替代。

---

## 2. 前置申请

OAuth 凭证需要通过邮件申请：

- 邮箱：**product-platform@zhihu.com**
- 邮件主题：`<应用名称>申请接入知乎 OAuth 服务`
- 申请材料：
  - 应用名称
  - 应用简介
  - 授权完成后的回调地址 `redirect_uri`
  - 申请人名称
  - 申请人手机号

---

## 3. 授权码流程（Authorization Code Flow）

### 步骤 1：跳转到知乎授权页

```text
GET https://openapi.zhihu.com/authorize?redirect_uri={redirect_uri}&app_id={app_id}&response_type=code
```

- `redirect_uri` 需 URL 编码，且必须与申请时登记的地址**完全一致**（协议、域名、路径、尾部斜杠都要一致）。
- 最终授权确认必须由用户本人在知乎页面完成，应用不得代点。

### 步骤 2：知乎回调带回授权码

当前实测回调形态：

```text
{redirect_uri}?authorization_code={authorization_code}
```

- 回调参数名为 `authorization_code`。为兼容协议修订，接收端可同时接受 `authorization_code` 与 `code`，以前者为主路径。
- 用回调得到的授权码作为下一步令牌接口的 `code` 表单字段。

### 步骤 3：用授权码换取 Access Token

```text
POST https://openapi.zhihu.com/access_token
Content-Type: application/x-www-form-urlencoded
```

| 表单字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `app_id` | String | 是 | 应用 ID |
| `app_key` | String | 是 | 应用密钥 |
| `grant_type` | String | 是 | 固定为 `authorization_code` |
| `redirect_uri` | String | 是 | 登记的回调地址 |
| `code` | String | 是 | 回调得到的 authorization code |

> 注意：回调参数叫 `authorization_code`，但**换令牌的表单字段仍叫 `code`**；`grant_type` 是固定枚举，不从回调读取。

cURL 示例：

```bash
curl -sS -X POST 'https://openapi.zhihu.com/access_token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "app_id=${APP_ID}" \
  --data-urlencode "app_key=${APP_KEY}" \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "redirect_uri=${REDIRECT_URI}" \
  --data-urlencode "code=${CODE}"
```

成功响应：

```json
{ "access_token": "xxx", "token_type": "Bearer", "expires_in": 3600 }
```

| 字段 | 说明 |
|---|---|
| `access_token` | 用户访问令牌 |
| `token_type` | 令牌类型，如 `Bearer` |
| `expires_in` | 有效期（秒），当前为 3600（约 1 小时） |

### 步骤 4：携带双请求头调用用户数据接口

代表授权用户访问时，同时提供调用方凭证与用户令牌：

```bash
curl -G 'https://developer.zhihu.com/api/v1/user/contents' \
  --data-urlencode 'ContentType=all' \
  -H "Authorization: Bearer $ZHIHU_ACCESS_SECRET" \
  -H "X-OAuth-Token: $OAUTH_ACCESS_TOKEN" \
  -H "X-Request-Timestamp: $(date +%s)"
```

- `Authorization: Bearer <access_secret>`：鉴权调用方。
- `X-OAuth-Token: <oauth_access_token>`：标识当前被代表的用户。
- 用户数据接口清单见 [user-data-api.md](user-data-api.md)。

---

## 4. 公网回调与部署约束

- `localhost`、`127.0.0.1` 等本地地址**只能用于页面预览，无法完成真实授权登录**。
- 真实联调必须先把应用部署到公网，使用公网 HTTPS 回调，并将同一地址登记到开放平台。
- **回调地址由应用固定为 `https://<公开来源>/api/auth/callback`**，登记时照抄这个完整地址，不要自行改路径。
- 回调路径必须落在 `/api/` 之下：网页端部署只有 `/api/*` 交给服务端函数，其余路径回退到前端页面，回调落在别处会拿不到 `authorization_code`。
- 取得公网域名后，需同步更新应用配置与开放平台登记，再重新部署。
- 应用后端负责 `app_key` 保管、授权码交换与 token 持有；浏览器只负责跳转授权页与展示结果。

---

## 5. 安全要求

- `app_key`、授权码交换、OAuth access_token 的使用全部在服务端完成；不得放入浏览器、前端包、URL、前端日志或界面。
- OAuth access_token 与 Access Secret 分开存储、分开审计；token 仅保存在进程内存会话中。
- 用户取消授权、token 过期或返回鉴权失败时，应停止访问，不得静默切换到开发者本人账号。
- 日志与诊断只输出长度或哈希前缀等脱敏信息，禁止输出完整 `app_key`、授权码、token。

---

## 6. 当前协议边界（接入前须知）

当前 OAuth 能力定位为邀测联调基线，并非可直接上线的生产级登录方案：

1. 授权回调实测可能**不返回 `state`**，因此无法完成标准 CSRF 校验；此类情况页面应标注「仅适合临时联调」。
2. 当前未提供 PKCE、scope、用户拒绝授权回调、统一错误响应等协议要素。
3. 只返回 `access_token` 与 `expires_in`，**没有 refresh_token**；过期后需要用户重新授权。
4. 没有令牌撤销、授权查询、解绑接口。
5. 账号资料读取使用平台补充资料记录的 `GET https://openapi.zhihu.com/user`（只带 OAuth token，返回 `fullname`、`avatar_path`、`headline` 等）；该端点**没有正式契约文档，也未经本项目凭证联调验证**，只作展示用途。读取失败或字段缺失时界面回退到无昵称头像的登录形态，绝不阻断会话与 5 个正式用户数据接口。
6. 令牌接口与用户接口的业务字段 `code: 20000` 表示成功；客户端应优先判断 `access_token` 或用户对象是否存在，不把 `20000` 当作错误码。

以上缺口在正式产品化前需向开放平台确认最新支持情况。

---

## 7. 应用侧接线（知无不言）

本应用按上述协议实现的登录链路，配置全部来自服务端环境变量：

| 环境变量 | 说明 |
|---|---|
| `PUBLIC_ORIGIN` | 应用对外公开来源，如 `https://gustfeng.dev`；回调地址据此拼出 |
| `ZHIHU_OAUTH_APP_ID` | 开放平台发放的应用 ID |
| `ZHIHU_OAUTH_APP_KEY` | 应用密钥，只在服务端使用，禁止入前端 |
| `ZHIHU_OAUTH_REDIRECT_URI` | 可选；写完整回调地址，应用只取其中的来源部分，与 `PUBLIC_ORIGIN` 二者其一 |

`app_id`、`app_key` 与公开来源齐全，登录能力才启用；回调路径由代码固定（`src/platform/zhihu/oauth.ts` 的 `OAUTH_CALLBACK_PATH`），配置只决定来源。当前项目公开来源为 `https://gustfeng.dev`，因此登记到开放平台的回调地址是：

```text
https://gustfeng.dev/api/auth/callback
```

服务端路由（见 `src/server/http-server.ts`）：

- `GET /api/auth/session`：当前登录状态（`oauthEnabled` / `authenticated` / `developerMode` / `expiresAt` / `profile` / `surface`）。`profile` 是展示用的昵称、头像与签名，来自无正式契约的 `/user`，读取不到时缺省。
- `GET /api/auth/authorize`：302 跳转知乎授权页。
- `GET /api/auth/callback`：授权回调；用 `authorization_code` 换取令牌，建立服务端内存会话并写入 HttpOnly 会话 cookie 后跳回首页。换取失败时以 `?login_error=<错误码>` 跳回首页。
- `POST /api/auth/logout`：销毁会话并清除 cookie。

约束与行为：

- OAuth access_token 只保存在服务端进程内存的会话表中，cookie 只携带随机会话 ID；前端永远拿不到令牌与 `app_key`。
- 会话随令牌一同过期（约 1 小时，提前 30 秒判定），协议无 refresh_token，过期后需重新授权。
- `/api/user/*` 一律代表「当前已授权用户」调用：未登录返回 401；上游判定令牌失效时销毁会话并要求重新登录，不会回退到开发者本人账号。
- 因当前回调不返回 `state`，授权请求未携带 CSRF 防护参数，链路定位为黑客松联调基线。
