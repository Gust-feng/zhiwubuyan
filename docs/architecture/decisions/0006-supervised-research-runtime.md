# ADR-0006：采用主管与受限调查单元的深度研究运行架构

日期：2026-09-13 · 状态：accepted（架构已选定；实现进度另行记录）。

## 决策背景

用户要求直接选择当前最合适的运行方案，不再以 A/B 或大规模研究评测作为架构选型前置条件。结合知乎摘要检索的边界、已有 TypeScript/Mastra 基础及持续研究需求，确定采用主管协调受限调查单元的结构。这里的选择是工程判断，不宣称存在已证明的普适“理论最优”。

公开依据包括 [Anthropic Research 的主管/子 Agent 架构](https://www.anthropic.com/engineering/multi-agent-research-system)、[Open Deep Research 固定版本源码](https://github.com/langchain-ai/open_deep_research/blob/1b7d2e80db9faa586165c60e09096dbbfd483a64/src/open_deep_research/deep_researcher.py)和 [Mastra Workflows](https://mastra.ai/docs/workflows/overview)。采用这些运行原则，不照搬其全部组件或预算。

## 决策

1. 一个 ResearchTask 对应一个顶层 Mastra Workflow。Workflow 管准备、调查、成稿、核验、有限回查和最终保存，不把固定检索轮数作为产品策略。
2. 一个 Research Supervisor 在全局证据视图上拆题、重规划、分配问题和建议收尾。应用命令验证并提交决定；主管是可变研究计划的唯一写入入口。
3. 使用可复用的 Researcher Agent 定义，每个 Research Unit 启动独立上下文，围绕一个明确子问题运行官方工具循环。默认最多三个单元并行；独立任务可并行，有信息依赖的调查在新发现产生后再创建。
4. 用户问题、来源授权和总预算在任务创建时固定。内部子问题、优先级、调查方向和可解释的关闭原因允许变化。前端计划保持只读，不增加人工编辑或确认流程。
5. 产品研究状态保存计划、发现、证据关联与调查记录；模型仅接收当前需要的投影。以带引用的结构化 Finding 表达支持、反例、条件和限制，不引入图数据库或通用任务图引擎。
6. 产品仍围绕任务、来源、报告三类数据。计划、findings 和调查记录用任务内有类型 JSON；来源是不可变快照。子问题覆盖度属于业务判断，活动单元和工作流步骤属于框架执行状态，两者不得形成两套可写调度状态。
7. 调查单元只能提交本任务的来源与发现，以及新增问题建议，不能自行扩大权限、改变目标、改写全局计划或启动其他 Agent。所有结果在任务内通过同一应用命令校验并合并。
8. 预算区分搜索请求、模型实际推理步骤和并发。调用前原子准入/预占，执行后结算；所有子单元共享全局预算，不得分别获得完整任务额度。取消后准入与迟到写入一起失效。具体默认参数由开发方案维护。
9. Writer 使用已保存 findings 与证据写报告；Verifier 检查关键断言。重要问题可触发一次定向回查，再改写并复验；无预算时删除或弱化不受支持的断言并注明缺口，仍有严重引用问题则不保存正式报告。
10. 继续保留请求幂等、报告原子保存、单活动顶层任务、HTTP 轮询和重启后 interrupted。本期不增加任意步骤恢复、会话 Memory、个人账号、全局资料库、桌面集成或备份。
11. 优先复用官方 Agent 工具循环、Workflow 控制流及并发原语。应用层只实现研究决策约束、证据处理和预算，不自研通用 Agent loop、执行引擎或 provider 协议。
12. 直接按本方案实施。取消将多方案对比、搜索预算曲线和多问题 benchmark 作为首版前置；开发仍保留必要类型检查、主链路检查及数据/取消边界验证，不把尚未验证的质量写成实测结果。

## 覆盖与兼容边界

本 ADR 覆盖 ADR-0005 中固定计划、显式串行检索分析、固定轮数/每轮查询数、只做文稿修正的研究策略，以及由此产生的旧 DTO 字段。ADR-0005 的只做研究范围、最终 outcome、保存和取消规则继续有效。

HTTP 路径、创建请求和最终任务状态保持现有约定。plan、analysis、queries、limits 和报告段落的目标 schema 按[后端 API](../../backend-api.md)更新；移除 maxRounds、maxQueriesPerRound 与 query.round，不设置兼容别名。

当前已有按旧方案开发的研究命令、schema 和存储骨架，需要按[实施任务](../../research/implementation-tasks.md)增量调整，不覆盖他人改动。目标产品 schema 更新为 v2；已有 v1 开发数据库由显式重置命令处理，不启动时删除，不建设旧开发数据迁移层。

当前唯一实现入口为[开发方案](../../deep-research-development-plan.md)、[API](../../backend-api.md)和[开发提示词](../../research/implementation-prompt.md)。云端调研报告是参考资料，其中未验证的推测、失效引用和扩张的首版清单不是开发指令。
