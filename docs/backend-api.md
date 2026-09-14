# 深度研究后端 API

日期：2026-09-13 · 状态：当前待实现协议。运行契约按 [ADR-0006](architecture/decisions/0006-supervised-research-runtime.md)，只交付研究的范围按 ADR-0005。目标 schema v2，旧 round/固定计划 DTO 已覆盖；实现需同步 schema，不做未发布旧数据兼容。原平台接口移入[历史参考](research/deferred/platform-backend-api.md)，不是本期实现清单。已有其他路由保持原行为。

本文拥有 HTTP 路径、响应和错误语义；研究算法与数据 owner 见[开发方案](deep-research-development-plan.md)。实现后的 Zod schema 是机器契约，示例与文档同时维护，前端不重新定义平行类型。

## 1. 通用约定

- 本地 JSON API。成功 `{ok:true,data:...}`；失败 `{ok:false,error:{code,message}}`，按需增加结构化 details。程序依据 code，不解析 message。
- ID 为字符串；知乎 Int64 ID 无损保留。时间为 ISO 8601 UTC。未知值用 null，数组无内容用 []，两者不混用。
- 创建 requestId 是必填 UUID；question 去首尾空白后 1–2,000 字符；allowWebSupplement 默认 false；拒绝未知请求字段；JSON body ≤ 16 KiB。
- 输入哈希包含规范化 question 与补齐默认后的 allowWebSupplement；不含 requestId。相同 requestId 输入一致返回原任务，不重新启动，不重新取资料。
- 公共 DTO 不含框架 run/thread、完整上游响应、凭证、数据库路径或模型内部推理。
- Ultra 浏览器断开不取消任务，继续用轮询观察；Pro 使用一次性 SSE 请求，浏览器断开会中止这次直答，不提供重连、重放或自动重试。

## 2. 端点

网页端只交付 Pro，完整应用边界见 [ADR-0012](architecture/decisions/0012-pro-streaming.md) 与 [ADR-0014](architecture/decisions/0014-pro-orchestrated-report.md)。`Accept: text/event-stream` 的响应为单次 SSE：`started` 携带 question/createdAt，`plan` 携带拆题计划，`coverage` 携带单轮取证判断，`material` 携带参考资料，`answer_delta` 携带 text，`completed` 携带最终 detail，`failed` 携带 error。事件结构由 `ResearchProEvent` 定义。仅完成事件代表成功，连接关闭本身不代表完成。

网页端 Pro 不落库、不恢复历史、不承诺 requestId 幂等；重新提交可能再次消耗额度。以下列表、详情、去重和异步运行描述适用于本机持久任务；网页端列表固定为空。Pro 在单请求内跑完多轮编排（最多 3 轮、总预算 240 秒），执行窗口为 290 秒，专用函数上限 300 秒。

| 方法与路径 | 应用命令 | 行为 |
| --- | --- | --- |
| POST /api/research-tasks | createResearchTask | `{requestId,question,allowWebSupplement?,tier}`；Pro 协商 `Accept: text/event-stream` 时返回 `started/plan/coverage/material/answer_delta/completed/failed`，普通客户端返回完整 TaskDetail；Ultra 异步受理返回 202 |
| GET /api/research-tasks | listResearchTasks | limit 默认 20、1–100；offset 默认 0、非负整数；按 createdAt、id 倒序；返回 `{items:TaskSummary[],hasMore}` |
| GET /api/research-tasks/{id} | getResearchTask | 返回 TaskDetail；读取不触发执行 |
| POST /api/research-tasks/{id}/cancel | cancelResearchTask | 空 JSON 对象；活动执行取消返回 202，已终态幂等返回 200；均返回 TaskDetail |
| GET /api/research-tasks/{id}/sources | listResearchSources | 本任务已保存来源，受任务 maxSources 限制（默认 800 份）；返回 `{items:Source[]}` |
| GET /api/research-tasks/{id}/report | getResearchReport | 返回已保存 Report；未生成时 REPORT_NOT_READY；任务失败也不回填草稿 |
| GET /api/research-tasks/{id}/report.md | exportResearchReport | 同一 Report 确定性渲染；成功为 text/markdown、UTF-8，失败仍返回 JSON 错误 |

无活动任务队列，新请求在上一项执行尚未收尾时返回 TASK_BUSY。必须先处理重复 requestId，再做繁忙/配置检查，避免网络重试错误创建新任务。取消不需要 requestId：操作本身就是幂等，不能为了统一接口再加回执表。

### 2.1 研究档位（tier，必填）

按 [ADR-0007](architecture/decisions/0007-research-tiers-zhida.md)，创建请求必须带 `tier` 字段：

| tier | 产品形态 | 引擎 | 产出 | 执行方式 |
| --- | --- | --- | --- | --- |
| `fast` | 首页问答·快速 | 直答 `zhida-fast-1p5` | 快答 | 同步执行，200 返回完成态 |
| `thinking` | 首页问答·深度思考 | 直答 `zhida-thinking-1p5` | 快答 | 同步执行 |
| `pro` | 深度研究 Pro | 直答 `zhida-fast-1p5`（拆题/取证判断）+ `zhida-agent`（成稿）+ 知乎检索 | 结构化报告（四节 + `[n]` 引用 + 参考资料 + 子问题取证状态） | 单请求内多轮编排，SSE 流式执行 |
| `ultra` | 深度研究 Ultra | 主管 + 最多三个并行调查单元 + 核验回查 | 研究报告（findings/来源/引用） | 异步；需已配置研究模型与知乎凭证，未配置返回 503 |

首页问答模式（fast/thinking）的产出是**独立快答对象**：TaskDetail 中 `answer={content,model,generatedAt}`，无 plan/findings/sources/报告，不进入证据体系，并注明"知乎直答生成内容，未附原始来源"（直答接口不返回原始条目）。快答复用 requestId 幂等与 outcome 语义；usage 记 1 次模型请求，token 取自上游返回（缺失为 null）。

深度研究 Pro（[ADR-0014](architecture/decisions/0014-pro-orchestrated-report.md)）在单请求内按「拆题 → 逐子问题检索取证 → 覆盖判断 → 成稿」编排：`plan` 与 `analysis` 对 Pro 档开始填充，`answer.material` 带本次参考资料（编号由应用分配），成稿为固定六节（摘要 / 背景与范围 / 主体分析 / 结论与建议 / 分歧与争议 / 缺口与限制）的 Markdown 报告，`findings` 仍为空、`sourceCount` 仍为 0。Pro 报告**不是证据级核验**，资料仍是检索摘要，不建来源快照。

`ultra` 由服务端承接（见 [ADR-0008](architecture/decisions/0008-web-only-server-hosted-research.md)），创建时要求已配置研究模型（`MODEL_NOT_CONFIGURED`）与知乎凭证（`ZHIHU_NOT_CONFIGURED`），不按客户端声明判定。

## 3. 任务 DTO 与状态

TaskSummary 必填字段：`id, question, status, stage, createdAt, endedAt, sourceCount, reportId, error`。TaskDetail 另含 `tier, allowWebSupplement, plan, findings, analysis, queries, usage, limits, modelInfo, answer`；快答档（pro/thinking/fast）的 answer 为 `{content,model,generatedAt}`，ultra 为 null。创建后未产生的 plan/analysis 为 null，findings/queries 为 []，reportId 为 null。modelInfo 只含非秘密 provider/modelId，不返回密钥。

| status | 含义 |
| --- | --- |
| starting | 已保存任务，正在建立/启动本次 Workflow |
| running | 正在执行研究，由公开框架状态读取当前 stage |
| cancelling | 产品已禁止继续调用和写入，正在结束已有执行 |
| completed | 有效报告与产品成功结果已原子提交 |
| failed | 研究未完成，error 含稳定失败代码，已取得材料保留 |
| cancelled | 用户取消且本次执行已结束；材料保留 |
| interrupted | 进程重启发现旧任务没有产品终态，已结束该任务且不重放请求 |

stage 为 planning / researching / writing / reviewing / repairing / saving 或 null。终态 stage=null；cancelling 可保留最后观察到的 stage。stage 从 Mastra 公开快照映射，不能维护一份独立可写阶段。sourceCount 从已保存来源统计，不根据进度消息猜测。

completed、failed、cancelled、interrupted 都是终态。取消终态任务返回原状态；重复创建同 key 也只返回原状态。重新研究使用新 requestId 和新 taskId。report 已提交时即 completed，框架收尾异常不能把已有成果改成 interrupted。

## 4. 内嵌结构

以下是目标 v2 契约，由共享 Zod 维护，不能同时保留旧字段驱动另一套行为。

| 字段 | 形状与语义 |
| --- | --- |
| plan | `{version,objective,assumptions:string[],questions:[{id,text,priority,closedReason}]}`；priority=high/normal；closedReason=null/irrelevant/saturated；初步 3–5 个问题，之后可演化；历史 ID 保留 |
| findings | `Finding[]`，每项为 `{id,unitId,questionId,statement,kind,conditions:string[],limitations:string[],evidence:[{sourceId,quote,relation}]}`；kind=fact/experience/opinion/inference；relation=support/oppose/qualify/context |
| analysis | `{answers:[{questionId,coverage,text,findingIds:string[],gaps:string[]}]}`；按当前计划合并；覆盖 supported/partial/contested/unanswered；覆盖判断依据有效 findings |
| queries | 准入记录：`{id,unitId,questionId,channel,text,purpose,status,sourceIds,discardedCount,error,requestedAt,completedAt}`；没有 round；status=pending/succeeded/failed；channel=zhihu/web |
| purpose | background/supporting/counterevidence/verification/qualification；分别表示背景、支持依据、反例、查证、条件 |
| usage | `{searchRequests,modelRequests,inputTokens,outputTokens,elapsedMs}`；请求计入实际准入尝试，modelRequests 包含 Agent 工具循环的每次推理；token 未知为 null |
| limits | `{maxConcurrentUnits,maxConcurrentSearches,maxSearchRequests,maxModelRequests,maxSources,timeoutMs,synthesisModelReserve,synthesisTimeReserveMs,unitMaxSteps,unitMaxSearchRequests,unitTimeoutMs,maxRepairPasses}`；冻结配置，默认值见开发方案第 7 节 |

请求/问题/单元/finding/source 的 ID 由应用生成；工具的任务与单元身份从可信上下文取得，模型不得自填任意 taskId。findings 的 questionId 和 sourceId 必须属于本任务。analysis.findingIds 引用已保存发现；单元只提交建议，主管通过唯一命令更新 plan 与 analysis。

queries.pending 表示已准入但上游结果未知，可能未送达；未知状态不指示重放。合法空结果为 succeeded + []。失败或未知结果的 discardedCount/completedAt 可为 null。未派发建议不增加计数。预算预留是内部准入状态，不伪装成已发生调用写入 usage；只归还确定未使用的预留。

Source 必填：`id,taskId,channel,identity,textHash,title,url,canonicalUrl,text,contentExtent,author,sourceTime,timeKind,retrievedAt,metadata`。contentExtent 固定 summary；author 为 `{name,avatarUrl,badgeIconUrl,badges}` 或 null，badges 保存实际认证文案；timeKind=published_or_updated/published/unknown。metadata 保留 contentType/contentId、voteCount、commentCount、authorityLevel、rankingScore、selectedComments；缺失标量为 null，评论缺失为 []。Int64 ID 为字符串，authorityLevel 保留上游字符串。url 保留实际溯源参数，canonicalUrl 只作去重，作者昵称不是身份 ID。

Report 必填：`id,taskId,title,sections,sourceIds,completeness,stopReason,limitations,createdAt`。sections.conclusion/evidence/disagreements 为 `{text,findingIds:string[],sourceIds:string[]}[]`，sections.gaps 为 string[]。Writer 给出 findingIds，应用从其证据派生段落 sourceIds；顶层 sourceIds 为段落引用去重集合。前两部分非空，分歧可空。引用必须支持文字，不能仅检查 ID 存在。

模型输出的数组类字段只设 500 条的反退化天花板（防模型重复循环），不限制正常研究的发现数与报告段落数；超出天花板时按截断保留处理，不使任务失败。completeness=sufficient/partial；stopReason=sufficient/source_saturated/search_budget/model_budget/time_budget/source_budget/upstream_unavailable。原因记录最终结束调查的直接因素，没有 round_limit 或固定连续次数协议。部分报告可 completed + partial；无有效依据或核验失败不能 completed。

所有报告至少说明采用搜索摘要，以及适用的时间/代表性限制。报告不可变；回查与改写发生在最终保存之前，不通过创建多个成果版本模拟修复。

## 5. 错误

| HTTP | code | 处理 |
| --- | --- | --- |
| 400 | INVALID_INPUT | 修改输入，不能通过重试绕过校验 |
| 404 | NOT_FOUND | task 不存在 |
| 409 | REQUEST_CONFLICT | 同 requestId 对应不同规范化输入 |
| 409 | TASK_BUSY | 另一研究尚未结束或正在收尾 |
| 409 | REPORT_NOT_READY | 当前没有已保存报告；查看任务状态 |
| 503 | MODEL_NOT_CONFIGURED / ZHIHU_NOT_CONFIGURED | 不能新执行，但历史可读 |
| 500 | STORAGE_ERROR / INTERNAL_ERROR | 真实本地错误，不返回示例数据 |

异步执行失败由 TaskDetail.error 表达，GET 本身仍为 200。执行错误包括 AUTH_INVALID、RATE_LIMITED、QUOTA_EXHAUSTED、UPSTREAM_ERROR、PROTOCOL_ERROR、MODEL_OUTPUT_INVALID、INVALID_CITATION、EVIDENCE_REQUIRED、BUDGET_EXCEEDED、TIMEOUT、STORAGE_ERROR、INTERNAL_ERROR。只输出脱敏信息。任务 interrupted/cancelled 的解释来自 status，error 可为 null；不要把取消包装成上游网络故障。

接口受理后若启动失败，写入 failed 与对应错误；不能一直 starting。HTTP 200 表示读取成功，不能把它当成研究已经完成。

## 6. 接入边界

HTTP route 只做解析、调用一个应用命令、映射响应；不读写 SQL，不拼接研究步骤。共享 Zod 被后端、fixture 与未来前端复用。

页面只需提交问题/全网补证选项、显示正在演化的只读计划与阶段、取消、浏览来源及报告。当前不要求实现页面或接线。模型和知乎配置留在后端；报告读取、下载不依赖这些凭证仍然存在。
