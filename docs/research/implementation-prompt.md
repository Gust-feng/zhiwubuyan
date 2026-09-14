# 深度研究开发提示词

下面任务直接交给实现 Agent。架构已确定，不要求先做多方案实验。

---

在当前知乎项目中实现基于 Mastra 的深度研究后端。先读 AGENTS.md、架构基线、开发维护规则，然后按以下入口工作：

1. docs/architecture/decisions/0006-supervised-research-runtime.md
2. docs/deep-research-development-plan.md
3. docs/backend-api.md
4. docs/research/implementation-tasks.md
5. docs/research/contract-examples.md 和 framework-verification.md

用户目标是直接开发一套明确的深度研究架构，不再等待 A/B、预算曲线或多题 benchmark 决定路线。采用一个顶层 Mastra Workflow、一个 Research Supervisor、最多三个独立上下文的并行 Research Unit，以及 Writer/Verifier。角色可以共享模型配置，工具循环使用官方 Agent，不自研执行引擎。

用户问题、来源授权和任务总预算固定；内部计划可新增子问题、调整优先级、合并重复方向并解释关闭原因。主管通过唯一应用命令更新全局计划。单元围绕一个清晰问题自主调用 searchZhihu、明确允许的 searchWeb 与只读的 readSource，提交来源、带证据的 Finding 和后续建议；不能改全局目标或启动其他 Agent。

研究按缺口、反例、适用条件和来源饱和程度继续，不设置固定总轮数。单元局部步数/时间额度防止失控，主管可为未解决问题创建新的调查单元。所有角色共享全局预算，具体默认值按开发方案第 7 节；每次模型步骤与搜索发送前原子准入/预占，未知消费不返还，已知未用额度可释放。

数据仍围绕任务、来源、报告三类表。plan、findings、analysis、queryLog 和单元结果回执使用 typed JSON；Mastra 保存执行阶段和活动单元，产品不维护第二套可写调度状态。目标 schema v2，移除 round/maxRounds/maxQueriesPerRound 等旧协议，不加兼容别名。已有开发数据不兼容时明确报错，仅通过显式命令重置。

知乎 API 只提供当前实际摘要和元数据，不能假定正文/分页。来源 ID、原始 URL、时间语义要保留。Finding 的 quote 必须来自实际读取的摘要；原始证据、模型归纳和来源独立性未知要区分。工具身份从可信任务上下文绑定，不能由模型切换任务。

Writer 引用已存 findings，由代码派生来源。Verifier 检查关键断言，必要时安排一次定向回查，之后改写并再次核验。未通过检查不能保存正式报告。报告与 completed outcome 原子提交，一任务最多一份；重复请求幂等，取消终止全部单元并阻止迟到提交，重启未完成任务标 interrupted、不自动重放。

先检查源码和 Git。当前已经有按旧方案编写的 schema、研究命令、存储及框架代码，复用正确部分，替换旧研究策略，保留并行改动。按 R1–R3 持续完成，不停在计划。不重做前端，也不加入聊天、Memory、OAuth、私人资料、任意步骤恢复、全局资料库、桌面发布或通用插件系统。

完成必要类型/后端构建、主链路与数据/预算/取消边界检查即可；不安排额外架构选型实验。缺少真实服务配置时完成本地机制并如实说明真实效果尚未验证，不伪造成绩，不要求用户组织测试。不要把云端研究报告中的所有图、账本和评分器自动加入首版。

最终说明实际实现、运行方式、验证事实和剩余限制。没有明确要求时不自行提交或推送，不改无关目录。
