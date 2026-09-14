# ADR-0003：采用 Mastra 作为 Agent 与研究工作流底层框架

> 当前适用范围由 [ADR-0005](0005-deep-research-mvp-scope.md) 更新。Mastra 选型继续有效；Memory、桌面发布和暂停恢复验证不再是本期前置要求。 下文保留决策历史，不能按其中被覆盖的清单开发。

日期：2026-09-13 · 状态：accepted（框架选型已确定，接入实现尚未完成）。

## 背景

产品需要在 Windows 本地桌面中同时提供连续对话和可检查、可暂停、可继续的深度研究。数据与任务保存在本机，模型可使用云端 API；现有技术栈为 TypeScript / Node / Electron，已有知乎能力适配与研究应用命令，前端与后端需要独立推进。

## 决策

1. 正式采用 Mastra 的 Agent 与 Workflows 作为唯一底层执行框架。使用官方 `@mastra/core`，会话历史使用 `@mastra/memory`，框架持久化使用 `@mastra/libsql` 的本地文件模式。
2. 模型通过 Mastra 官方模型路由或受支持的 provider 接口接入；不另写工具循环、provider payload 转换器或通用工作流引擎。
3. 不同时引入 Pi、LangGraph 或其他 Agent / 工作流运行时。比较记录保留在技术选型文档，重新选型需要新的 ADR。
4. 深度研究是独立的 ResearchTask，由 Mastra Workflow 执行；工作流按需调用 Agent 和确定性业务命令，不通过聊天 Run 队列推进。聊天、CLI、页面使用同一应用入口启动与观察任务。
5. 授权、预算、计划版本、来源快照、引用、报告版本和操作幂等由产品应用层拥有。工作流步骤调用这些命令，不在框架 adapter 或前端复制业务政策。
6. Mastra 存储负责消息历史和工作流执行快照；产品数据库负责领域事实、请求意图与框架执行引用。研究执行进度从框架快照投影，不再建立独立可写的阶段进度表。
7. 共享 DTO 与工具参数采用项目已有的 Zod 体系；产品契约不暴露 Mastra 内部对象。内部框架定义集中在 `src/agent`，HTTP、UI 和知乎 adapter 不依赖框架类型。
8. 保留独立本地 Node 后端与 Electron 进程监督方案。框架开发服务器和 Studio 仅作开发辅助，不成为发布运行的前提。

## 选择理由与取舍

- 同一 TypeScript 框架覆盖 Agent 与工作流，减少运行时之间的集成工作。
- 确定性检索、引用检查与模型分析可以组合，符合研究流程的实际结构。
- 本地文件存储符合数据保存在本机的要求；现有知乎适配和应用命令可以继续使用。
- 需要接受框架的步骤、消息和存储约定；升级时验证快照兼容性与实际执行行为。
- 框架不会保证引用论证正确，也不会自动解决预算、幂等或跨存储原子性。研究方法和产品不变量仍由本项目实现。

Pi 与自有编排、LangGraph、全自研路线的比较见 [技术选型](../../agent-framework-selection.md)。不以未经实测的性能或研究质量优势作为选型依据。

## 对已有设计的影响

- ADR-0001、ADR-0002 和后端/API 文档同步到本决策；不再采用原先的原生 JSONL 会话、TypeBox 绑定或聊天队列编排研究的方案。
- 普通 Run 表示一次聊天任务，ResearchTask 表示研究任务；两者均不是 Mastra 内部 run 的别名。
- 对话正文通过 Memory 的公开接口读写，框架快照通过官方存储接口管理；禁止直接修改框架内部表。
- 数据目录同时包含产品 SQLite 和框架本地数据库。保存成果与框架 checkpoint 之间使用操作回执恢复，不假设共享事务。
- 运行中引导、上下文处理、Skills 等按锁定版本能力适配，不把其他框架的方法名或保证沿用为已支持功能。

## 落地验证

选型已确定，验证是实施工作，不是重新申请采用许可。首个切片安装兼容版本并锁定，验证随包 Node 24、Windows 数据库依赖、真实工具往返、消息重开、工作流暂停继续、异常退出、取消和重复保存。

当前 npm 信息核对点为 `@mastra/core` 1.66.0、`@mastra/libsql` 1.22.5，尚未验证完整包组合。`@mastra/memory` 及其他实际使用包须随首次安装核对 peer dependencies；本次文档同步不修改 package.json 或锁文件。

后续开发方案核对了 `@mastra/memory` 1.29.0，并以 core 1.66.0 / memory 1.29.0 / libsql 1.22.5 完成若干[隔离工作流实验](../../research/framework-verification.md)。它补充上述历史核对点，产品根依赖、真实模型和发布组合仍待实施验收；完整证据契约见 [ADR-0004](0004-zhihu-research-evidence.md)。

出现不满足核心不变量的运行问题时先修正集成；需要更换底层框架、存储 owner 或恢复模型时记录新 ADR，不引入静默备用运行时。

## 依据

- [Mastra Agent](https://mastra.ai/docs/agents/overview)
- [Mastra Workflows](https://mastra.ai/docs/workflows/overview)
- [Memory](https://mastra.ai/docs/memory/overview)
- [工作流快照](https://mastra.ai/docs/workflows/snapshots)
- [libSQL 本地存储](https://mastra.ai/reference/storage/libsql)
