# Mastra 框架核对与隔离验证记录

核对日期：2026-09-13（Asia/Singapore）。本记录支持[开发方案](../deep-research-development-plan.md)的框架接入决策，只证明下面明确测试的原语，不代表产品后端、模型能力或真实知乎研究已经实现。

当前实施范围按 ADR-0005，运行方案按 [ADR-0006](../architecture/decisions/0006-supervised-research-runtime.md)。本文件保留已完成的暂停/恢复实验作为能力记录，**不要求当前产品实现暂停、恢复、Memory 或桌面发布**。

## 环境与方法

- Windows，Node 24.15.0，pnpm 11.19.0。
- `@mastra/core` 1.66.0、`@mastra/memory` 1.29.0、`@mastra/libsql` 1.22.5、Zod 4.4.3。
- 依赖安装在项目 tmp 下的隔离目录，未改变产品 package.json/lockfile。
- npm 默认下载 core 包超时；改为下载同一官方 tarball，校验 SHA-512 与 registry integrity 一致后，从本地 tarball 安装。包版本不变。
- 安装使用 `--ignore-scripts`；测试成功说明本次环境所需 libSQL native 已可用，不代表其他机器/产品打包均已验证。
- 使用 `pathToFileURL` 构造含中文与空格的绝对 `runtime.sqlite` 路径；通过 `LibSQLStore.init()`/`close()` 与 Mastra 公开 API 操作。
- 没有调用模型、知乎 API、外部账户或有副作用的数据接口；没有读取产品凭证。

## 已实际运行的案例

| 案例 | 实际观察 | 可得结论 |
| --- | --- | --- |
| start → suspend | status=suspended，公开 state reader 返回 gate 路径 | 当前版本能保存暂停快照 |
| 关闭进程 → 新进程 resume | status=success，结果 value 从 7 到 8 | 本地快照可以跨进程恢复 |
| 暂停步骤计数 | prepare 一次，gate 在 suspend/resume 各执行一次，finish 一次 | 暂停步骤会重新执行，步骤中的副作用需回执 |
| 活动步骤 cancel | abortSignal 触发，后续 finish 未执行，存储状态 canceled | 取消可以传播，但步骤需要配合 signal |
| 关闭重试后主动抛错 | failed，fail-step 实际执行一次 | `retryConfig.attempts=0` 与 `retries=0` 在本实验关闭重复执行 |
| 步骤中主动异常退出进程 | 新进程读取状态仍为 running | 异常退出与主动 suspend 不同 |
| 显式 restart | crash-step 再执行，prepare 不再执行，finish 执行，结果 11 | 恢复活动步骤可能重复其外部操作 |

异常退出测试由脚本在活动步骤中执行 `process.exit(73)`，其进程以非零结果结束是预期故障注入，不是研究任务被真实取消。随后的 inspect/restart 均正常结束。没有将此案例扩张为真实网络副作用的恰好一次保证。

## 精简事件证据

```text
suspend: prepare → gate
resume:  gate → finish
cancel:  long-step → aborted
failure: fail-step（一次）
crash:   prepare → crash-step → 进程异常结束
inspect: storedStatus=running
restart: crash-step → finish
```

## 文档、类型与实测差异

官方 [Run.cancel 页面](https://mastra.ai/reference/workflows/run-methods/cancel) 描述返回 `{message: ...}`。1.66.0 已安装的公开 `workflows/workflow.d.ts` 声明 `cancel(): Promise<void>`，本实验实际返回 undefined。

产品不依赖 cancel 的 message/返回对象判断取消成功，应读取框架公开状态、活动执行与产品控制意图，映射为当前产品 cancelling/cancelled。文案不承担协议职责。

官方 [Workflow state reader](https://mastra.ai/reference/workflows/workflow-state-reader) 的 `createWorkflowStateReader()` 可从 `@mastra/core/workflows` 导入，在本实验可用。优先使用 reader 与 `getWorkflowRunById()`，不写框架内部表。

## 推荐装配参数

```ts
{
  retryConfig: { attempts: 0, delay: 0 },
  options: {
    autoRestartActiveRuns: false,
    validateInputs: true,
    shouldPersistSnapshot: () => true
  }
}
```

本次 probe 使用了上述参数。当前产品只验证有界循环、取消与快照读取；报告原子保存和 requestId 去重另由产品事务保证。旧控制版本与恢复回执不属于本期要求。

## 复现实验

保留[实验脚本](probes/framework-probe.mjs)，仅用于开发验证。正式安装相同依赖后，从项目根目录按顺序运行；输出写入指定临时目录，不使用产品数据目录。

```powershell
node docs/research/probes/framework-probe.mjs suspend tmp/research-plan/reproduce
node docs/research/probes/framework-probe.mjs resume tmp/research-plan/reproduce
node docs/research/probes/framework-probe.mjs cancel tmp/research-plan/reproduce
node docs/research/probes/framework-probe.mjs failure tmp/research-plan/reproduce
node docs/research/probes/framework-probe.mjs crash tmp/research-plan/reproduce
# 上一步非零退出是预期；继续以下两条。
node docs/research/probes/framework-probe.mjs inspect-crash tmp/research-plan/reproduce
node docs/research/probes/framework-probe.mjs restart tmp/research-plan/reproduce
```

脚本不是产品代码模板，不实现业务授权、预算、报告幂等或 Secret Store。不要直接把其文件日志方式搬进产品事实存储。

## 产品集成实测（2026-09-13）

下列结果是本仓库实际运行记录，与上面的隔离 probe 分开：

| 项目 | 命令 / 方式 | 实际观察 |
| --- | --- | --- |
| 依赖锁定 | `pnpm add -E`（pnpm 11.19.0） | 产品根目录安装 core 1.66.0 / libsql 1.22.5 / memory 1.29.0，Node ≥22.13.0；另装 `@libsql/client` 0.18.0 与 `proper-lockfile` 4.1.2。产品库复用 libsql 驱动，未引入第二个 SQLite native 模块 |
| 后端构建 | `pnpm build:backend` | `dist/backend/index.mjs` 构建成功，Mastra/libsql 保持 external |
| 类型检查 | `pnpm typecheck:backend` | 通过（含 contracts / application / agent / storage / server） |
| 核心机制 | `pnpm verify:research` | 10 个场景通过：requestId 幂等与冲突、单元搜索与去重复用、未授权全网拒绝、发现引用校验、容错合并降级、预算预占/结算/归还与超额拒绝、报告派生来源与重复保存幂等、取消迟到写入拒绝、重启 interrupted、只读不依赖凭证 |
| 模型接入 | `docs/research/probes/model-probe.mjs` | OpenAI 兼容端点单次 `generate` = 1 次上游请求；`deepseek-flash` 不支持原生 `response_format`，改用 prompt 注入（`jsonPromptInjection`）后结构化输出与 usage 均正常 |
| 主管/单元真实运行 | `node --use-system-ca src/server/http-server.ts` + HTTP 创建任务 | 一次真实问题（家用 NAS）端到端完成：127 findings / 227 来源 / 151 查询 / 192 模型推理，报告 `completed + partial`，stopReason=source_saturated |
| 并行单元 | 同上，观察 stage 与并发 | 主管派发最多 3 个单元并行执行，单元使用官方工具循环；单单元失败不阻塞其他单元 |
| 重启收敛 | 强杀进程后重启 | 日志 `重启收敛：1 个未完成任务标记为 interrupted`；已完成报告重启后仍可读；不重放外部请求 |
| 取消 | `POST /cancel` | 活动执行返回 202 + cancelling，收尾后 cancelled；已保存来源保留；终态重复取消 200 幂等；无报告时 report 返回 409 REPORT_NOT_READY |
| 遗留锁 | 强杀后立即重启 | 在 `stale`（60 秒）窗口内拒绝第二写入者；窗口过后可取得独占权并正常启动 |
| 核心机制验证 | `pnpm verify:research` | 场景数随后续改动更新：直答快答同步完成与幂等、档位→直答模型映射、失败映射 502 且任务 failed、模型未配置时 Ultra 503 且快答不受影响（原「非桌面创建 Ultra 403」场景随 [ADR-0008](../architecture/decisions/0008-web-only-server-hosted-research.md) 撤销桌面门禁改为就绪判定） |
| 直答快答 fast | HTTP 创建 `tier=fast` | 真实调用成功：2.4 秒同步返回 completed，`zhida-fast-1p5` 正文真实，usage 记 1 次模型请求，token 上游未返回记 null |
| 直答快答 agent | HTTP 创建 `tier=agent` | 真实调用成功：26.5 秒同步返回 completed，`zhida-agent` 返回检索增强内容 |
| Ultra 桌面门禁 | HTTP 创建 `tier=ultra`（两种启动配置） | 历史记录（桌面门禁已由 [ADR-0008](../architecture/decisions/0008-web-only-server-hosted-research.md) 撤销）：当时默认配置返回 403 `ULTRA_DESKTOP_ONLY`；`KANSHAN_EDITION=desktop` 时 202 受理并进入执行，随后取消正常 |

未验证项见文末列表；真实研究质量问题（引用支持率、覆盖评分）尚未人工评估。

### 环境注意

本机访问模型端点时遇到 TLS 中间证书（`SELF_SIGNED_CERT_IN_CHAIN`）。产品启动命令使用 Node 24 的 `--use-system-ca`，只追加信任系统根证书，未降低 TLS 校验、未使用 `NODE_TLS_REJECT_UNAUTHORIZED`。该开关是否需要在其他部署环境保留，取决于实际证书链，不属于研究逻辑。

## 尚未验证或仅部分验证

已由上述实测覆盖：调查单元官方工具循环与步级 usage 计量、共享预算预占/归还、单活动执行、取消与迟到写入、报告原子保存与幂等、重启后只读与 interrupted 收敛、受限并行与动态计划。

仍需验证：

- 一次定向核验回查（`maxRepairPasses`）走的是哪条分支：真实运行中核验未报出需要回查的严重问题，因此该分支只通过代码与机制检查，未在真实链路里执行过。
- 主管关闭子问题（`closeQuestions`）与新增子问题在真实运行中的实际触发情况；本轮运行以来源饱和收尾。
- 摘要不足以支持结论时的真实质量表现：引用支持率、覆盖评分尚未人工抽查；本文件不给出质量分数。
- 中文/空格数据目录之外的其他部署环境、随包 Node、Electron 与原生凭证桥、Memory 会话、OAuth 与私人资料，均未验证且已后置。

## 来源

1. [npm core 1.66.0](https://www.npmjs.com/package/@mastra/core/v/1.66.0)、[memory 1.29.0](https://www.npmjs.com/package/@mastra/memory/v/1.29.0)、[libsql 1.22.5](https://www.npmjs.com/package/@mastra/libsql/v/1.22.5)：版本与 peer dependencies。
2. [Suspend and resume](https://mastra.ai/docs/workflows/suspend-and-resume)、[Snapshots](https://mastra.ai/docs/workflows/snapshots)：官方恢复行为说明。
3. [Run.cancel](https://mastra.ai/reference/workflows/run-methods/cancel)、[Run.restart](https://mastra.ai/reference/workflows/run-methods/restart)：控制入口。
4. [Error handling](https://mastra.ai/docs/workflows/error-handling)、[createWorkflow](https://mastra.ai/reference/workflows/workflow)：重试与持久化配置。
5. [libSQL](https://mastra.ai/integrations/databases/libsql)：本地存储公开 API。
