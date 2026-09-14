# ADR-0008：产品只交付网页端，研究与凭证改由服务端承接

日期：2026-09-13 · 状态：accepted（临时方向调整，按用户确认；不是实现完成记录）。

## 背景

[ADR-0007](0007-dual-surface-web-desktop.md) 把产品定型为「Vercel 网页端 + Electron 桌面端」双形态：网页端只做知乎 API 面，深度研究 Ultra、简报库、资料库与全局搜索留在桌面端，网页端对这些板块渲染锁定态并引导下载桌面版。

用户确认调整方向：**产品只做网页端**。研究框架后续上传到服务端运行，并接入服务端自己的模型 API；桌面端不再作为交付形态。

## 决策

1. **只交付网页端**。用户可访问的唯一形态是部署到 Vercel 的网页端（静态前端 + serverless 函数，见 [ADR-0007](0007-dual-surface-web-desktop.md) 部署入口修订）。
2. **桌面端代码冻结保留，不删除、不发布**。`src/desktop`（Electron 主进程）、`src/server/desktop-server.ts`、`vite.config.desktop.ts`、`vite.config.installer.ts`、`packaging/windows/installer-shell/*`、`electron` / `electron-builder` 依赖，以及 `desktop` / `dist:win` / `build:desktop*` 脚本都保留在仓库，只是不再构建发布、不再作为能力依据。方向回摆时可直接恢复。
3. **删除资料库与全局搜索**。两者依赖本机个人资料与本地检索，在网页端没有对应后端，也没有明确 owner；从导航、视图联合、路由与源码中一并移除，连同仅供它们使用的文档预览栈（Markdown/Code/Docx/Pdf/Spreadsheet/Image/Video 预览面与 office 预览运行时）。「我的知乎」内的笔记（NoteEditor）不属于资料库，保留。
4. **深度研究改由服务端承接**。入口保留在导航中；研究引擎计划部署到服务端并接入服务端模型 API，接通后网页端可直接发起。**接通之前**入口给出如实说明（“正在接入服务端”），不引导下载桌面版，也不发注定失败的请求。简报库同理由服务端承接，接通前显示同一类说明。
5. **研究可用性以服务端声明的能力为准**。前端不再用运行面（`surface === 'web'`）推断研究是否可用，改由 `/api/status` 的 `capabilities` 是否包含 `research` 决定；声明了才启用，未声明时显示未接通。本机服务器（`startLocalServer`）声明 `research`，因此本地预览可用完整研究链路；Vercel 函数在研究引擎上线前不声明。
6. **移除 `ULTRA_DESKTOP_ONLY`**。该错误码与 `desktopEdition` 运行面判定一并撤销：Ultra 不再按运行面拒绝，改由模型是否配置（`MODEL_NOT_CONFIGURED`）与知乎凭证是否配置（`ZHIHU_NOT_CONFIGURED`）决定，这两项在服务端配置后即可运行。桌面端冻结后，`desktopEdition` 已不表示任何真实运行面。
7. **移除桌面版下载引导管线**。`desktopDownloadUrl`、`/api/status` 的 `desktop` 字段、`DESKTOP_DOWNLOAD_URL` 环境变量与 `DesktopOnlySurface` 锁定页一并移除，改为服务端承接说明页（`ServerBackedNotice`）。
8. **设置项措辞对齐服务端**。模型服务与知乎调用凭证不再表述为「仅桌面版可配置」，改为由服务端持有；后端仍按运行面决定写入是否开放，错误码改为 `MODEL_CONFIG_READONLY` / `ZHIHU_CREDENTIAL_READONLY`。本机服务器开放写入（服务端操作者在部署环境填写），Vercel 函数不注册这两个写接口。

## 修订：登录入口可点与未接通说明（2026-09-13）

网页端只有一种登录形态：统一的登录弹窗（`LoginView` 的 `modal` 版式，左看山场景 + 右标题与「使用知乎继续」）。侧栏账号区、首页直答与检索、需要登录的板块（众声）以及「我的知乎」都用它，不再各自维护一套门禁版式（原 `LoginGate` 已删除）。

1. **入口始终可点**。此前未配置 OAuth 时，`/api/auth/session` 回 `oauthEnabled:false`，侧栏账号行据此 `disabled`，表现为「点了没反应」。现在账号行不再因登录未配置而禁用：点击总是打开登录弹窗。
2. **未接通在弹窗内说清**。`/api/status` 的 `auth` 增加 `missingConfig`（缺少的配置项名称，只回名称不含值）与 `redirectUri`（应用固定回调地址，公开来源可推导就给）。弹窗在未接通时禁用「使用知乎继续」，并列出缺少的环境变量与待登记的回调地址，附一键复制，把「点了没反应」变成「知道还差什么」。
3. **回调地址由服务端给出**：弹窗展示 `redirectUri`（即登记到开放平台的 `${PUBLIC_ORIGIN}/api/auth/callback`），不在前端按当前来源拼接，避免本机预览与线上登记地址不一致。
4. **自动拉起只在确认未登录时**。需要登录的板块在会话确认未登录后自动打开一次弹窗；会话仍在确认时只显示加载态，避免已登录用户看到一次弹窗闪烁。

## 修订：删除设置功能域（2026-09-13）

用户确认「删除设置」，且「关于/版本」与「研究偏好」都不保留。设置不再是一个收敛或隐藏的入口，而是整体移除：

1. **前端**：删除 `src/workbench/src/features/settings/**`、`workbench/api-contracts/config.ts`、`workbench/domain/config/**`，以及 shell 的 `settingsOpen/settingsGroup/openSettings/closeSettings/developerModeEnabled/modelUsageDisplayEnabled` 状态。侧栏底部入口改为只承载外观切换（浅色 / 深色 / 跟随系统），对话输入区的模型选择与推理力度一并移除。
2. **后端**：删除 `/api/research-model`、`/api/zhihu-credential` 两条写路由；`ResearchBackend` 不再对外暴露 `modelConfig`；`research-model-store.ts` 与 `zhihu-credential-store.ts` 只读化，只保留 `read()`。
3. **配置来源**：模型与知乎调用凭证改为进程启动时从数据目录中的 `model-config.json` / `zhihu-credential.json` 或环境变量（`MODEL_API_*`、`MODEL_PROFILE_MODEL_ID`、`ZHIHU_ACCESS_SECRET`）读取一次，运行中不再有 UI 或 HTTP 写入路径。要变更需改文件/环境变量并重启进程。
4. 本条第 8 项的「设置项措辞对齐服务端」以及 [ADR-0007](0007-dual-surface-web-desktop.md) 的「桌面端模型服务设置界面」修订随本条失效。

## 覆盖关系

- 覆盖 [ADR-0007](0007-dual-surface-web-desktop.md) 整篇（双端形态、网页端锁定与下载引导、桌面端 BYOK 设置）。
- 覆盖 [ADR-0007 研究分档](0007-research-tiers-zhida.md) 第 1 条与第 5 条中「Ultra 仅桌面版可创建 / 服务器不部署」的判定：Ultra 改为服务端承接，不再有桌面门禁。
- 不改动 [ADR-0006](0006-supervised-research-runtime.md) 的研究运行架构与 [ADR-0005](0005-deep-research-mvp-scope.md) 的研究主线与保存/取消规则。

## 取舍与未完成

- **研究尚未在服务端真实运行**。本次只完成前端与服务端契约的解耦（能力声明、错误码、桌面门禁撤销），研究引擎上传服务端、服务端模型 API 接入、serverless 持久化与预算账本均未开始。网页端因此表现为「入口可见、说明未接通」，不伪造可用状态。
- **简报库同样待服务端接入**，当前显示未接通说明。
- **桌面端冻结但仍在仓库**：`pnpm typecheck` 会继续校验它；`dist:win` 等脚本仍可运行，但不作为交付路径。相关文档（架构基线「桌面分发边界」、README Windows 章节）保留历史描述并标注冻结。
