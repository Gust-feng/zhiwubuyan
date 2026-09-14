# Agent 与研究工作流技术选型

运行架构已按 [ADR-0006](architecture/decisions/0006-supervised-research-runtime.md) 确定为主管、受限并行调查单元与核验回查，直接实施，不等待选型 A/B。

日期：2026-09-13 · 状态：已确定采用 Mastra；当前范围由 [ADR-0005](architecture/decisions/0005-deep-research-mvp-scope.md) 收敛为研究后端。

依赖声明不代表产品接入完成；固定版本的部分框架原语已完成[隔离验证](research/framework-verification.md)。开发按[完整方案](deep-research-development-plan.md)推进，不能将该实验扩大为真实模型、知乎资料或桌面发布已通过。

正式决策见 [ADR-0003](architecture/decisions/0003-mastra-foundation.md)。本文保留选择理由、代价与未采用方案的比较；后续开发按 Mastra 路线推进，不再将框架选择视为待确认事项。

## 结论

以本地桌面、TypeScript、知乎数据接入、深度研究和有限开发时间为约束，确定采用 **Mastra 的 Agent + Workflows** 作为底层框架。LangGraph、Pi 与全自研保留为比较记录，不作为并行实现或自动备用运行时。

不建议从零开发通用 Agent loop、provider 适配和持久化工作流引擎。研究方法、证据规则和产品命令仍需自行实现，这部分直接决定产品价值。

选择来自现有代码和官方能力文档的匹配，尚不是 Windows 打包、运行可靠性或研究质量的实测结论。首次接入用一条纵向流程验证所选框架，锁定实际依赖版本并完成核心生命周期验证。

## 1. 实际要选择什么

| 层次 | 需要解决的问题 | 复用与自研边界 |
| --- | --- | --- |
| 模型调用 | provider、流式响应、工具参数、模型错误 | 复用成熟 SDK / 框架 |
| Agent 执行 | 上下文、工具循环、结构化输出、取消 | 优先复用，不自行维护完整循环 |
| 工作流执行 | 步骤、分支、有限补查与快照；暂停恢复后置 | 优先采用现成框架 |
| 研究方法 | 拆题、查询策略、来源质量、矛盾与反例、停止标准 | 产品自行定义，框架执行 |
| 产品数据 | 任务、来源快照、分析、报告与预算 | 由明确应用命令拥有 |

Pi 与 LangGraph 主要解决不同层次的问题，可以组合；但“能够组合”不等于首版需要同时引入。若一个框架能满足 Agent 和研究工作流，应先减少运行时与数据模型的数量。

## 2. 项目现状对选型的影响

- 目标项目采用 TypeScript / Node / Electron，已有 Zod 和知乎 HTTP 能力适配。
- 当前 runtime 尚未接入 Pi，研究会话仍使用内存 Map。更换候选主要是修订设计，没有已完成的 Pi 集成需要迁移。
- 可复用资产是知乎适配、身份与错误处理、研究应用入口及前端交互。选框架不要求替换这些资产。
- 数据和任务保存在本机，模型可使用云端 API；首版不应依赖额外常驻云服务才能运行。
- 前端正在开发，后端需独立验证。框架自带的 Studio 可辅助开发，不作为产品前端或领域 API。

[后端设计](backend-design.md)、[研究工作流](deep-research-workflow.md)和[接口文档](backend-api.md)已按 ADR-0005 收敛。研究采用独立 Workflow 和 Zod 契约，不启用 Memory；设计同步不表示产品已完成。下列候选表保留框架能力比较，不是本期功能清单。

## 3. 候选比较

| 路线 | 可直接复用 | 仍需承担的工作 | 对本项目的判断 |
| --- | --- | --- | --- |
| Pi + 自有研究编排 | Agent 工具循环、事件、模型与会话能力 | 研究阶段执行、检查点、恢复与工作流观察面的较多集成 | 当产品重点是高度可控的交互 Agent 时有优势；仅为研究工作流采用 Pi，节省的工作有限 |
| LangGraph JS + 模型/Agent 节点 | 图状态、条件分支、循环、checkpoint、人工介入、流式过程 | 研究图、领域状态、模型节点与产品会话的组合 | 研究路径复杂、并行子问题较多时适合；作为备选 |
| Mastra Agent + Workflows | Agent、结构化步骤、控制流、暂停/继续、快照、存储适配 | 研究策略、知乎工具、权限、引用、成果幂等与桌面接入 | 已采用，能在同一 TypeScript 框架中覆盖 Agent 和工作流 |
| 全自研运行时 | 完全控制行为与依赖 | 模型协议、工具循环、流式处理、恢复、版本与长期维护 | 与当前开发时间约束不匹配，不推荐 |

Pi 是通用 Agent 能力库，并不限于编程用途。LangGraph 可以编排普通函数和自定义节点，不要求使用 LangChain Agent，也可以将 Pi 作为节点；但其 JavaScript 包有自身依赖，不能将“不强制采用 LangChain Agent”理解为零依赖。

Mastra 也不是零成本：需要接受其步骤、存储和模型接入约定，依赖面更广。采用前验证关键行为，并锁定版本，避免业务模块直接依赖框架内部类型。

## 4. 采用 Mastra 的理由

选择理由按对当前产品的价值排序：

| 项目需求 | 选择 Mastra 的理由 | 实际收益 |
| --- | --- | --- |
| 研究既有固定流程，也有需要模型判断的步骤 | Workflows 可组合确定性函数、外部 API、Agent 与工具 | 检索和校验由代码执行，分析和补查建议交给模型，研究过程更容易检查 |
| 有限开发时间 | 同一框架提供 Agent、工作流和持久化适配 | 减少拼接运行时，把开发时间用于研究策略和证据质量 |
| 现有后端与桌面采用 TypeScript | 与 Node、现有 Zod 和知乎 TypeScript 适配器契合 | 保留现有取数与业务代码，无须增加另一种语言的服务；这不是 Mastra 独有的优势，但符合项目现状 |
| 数据本地保存，模型可以调用云端 | 工作流可在本地后端运行，libSQL adapter 支持文件数据库 | 不必为基本执行与持久化额外部署云端工作流服务 |
| 前后端需要同时推进 | 工作流可通过后端代码/API 独立执行，Studio 可辅助检查步骤输入输出 | 后端先验证研究链路，前端围绕产品 DTO 和轮询接口开发，不必等待完整页面 |
| 当前尚未形成 Agent 集成 | 没有已实现的 Pi 运行时需要迁移 | 现在选择的切换成本低，可以用最小真实流程检验判断 |

当前需要能够多轮补查的研究流程，并缩短后端开发链路。Mastra 支持函数、外部 API、Agent 步骤和有界控制流，libSQL 支持本地文件快照。暂停/继续是框架可提供的能力，当前不产品化。

这让首轮验证可以直接覆盖完整流程，不必先搭一套独立研究执行引擎。现有 TypeScript 和 Zod 也能继续使用。

推荐验证形态：

```text
桌面 / CLI / 聊天入口
  → 研究应用命令
  → Mastra Workflow
      → 确定性步骤：知乎查询、去重、读取来源、引用校验
      → Agent 步骤：研究计划、证据分析、定向补查建议、报告草稿
  → 应用命令校验并保存研究成果
```

工作流执行进度由框架的快照机制管理，产品保存研究目标、授权、来源、成果与必要关联。UI 状态由应用层投影；不得再维护一份独立可写的工作流进度。存储适配器管理自己的表，不能绕过 API 修改框架内部表。

框架 checkpoint 与产品成果不假定原子提交。当前报告与任务 completed outcome 同产品事务保存；重启保留报告，把未完成任务标记 interrupted，不恢复框架执行。摘要放产品存储，工作流上下文按需携带引用。

首版不同时接入 Mastra Agent 和 Pi Agent。只有真实需求证明 Mastra 缺少所需控制能力，才评估替换执行节点或改用其他路线。

## 5. 重新选型的触发条件

以下是未来有实证瓶颈时重新评估的条件，不是当前多框架开发计划。变更底层框架先记录新的 ADR，不让适配层静默切换。

- **选择 LangGraph JS**：多条研究分支需要合并、回溯、独立检查点或更细的图调度，且这些是首版明确需求。它已有相应编排能力，应先评估，避免在轻量方案上逐渐自研图引擎。
- **选择 Pi**：产品重点转向通用桌面 Agent，交互式引导、上下文和工具循环控制比固定研究工作流更核心；同时接受自行补足研究任务调度与恢复的成本。
- **选择少量自有编排**：如果未来只保留几次固定调用，自有顺序函数也可行。当前仍有多轮分析、补查、结构化输出和取消，已选 Mastra 可直接覆盖；缩减产品范围并不要求重新制造框架。

不因“将来可能换框架”建立通用插件平台或同时维护所有 adapter。首版只隔离模型/工具、研究应用命令和产品 DTO 这些明确边界。

## 6. 接入阶段的最小验证

使用当前锁定的 Mastra，直接完成主管分配任务、Researcher 官方工具循环、受限并行、证据合并、成稿核验与一次回查。已有原语记录见[框架验证记录](research/framework-verification.md)。

实施者核对必要的类型、主链路、预算计量和取消/保存边界即可，不要求用户组织多方案实验或等待预算曲线。真实效果未验证时如实注明；后续质量优化不重新打开已确定的架构决策。

## 7. 官方依据

2026-09-13 查询的 npm 稳定标签：pi-agent-core / pi-ai `0.85.1`、Mastra core `1.66.0`、Mastra libSQL `1.22.5`、LangGraph JS `1.4.15`、LangGraph SQLite checkpointer `1.0.4`。这些是资料核对点，不是已验证的锁定组合。

- [Pi Agent Core 官方说明](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/README.md)：Agent 工具执行、流式事件及独立 Session backend 能力。
- [Mastra Workflows](https://mastra.ai/docs/workflows/overview)：步骤、控制流、Agent 与工具组合。
- [Mastra 暂停与继续](https://mastra.ai/docs/workflows/suspend-and-resume)、[执行快照](https://mastra.ai/docs/workflows/snapshots)：跨调用/重启恢复已暂停工作流；仍需检验异常退出语义。
- [Mastra libSQL 存储](https://mastra.ai/reference/storage/libsql)：本地文件部署；必须使用持久化文件配置，不能用内存示例代替。
- [LangGraph JS 概览](https://docs.langchain.com/oss/javascript/langgraph/overview)、[持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)：状态编排、checkpoint 与人工介入。SQLite adapter 的存在不替代桌面发布验证。
- [XState 纯状态转换](https://stately.ai/docs/pure-transitions)、[持久化](https://stately.ai/docs/persistence)：可作为轻量编排基础，但其本身不交付完整研究任务执行服务；在当前减少底层开发量的目标下不列为首选。
