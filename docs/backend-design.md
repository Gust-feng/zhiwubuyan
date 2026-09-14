# 深度研究后端设计入口

当前只做研究的范围按 [ADR-0005](architecture/decisions/0005-deep-research-mvp-scope.md)，运行架构按 [ADR-0006](architecture/decisions/0006-supervised-research-runtime.md)。方案已选定，不以对照实验作为启动开发条件。

```text
HTTP -> 应用命令 -> 顶层 Mastra Workflow
  -> 一个 Supervisor：动态拆题、任务分配、重规划
  -> 最多三个 Research Unit：独立上下文 + 官方工具循环
  -> 共享来源与 Finding -> Supervisor 继续决策或收尾
  -> Writer -> Verifier -> 一次定向回查（需要时）-> 改写并复验
  -> 同事务保存报告和 completed outcome
```

用户目标、来源权限与任务总预算固定；内部计划由主管统一更新。调查单元可自主调用知乎搜索、明确允许的全网搜索及已存来源读取，所有调用受应用层准入与共享预算控制。Mastra 承载实际执行与工具循环，应用只实现研究政策和证据规则。

产品库仍为任务、来源、报告三类数据；动态计划、findings、合并分析及调查记录使用任务内有类型 JSON。框架保存小型运行快照，避免把所有资料塞进工作流状态。不引入图数据库、通用任务图引擎或长期 Agent 网络。

单活动顶层任务、HTTP 轮询、取消与迟到写入保护、报告幂等保存、重启后 interrupted 均保留。后端不依赖聊天、Memory、Space、个人账号、桌面进程或安装包。

当前有按旧策略开发的 schema、研究命令和存储代码；接手时保留可复用部分，按目标 v2 契约替换 round/固定计划字段。文档定稿不表示代码已完成。

- [开发方案](deep-research-development-plan.md)：运行角色、数据、预算与故障处理。
- [后端 API](backend-api.md)：当前目标契约。
- [实施任务](research/implementation-tasks.md)与[开发提示词](research/implementation-prompt.md)：直接执行入口。
- [契约示例](research/contract-examples.md)：离线结构示例。
- [质量案例](research/quality-cases.md)：后续改进参考，不是首版前置。
- [框架验证记录](research/framework-verification.md)：已验证原语及实际边界。
