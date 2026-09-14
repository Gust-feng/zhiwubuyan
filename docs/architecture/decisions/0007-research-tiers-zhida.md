# ADR-0007：研究产品分四档——问答模式、深度研究 Pro 与 Ultra

日期：2026-09-13 · 状态：accepted（分档方向不变；第 1 条「Ultra 仅桌面版可创建」与第 5 条的桌面归属已被 [ADR-0008](0008-web-only-server-hosted-research.md) 修订：Ultra 改由服务端承接，撤销 `ULTRA_DESKTOP_ONLY` 桌面门禁）。

## 背景

深度研究（ADR-0006 主管/并行单元架构）是重资源能力：45 分钟上限、200 次模型推理、仅适合桌面本地运行。用户需要轻量化的研究/问答能力，且确认知乎直答的三种模式（`zhida-fast-1p5` / `zhida-thinking-1p5` / `zhida-agent`）都应纳入产品。经讨论确定产品分档：知乎直答的前两个模式作为首页问答模式，直答检索增强模式与自研深度研究构成深度研究的 Pro/Ultra 两个层次。

## 决策

1. 产品分四档，创建请求以必填 `tier` 字段判别（不设隐式默认，避免漏传时误撞桌面门禁）：
   - **首页问答模式**：`fast`（快速回答）与 `thinking`（深度思考）。对知乎直答的一次上游调用，同步执行、同步返回；产出为独立快答对象，无来源引用。
   - **深度研究 Pro**：`pro`，对应直答 `zhida-agent`（检索增强）。同步执行，产出快答对象。
   - **深度研究 Ultra**：`ultra`，即 ADR-0006 现状（主管 + 最多三个并行调查单元 + 核验回查），产出带引用的研究报告。**由服务端承接**（见 [ADR-0008](0008-web-only-server-hosted-research.md)）：创建时要求已配置研究模型与知乎凭证，未配置分别返回 `MODEL_NOT_CONFIGURED` / `ZHIHU_NOT_CONFIGURED`。
2. 快答（fast/thinking/pro）**不是研究报告**：无来源引用、无 findings、不进入证据体系，明确标注"知乎直答生成内容，未附原始来源"（直答接口不返回答主或原始条目）。快答与 Ultra 报告是两种产物，前端按档位分开展示并诚实标注差异。
3. 直答档不选 `zhida-thinking` 之外再叠加检索的组合；Pro 直接使用直答的检索增强模式。`reasoning_content` 首版不展示。
4. 快答复用任务的 requestId 幂等、`outcome` 写许可与 `usage` 记账（一次直答调用记一次模型请求，token 缺失记 null）；同步返回即完成态，HTTP 语义为 200；不提供取消（请求结束执行即结束）。
5. 运行逻辑分两个：服务端研究工作流运行时（Ultra）与直答单次调用（问答模式与 Pro）；两者都由服务端承接（见 [ADR-0008](0008-web-only-server-hosted-research.md)）。直答额度经 `/api/v1/quota` 观察，不做本地硬编码限额。
6. 机器档位值与产品命名：`fast`=问答·快速、`thinking`=问答·深度思考、`pro`=深度研究 Pro（直答 `zhida-agent`）、`ultra`=深度研究 Ultra。

## 契约归属

- `src/contracts/research.ts`：`tier` 必填枚举与快答 `answer` 结构（`ULTRA_DESKTOP_ONLY` 已按 [ADR-0008](0008-web-only-server-hosted-research.md) 撤销）。
- [后端 API](../../backend-api.md) 与[开发方案](../../deep-research-development-plan.md)同步；快答存储复用 `research_tasks`（`tier` 列 + `answer_json`），不建并行任务体系。

## 结果与取舍

问答模式用最小成本覆盖轻量需求（秒级/几十秒），深度研究形成 Pro（直答检索增强，轻、快）与 Ultra（自研全流程，重、深）两级，两者都由服务端承接。代价是产品存在两种产物形态（快答 vs 研究报告），前端需按档位区分；直答内容质量依赖知乎侧模型，本产品不对其做来源级核验（那正是 Ultra 的差异化价值）。
