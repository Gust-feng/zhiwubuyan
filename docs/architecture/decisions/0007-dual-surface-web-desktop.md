# ADR-0007：双端形态——Vercel 网页端与桌面端

日期：2026-09-13 · 状态：superseded（被 [ADR-0008](0008-web-only-server-hosted-research.md) 取代：产品只交付网页端，桌面端冻结保留不再发布，研究与凭证改由服务端承接）。

> 本文件保留为历史记录。当前形态与能力归属以 [ADR-0008](0008-web-only-server-hosted-research.md) 为准。

## 背景

黑客松交付需要一个可公开访问的产品入口。本地单服务器形态（`src/server/http-server.ts`，127.0.0.1:4301 + libsql + 长驻研究进程）无法承载公开访问，也无法完成知乎 OAuth 所要求的公网 HTTPS 回调。用户确认：产品拆成网页端与桌面端，网页部署到 Vercel（域名已有），OAuth 凭证已拿到；网页只用知乎开放平台 API 提供基础功能，桌面提供深度研究等需要用户自备模型 API 的重功能。

## 决策

1. **网页端 = 知乎 API 面 + 深度研究 Pro**。部署到 Vercel：静态前端 + serverless 函数。功能范围：OAuth 登录、我的知乎（创作/关注/近期收藏）、热榜发现、众声、深度研究 Pro（知乎直答检索增强的单次调用）。全部数据来自知乎开放平台，不引入第二套内容源。**Ultra、简报库、资料库、全局搜索不上网页端**（见第 8 条）。（深度研究 Pro 与圈子后续并入下方「功能面收敛」修订。）
2. **桌面端 = 深度研究面**。Electron 主进程以 `ELECTRON_RUN_AS_NODE` 拉起本地后端（含深度研究引擎），窗口 `loadURL` 指向本地端口；libsql 数据存 userData 目录。模型 API 由用户自备（BYOK），写入本机数据目录的模型配置，由设置界面维护（见修订）。
3. **前端只有一份源码**：`src/workbench` 是网页端与桌面端共用的唯一工作台前端，两个构建配置（`vite.config.workbench.ts` / `vite.config.web.ts`）指向同一份源码与同一套设计令牌，只注入不同的运行面常量。不按端复制界面、不维护第二套壳。
4. **服务端按运行面拆分路由**：知乎系路由（status/auth/hot/user/voices）抽为共享 handler，本地服务器与 Vercel 函数各自装配；研究路由只在本机存在（Ultra 与本机快答都在本地长驻进程）。
5. **登录会话存 Vercel KV**：网页端不用进程内存会话表（serverless 实例间不共享），OAuth token 以服务端 KV 持有，cookie 只带随机会话 ID，符合「token 不进前端」的既有约定。本地开发仍用内存实现。
6. **热榜额度靠 CDN 缓存**：`/api/hot` 响应带 `s-maxage`，全用户共享一份缓存，不为此引入存储设施。
7. **OAuth 协议缺口如实保留**：会话随令牌一小时过期、回调无 `state`（无标准 CSRF 防护）、无 refresh_token 与撤销端点。本链路定位为黑客松联调基线，不伪造持久登录。
8. **前端按运行面渲染差异，而不是按端复制代码**。后端在 `/api/status` 声明 `surface`；网页端保留与桌面端一致的信息架构入口，桌面专属能力点进去是锁定说明页并引导下载（`DesktopOnlySurface`），Ultra 档在入口内提前提示，不发起注定失败的请求。判定依据与视图清单集中在 `src/workbench/src/workbench/surface.tsx`。

## 覆盖关系

- 修订 [ADR-0005](0005-deep-research-mvp-scope.md) 第 11 条：账号体系中的「知乎 OAuth 登录 + 用户数据读取」进入范围，**仅限网页端**；桌面端模型凭证仍从本地配置取得，不建凭证桥。ADR-0005 的只做研究主线、保存/取消规则不受影响。
- [ADR-0006](0006-supervised-research-runtime.md) 的研究运行架构不变，深度研究仍在本地单进程内运行。

## 修订：桌面端模型服务设置界面（2026-09-13）

第 2 条原定「v1 不做设置 UI」。用户确认改为：**桌面端提供模型服务设置界面**，用于配置深度研究所需的模型 API。范围收敛为**单一研究模型**（一组 baseUrl + 模型 ID + 密钥），不做多厂商档案：

- 配置由后端持有并写入本机数据目录，密钥只在该目录内，不回传前端、不写入任务、日志或提示词；读取接口只回是否已配置。
- 研究在创建任务时读取当前模型配置，改完配置对新任务立即生效，无需重启后端；环境变量仍作为首次启动的初始值。
- 写入接口**仅桌面端可用**，网页端返回 `MODEL_CONFIG_DESKTOP_ONLY`，界面渲染为锁定态并引导下载桌面版。
- 不建 Electron 凭证桥（无 preload/IPC）：配置读写走本地后端 HTTP，仍是本机回环请求。

原有「不建凭证桥」不变；本条只是把「做不做设置界面」由不做改为做。

## 修订：部署入口（2026-09-13）

网页端通过 GitHub 仓库导入 Vercel 部署，绑定自定义域名 `gustfeng.dev`。

- `PUBLIC_ORIGIN=https://gustfeng.dev`；登记到开放平台的 `redirect_uri` 固定为 `https://gustfeng.dev/api/auth/callback`（路径由应用固定，见 `OAUTH_CALLBACK_PATH`）。回调路径在 `/api/` 前缀下，不会被 SPA rewrite 吞掉。
- Vercel 环境变量：`ZHIHU_ACCESS_SECRET`、`PUBLIC_ORIGIN`、`ZHIHU_OAUTH_APP_ID`、`ZHIHU_OAUTH_APP_KEY`、`KV_REST_API_URL`、`KV_REST_API_TOKEN`；可选 `DESKTOP_DOWNLOAD_URL`（下载入口）与 `WEB_RATE_LIMIT_MAX` / `WEB_RATE_LIMIT_WINDOW_SECONDS`（登录后接口限流阈值）。
- **KV 必配**：serverless 实例之间不共享内存，缺 KV 时会退回进程内存实现，表现为登录随机失效。
- 构建命令 `pnpm vercel-build`（即 `vite build --config vite.config.web.ts`），产物 `dist/web`。

## 取舍

网页端因此没有 Ultra 研究产物与本地资料（简报、资料库、全局搜索、对话都在桌面）；轻简报（内存两步会话）在 serverless 上失效，本期不为其做无状态改造。

## 修订：功能面收敛与自带调用凭证（2026-09-13）

开放平台每个请求都必须以调用方 Access Secret 鉴权，用户 OAuth token 只能作为额外的 `X-OAuth-Token`，不能替代调用方凭证；因此网页端无法让访客自带凭证，只能收敛功能面并保护调用方额度。

- **网页端移除深度研究**（含 Pro）：`/api/research-tasks` 不再在网页函数注册，进入该板块渲染下载桌面版引导。研究只由桌面端承接。
- **删除圈子**：社区 API（`app_key`/`app_secret` 签名）与产品形态一并移除，代码、路由、契约、文档与 `.env.example` 同步清理。
- **网页端强制登录**：除热榜内容流外，我的知乎、众声、首页直答、选题推荐都要求知乎账号会话；服务端对相应路由返回 401，桌面端对应路由用用户自带凭证、不要求 OAuth。
- **网页端限流**：直答与众声按会话与来源地址计数（KV，本地回退内存），阈值走环境变量；热榜不进限流，继续靠 CDN 共享缓存。
- **桌面端自带调用凭证**：新增 `ZHIHU_ACCESS_SECRET` 设置项（比照模型服务的 BYOK：仅桌面可写、只上行一次、读取只回是否已配置、存本机数据目录），同时驱动机器研究的知乎搜索与直答；环境变量只作首次初始值。OAuth 的 `app_id`/`app_key` 仍来自部署方。

热榜仍匿名可读：登录门禁会让响应带上个人会话，CDN 无法共享缓存，热榜 100 次/天 的额度会被每个访客直接消耗。
