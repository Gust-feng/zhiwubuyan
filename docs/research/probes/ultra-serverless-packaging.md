# Ultra 上 Vercel 的打包与执行风险验证

日期：2026-09-15 · 类型：风险 spike（只验证可行性，不含产品改动）· 结论：**执行模型成立，打包方式必须沿用外部依赖，硬闸门是 Vercel 计划档位。**

## 要回答的问题

用户希望在 Vercel（不改成长驻容器）承接自研 Ultra 深度研究，模型调用由用户自带（BYOK）。
ADR-0011 把 Ultra 冻结在"本机运行面"的理由有两条：引擎是长驻单进程形态、默认时间预算 45 分钟。
本次只验证：**在不重写引擎的前提下，Ultra 能否在一个 HTTP 请求内跑完、并被 Vercel 函数打包。**

## 结论

1. **单请求同步执行模型成立。** `workflow.start()` 返回 `status: 'success' | 'failed'`，`await` 它即跑到终态；
   当前端口用 `void settled` 只是因为要立刻返回 202 给轮询。引擎可以在请求内被驱动到 completed。
2. **打包可行，但必须保留 libsql / Mastra 为外部依赖。** 全内联成单文件会丢掉 libsql 原生二进制。
3. **没有任何代码层面的阻断点**：冷启动装配 102ms、内存 213–227MB、产物 9.7MB（gzip 2.0MB）。
4. **真正的闸门是 Vercel 计划档位**，不是代码——见下方"硬闸门"。

## 证据

环境：Node v24.15.0 / Windows；Mastra 1.66.0。

| 验证 | 方法 | 结果 |
| --- | --- | --- |
| 冷启动装配 | 临时 dataDir 内 `startResearchBackend()`（模拟 serverless 每次请求新建） | **102ms** 完成，libsql 双库 + proper-lockfile + Mastra 运行时全部就绪 |
| 单请求跑完研究 | 进程内 mock 模型 + mock 检索，`await run.start()` 驱动到终态 | **completed**：1 来源 / 1 发现 / 报告四段（conclusion/evidence/disagreements/gaps）齐全，耗时 351ms |
| 内存峰值 | 连续 3 次装配 + 执行 | RSS **213–227MB**（函数默认 1024MB，充裕） |
| 打包（外部依赖） | vite SSR，保留 Mastra/libsql 外部 | 正常，与既有 `vite.config.backend.ts` 一致 |
| 打包（全内联） | vite SSR `ssr.noExternal: true` | 534 模块 → **9.7MB 单文件（gzip 2.0MB）**，构建 1.45s |
| 全内联产物运行 | 把单文件复制到项目树外的临时目录执行 | **失败**：`Cannot find module '@libsql/<platform>'` |

### 关键失败细节（决定架构）

`libsql/index.js` 通过 `require(\`@libsql/${target}\`)` **动态**加载平台原生包：产物里不含 `.node` 二进制，
只能在有 `node_modules` 的目录里解析到。因此：

- 全内联单文件在本机能"跑通"是假象——它向上找到了项目的 `node_modules`；真隔离后立刻失败。
- 正确形态是**保留 `@mastra/core`、`@mastra/libsql`、`@libsql/client`、`proper-lockfile` 为外部依赖**，
  让 Vercel 正常安装依赖树。`@libsql/linux-x64-gnu` 已在 `pnpm-lock.yaml` 中，Vercel（Linux 构建机）会正常装到。

## 硬闸门：Vercel 计划档位

Vercel 函数最长执行时间（官方文档，2026-08 核对）：

| 计划 | 默认 | 上限 | 延长 |
| --- | --- | --- | --- |
| Hobby | 300s | **300s（5 分钟）** | 无 |
| Pro / Enterprise | 300s | 800s | **1800s（30 分钟），beta，仅 Node 20/22/24** |

Ultra 实测一次研究约 **22 分钟**（`docs/深度研究后端交接.md`），默认预算 45 分钟。
因此：**部署在 Hobby 时该方案物理上不成立**；只有在 **Pro/Enterprise + 30 分钟 beta** 下，
把任务预算压到 25 分钟以内才有余量。这一项无法从仓库判断，需确认 Vercel 项目实际计划。

## 仍未解决（本次未验证）

- **BYOK 凭证注入**：模型配置当前从 dataDir 的 `openResearchModelStore` 读取，不是从请求读。
  要改成每请求注入用户模型凭证，且**只经内存传递、不落盘、不进日志**。
- **知乎检索凭证**：BYOK 只覆盖模型；知乎开放平台凭证归部署方，故**登录 + 限流仍然必需**，
  否则匿名访客直接消耗部署方检索额度。
- **取消语义**：单请求下用户断开即中止（AbortSignal），没有独立 cancel 端点。
- **真实打包**：`vercel build` 在本机安装依赖阶段被超时截断，未取得远端构建机器的最终产物清单。
- **实例复用**：本 spike 每次请求新建临时 dataDir；实例被 Fluid Compute 复用时需确认目录清理无泄漏。

## 建议的下一步（按顺序）

1. 确认 Vercel 项目计划是否为 Pro/Enterprise；若不是，方案先搁置。
2. 写决策文档：为什么解冻 Ultra、BYOK 边界、凭证不落盘、预算上限与限流规则。
3. 实现面：新路由（单请求同步 + SSE 进度）→ 每请求临时 dataDir → 请求内注入用户模型凭证 →
   等待循环轮询 `getResearchTaskDetail` 直到终态 → 预算收敛到 25 分钟 → 能力声明与前端解锁。
4. 在真实部署上验证一次完整研究，记录耗时、内存与失败路径。
