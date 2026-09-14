# 知无不言

一个围绕知乎公开内容构建的知识研究工作台。支持今日热榜、知乎与全网检索、带引用的研究报告，以及把同一问题下不同立场聚合成众声的看山整理。

产品**只交付网页端**（Vercel 静态前端 + serverless 函数）。深度研究按 [ADR-0007](docs/architecture/decisions/0007-research-tiers-zhida.md) 分档：Pro 是知乎直答检索增强的单次调用，Ultra 是自研全流程（主管 + 受限并行调查单元 + 核验回查，见 [ADR-0006](docs/architecture/decisions/0006-supervised-research-runtime.md)）。**网页端只承接 Pro**；自研 Ultra 引擎需要 45 分钟级长驻进程，不在 serverless 上运行，已冻结保留（见 [ADR-0011](docs/architecture/decisions/0011-pro-only-freeze-ultra.md)）。形态取舍见 [ADR-0008](docs/architecture/decisions/0008-web-only-server-hosted-research.md)。

## 产品形态

产品只有一份前端源码（`src/workbench`），网页端与本地预览共用：

| 能力 | 网页端（Vercel） | 本地预览（`pnpm dev`） |
|---|---|---|
| 热榜内容流（未登录可读） | 可用 | 可用 |
| 我的知乎 / 众声 / 首页直答 | 需登录知乎账号 | 可用（`ZHIHU_DEV_USER_DATA=1` 时以项目凭证读取） |
| 深度研究 Pro | 可用（需登录） | 可用 |
| 深度研究 Ultra（自研引擎） | 不承接（档位菜单不列出） | 可用（需配置模型 API） |

网页端除热榜外的功能都要求登录知乎账号；登录后仍需遵守开放平台额度，因此直答、众声与深度研究 Pro 按会话与来源地址限流。登录只有一种形态：统一的登录弹窗（侧栏账号区、首页直答与检索、众声与我的知乎都用它）。**登录尚未接通时入口依然可点**，弹窗会列出缺少的环境变量与待登记的回调地址。

后端在 `/api/status` 声明 `capabilities`，前端据此决定服务端承接的板块是否启用；判定集中在 `src/workbench/src/workbench/surface.tsx`。`research` 表示研究入口可用，`research_ultra` 表示自研 Ultra 引擎可用（只有本机运行面声明）。

桌面端（Electron 壳、安装器与相关构建）**冻结保留在仓库**：不再构建发布，也不作为能力依据；`src/desktop` 与 `pnpm dist:win` 仍在，方向回摆时可直接恢复。

## 本地运行

环境要求：Node.js 22、pnpm。

```powershell
pnpm install
Copy-Item .env.example .env
# 在 .env 中填写 ZHIHU_ACCESS_SECRET
pnpm dev
```

`pnpm dev` 同时启动本地 API（`http://127.0.0.1:4301`）与工作台前端（`http://127.0.0.1:4303`）。本机服务器就是运行研究的那一侧，声明 `research` 能力，因此本地预览可用完整研究链路。

## 工作台前端

`src/workbench` 是唯一的工作台前端（首页、我的知乎、深度研究、众声共用一个稳定布局）：

```powershell
pnpm dev:workbench   # 本地预览，端口 4303
pnpm dev:web         # 网页运行面，端口 4304
```

界面数据全部来自真实后端接口；后端未提供的能力在界面上呈现空态、错误态或「服务端接入中」说明，不用示例数据顶替。

## 网页端部署（Vercel）

通过 GitHub 仓库导入 Vercel，并绑定自定义域名。构建命令与产物已在 `vercel.json` 固定（`pnpm vercel-build` → `dist/web`）。

Vercel 环境变量：

| 变量 | 说明 |
|---|---|
| `ZHIHU_ACCESS_SECRET` | 开放平台调用凭证 |
| `PUBLIC_ORIGIN` | 公开来源，如 `https://gustfeng.dev`；回调固定为 `<PUBLIC_ORIGIN>/api/auth/callback`，需与开放平台登记的地址一致 |
| `ZHIHU_OAUTH_APP_ID` / `ZHIHU_OAUTH_APP_KEY` | 知乎 OAuth 登录凭证 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN`，或 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 共享 Redis，**必配**：承载登录会话、限流计数，以及热榜与个人档案的跨实例缓存。serverless 实例之间不共享内存，缺省会导致登录随机失效，并让个人档案在每个冷启动实例里重复全量扫描（一次最坏上百次上游调用）。两套命名都识别（前者是旧 Vercel KV 的名字）；从 Marketplace 装 Upstash 集成会自动注入后者，**无需手填** |
| `WEB_RATE_LIMIT_MAX` / `WEB_RATE_LIMIT_WINDOW_SECONDS` | 可选，登录后消耗额度的接口（直答、众声、研究 Pro）限流阈值；默认每窗口 20 次 / 60 秒 |

### 开通共享 Redis（获取 KV 变量）

Vercel KV 已于 2024 年 12 月并入 **Upstash Redis**，现在没有单独的 "Vercel KV" 产品了：

1. 打开 Vercel 项目 → **Storage**（或 Marketplace）→ 选 **Upstash for Redis**。
2. 创建新的 Upstash 数据库（免费档足够）或关联已有账号。
3. 连接到本项目，环境变量会**自动注入** `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`（Vercel 面板可见）。
4. **重新部署**一次——环境变量只在新的部署里生效。

若要在本地联调：在 Upstash 控制台该数据库的 **REST API** 区域可复制 URL 与 token，填进本地 `.env`（任选一组命名）。

> 只配了集成但没重新部署，或变量名不匹配，应用会**静默退回进程内存**：页面看起来正常，实际登录随机失效、缓存与单飞失效。部署后可用一次登录 + 刷新验证会话是否稳定。

## 深度研究的分工（[ADR-0011](docs/architecture/decisions/0011-pro-only-freeze-ultra.md)）

- **Pro（网页端已承接）**：单次调用知乎直答 `zhida-agent`，秒级返回，不依赖长驻进程。它要求登录并进限流；正文是直答生成内容，界面如实标注，不冒充有来源引用的研究报告。网页端不落库，因此任务列表为空、刷新后不恢复上一次研究。
- **Ultra（本机运行面）**：自研引擎（主管 + 并行调查单元 + 核验回查），默认时间预算 45 分钟，靠本地 SQLite 与进程内协调状态运行，**不适合 serverless**。代码与依赖冻结保留、不再演进，本机 `pnpm dev` 仍可完整运行。
- 网页端遇到 `tier: "ultra"` 会以 `RESEARCH_TIER_UNAVAILABLE` 如实拒绝，不静默降级成 Pro。

## 验证

```powershell
pnpm typecheck
pnpm build
pnpm verify:pro        # 网页端 Pro（含路由级：Pro 受理、Ultra 拒绝、列表为空、未登录拒绝）
pnpm verify:research   # 冻结的 Ultra 引擎核心机制
pnpm verify:cache
pnpm verify:archive
```

## 当前边界

- 前端不持有开放平台凭证；OAuth token 只存服务端（网页端为 Vercel KV）。
- 网页端承接热榜、我的知乎、众声、首页直答与深度研究 Pro；自研 Ultra 引擎只在本机运行面。
- 开放平台全部能力、额度与使用原则见 [docs/开放平台能力清单.md](docs/开放平台能力清单.md)。
- 知乎账号登录（OAuth）已接入：授权跳转、令牌交换与会话全部在服务端完成，凭证发放后按 [docs/oauth.md](docs/oauth.md) 填写 `PUBLIC_ORIGIN`、`ZHIHU_OAUTH_APP_ID`、`ZHIHU_OAUTH_APP_KEY` 即可启用；未填写前弹窗会列出缺少的配置项与待登记回调地址。
- 公开内容适配与产品命令分层，后续按需扩展个人关注、收藏与知识库。
- 研究报告使用来源摘要；重要结论需要回到原文核对。
