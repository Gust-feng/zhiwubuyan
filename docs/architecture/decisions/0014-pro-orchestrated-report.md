# ADR-0014：深度研究 Pro 改为单请求内的多轮编排并产出结构化报告

日期：2026-09-15 · 状态：accepted。

## 背景

[ADR-0011](0011-pro-only-freeze-ultra.md) 冻结自研 Ultra 引擎，网页端 Pro 改由知乎直答单次调用承接；[ADR-0013](0013-pro-reference-material.md) 又给 Pro 加上一次检索与参考资料。二者共同把 Pro 定成"单轮检索增强回答"，并明确"没有自主调查、递归拆题或多轮核验"。

Ultra 无法上服务端的约束没有变（长驻进程 + 本地 SQLite + 进程内锁，函数式运行面接不了，见 [probes/ultra-serverless-packaging.md](../../research/probes/ultra-serverless-packaging.md)）。但 Pro 的能力来源是知乎自己的两个接口——检索与直答——它们都是秒级、无状态、服务端友好的。据此可以把研究深度做进 Pro 本身，而不再依赖被冻结的引擎。

## 决策

1. **Pro 改为单请求内跑完的多轮编排**，仍用 `tier: "pro"`：拆题 → 逐子问题检索取证 → 覆盖判断 → 成稿。
   - 拆题与覆盖判断走直答 `zhida-fast-1p5`（非流式、要求 JSON）；成稿走 `zhida-agent`（检索增强、可流式）。
   - 轮数与预算有界：最多 3 轮、总预算 240 秒、检索最多 16 次、模型调用最多 10 次。总预算按函数执行上限倒推，落在 Hobby 的 300 秒上限内，**不分部署计划档都能承接**。
   - 只依赖知乎检索与直答，不引入引擎、store、libsql、Mastra；不落库、不做长驻进程。编排逻辑落在 Application command（`createResearchProCommand`），提示词拆到 `research-pro-prompt.ts`。
2. **Pro 产出结构化报告**：成稿固定六节 Markdown（摘要 / 背景与范围 / 主体分析 / 结论与建议 / 分歧与争议 / 缺口与限制），主体分析按子问题各起一个三级标题；引用为 `[编号](链接)`。`TaskDetail.plan` 与 `TaskDetail.analysis` 对 Pro 档开始填充；`findings` 仍为空，不进入 Ultra 的证据体系。
3. **界面与 Ultra 共用同一工作区壳**：主栏放报告（Pro 为本次生成的报告，Ultra 为已保存报告），右侧详情面板提供「研究要点（子问题与取证状态）/ 研究活动 / 来源」三个页签；引用点击定位到来源。新增 `plan` 与 `coverage` 两个流式事件驱动面板状态。
4. **Pro 报告不是证据级核验**，也不等同 Ultra 报告：资料仍是检索摘要，编号由应用分配，不建来源快照、不做逐条引文存在性校验。界面与文案如实标注"基于检索摘要的多轮编排，未做证据级核验"。
5. **降级不整单失败**：拆题连续两次解析失败 → 退回单轮取证（用原问题检索一次）后成稿；某轮覆盖判断失败 → 保留已得资料照样成稿；时间预算到点 → 用已有资料成稿。单次检索失败只记账，不伪造成功。

## 契约归属

- `src/contracts/research.ts`：`ResearchProEvent` 新增 `plan`、`coverage`；新增 `ProPlanOutput`、`ProCoverageOutput` 模型输出 schema；`AnswerMaterial.sources` 上限由 10 提到 24（多轮跨子问题收集）。`TaskDetail`、`Limits`、`Usage` 形状不变。
- `src/application/research-baseline.ts`：新增 `PRO_LIMITS` 与 `PRO_ORCHESTRATION`，作为 Pro 预算与运行参数的唯一 owner（与 Ultra 的 `DEFAULT_LIMITS` 分离）。
- `src/application/research-pro.ts`：编排器；`src/application/research-pro-prompt.ts`：提示词与 JSON 解析。

## 与既有决策的关系

- **修订 [ADR-0007](0007-research-tiers-zhida.md) 第 2 条在 Pro 档的约定**：Pro 不再只是"无来源引用的快答"，而是带参考资料与覆盖判断的结构化报告。fast/thinking 仍是快答，边界不变。
- **修订 [ADR-0013](0013-pro-reference-material.md) 第 1 条的"没有自主调查、递归拆题或多轮核验"**：Pro 现在做递归拆题与有限多轮取证。ADR-0013 的资料规则（不可信上下文、只用给定链接、编号由应用分配、不进 Ultra 来源表）继续有效。
- 不改动 [ADR-0011](0011-pro-only-freeze-ultra.md) 的冻结结论：`src/agent/**`、`src/backend/**` 与 Mastra/libsql 依赖仍冻结、不上服务端；网页端仍不落库、任务列表仍返回空。
- 与 [ADR-0006](0006-supervised-research-runtime.md) 一致：主管—并行调查—覆盖判断—成稿的模式保留，只是 Pro 用无状态应用命令实现了它的有界轻量版。

## 取舍与未完成

- **Pro 与 Ultra 仍有本质差别**：Pro 不保存来源快照、不做引文级核验、不产出 findings；"可追溯"不等于"已核验"。追求证据强度的场景仍属 Ultra（暂只在本机运行面）。
- **多轮提高额度消耗**：一次约 3–6 次直答 + 3–12 次检索。登录与限流（scope `research-pro`）保持不变，必要时收紧额度。
- **直答结构化输出的稳定性是主要依赖**：拆题与覆盖判断依赖模型返回合规 JSON，已用"一次重试 + 降级"兜底，但不同问题下的成功率需要真实运行观察。
- **未做**：来源正文抓取（仍限摘要）、跨请求缓存、编排过程的可视化时间线（当前只列子问题与状态）。
