# ADR-0011：深度研究只交付 Pro（知乎直答），自研 Ultra 引擎冻结保留

日期：2026-09-14 · 状态：accepted（临时方向调整，按用户确认；不是实现完成记录）。

## 背景

[ADR-0008](0008-web-only-server-hosted-research.md) 定了「只交付网页端」，并把**自研研究引擎上传服务端**写成待办。此后核过一次可行性，结论是这条路与交付形态冲突：

1. 自研引擎是**长驻单进程 + 进程内协调**的形态：`proper-lockfile` 独占数据目录（`src/backend/index.ts`），预算账本、任务锁、活动运行表都在进程内存里（`src/application/deep-research.ts`），持久化是本地 SQLite 文件（`src/storage/research-store.ts`、`framework-storage.ts`）。
2. 研究任务的默认时间预算是 **45 分钟**（`DEFAULT_LIMITS.timeoutMs = 2_700_000`，`src/application/research-baseline.ts`）；Vercel 函数上限 60 秒，即使开到平台上限也差一个数量级。

也就是说，当前部署形态（Vercel 静态前端 + serverless 函数）**接不了**这个引擎；而研究入口若一直挂着「服务端接入中」，对用户等于没有这个能力。

同时，知乎开放平台自身的**直答**已经能提供一次高质量回答（`zhida-agent`）——它就是深度研究 Pro 的实现方式，单次调用、秒级返回，不依赖长驻进程。用户据此决定：**只交付 Pro，自研 Ultra 不上服务端**。

## 决策

1. **网页端只提供深度研究 Pro**：`POST /api/research-tasks`（`tier: "pro"`）单次调用知乎直答 `zhida-agent`，返回终端结果；不拆题、不取证、不产生来源引用、不落库。
2. **Ultra 请求在网页端如实拒绝**，稳定错误码 `RESEARCH_TIER_UNAVAILABLE`。不静默降级成 Pro——降级会让用户以为跑的是自己选的那档。
3. **自研 Ultra 引擎冻结保留**：`src/agent/**`、`deep-research.ts` 的引擎部分、`src/backend/**`、Mastra 与 `proper-lockfile` 依赖、`src/cli/verify-research-core.ts`、`vite.config.backend.ts` 与 `tsconfig.backend.json` 的引擎部分全部留在仓库，**不再作为交付能力、不新增投入**，方向回摆时可直接恢复（与桌面端冻结先例一致）。既有校验（`verify:research`）继续运行，防止冻结代码在原位腐烂。
4. **本机运行面行为不变**：本地/桌面仍同时承接 Pro 与 Ultra，`startLocalServer` 保留 `/api/research-tasks*` 全套路由（含 sources/report/cancel）。
5. **能力声明分离**：网页端 `/api/status` 声明 `research`（Pro 可用）；本机面额外声明 `research_ultra`（引擎可用）。前端档位菜单按 `research_ultra` 决定是否列出 Ultra，不按运行面名硬编码。
6. **网页端任务列表返回空**：网页端不落库，没有可恢复的历史。返回空列表而不是 404——前端刷新时会用它尝试恢复上一次研究，404 会被当成错误展示。

## 边界与不变量

- 网页端 Pro **要求登录并进限流**：额度挂在部署方账号上，不能让匿名访客直接消耗（与首页直答同规则）。
- Pro 的 `TaskDetail` 与引擎的 Pro 分支**形状一致**（`answer` 有值，`plan`/`findings`/`analysis`/`report` 为空），前端沿用同一个快答渲染，不为网页端分叉界面。
- 网页端不引入引擎、store 与 libsql：Pro 命令只依赖无依赖的档位常量模块 `research-baseline.ts`，避免为一次直答把本地存储拖进函数包。

## 与既有决策的关系

- 覆盖 [ADR-0008](0008-web-only-server-hosted-research.md) 第 4、5 条中「研究引擎后续上传服务端、接通前显示未接通」的部分：网页端**改为承接 Pro 并声明 `research`**，而不是等待引擎上线。
- 不改动 [ADR-0006](0006-supervised-research-runtime.md) 的研究运行架构与 [ADR-0005](0005-deep-research-mvp-scope.md) 的研究主线；那些规则仍然描述 Ultra 引擎，只是该引擎现在只在本机运行面执行。
- 与 [ADR-0009](0009-remove-brief-library.md) 一致：只交付有真实承接方的能力，不保留没有 owner 的入口。

## 取舍与未完成

- **自研引擎的产出（计划、findings、来源、报告）在网页端不可见**。Ultra 的价值留在本机运行面；这是接受的能力削减，不是遗忘的实现。
- **Ultra 引擎仍在仓库但不再演进**：它带来的依赖（Mastra、libsql、proper-lockfile）会继续被 `pnpm typecheck` 与本机构建校验；不清理、不删除。
- **Pro 的正文是知乎直答生成内容**，界面必须如实标注，不与「有来源引用的研究报告」混为一谈。
- 研究引擎若将来要上服务端，需要**长驻容器**形态（不是 serverless 函数），并解决持久化与单进程锁的迁移；那是一个独立课题，不在本 ADR 范围内。
