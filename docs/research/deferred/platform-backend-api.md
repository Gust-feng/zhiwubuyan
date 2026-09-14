# 看山后端接口与前端对接

> 历史设计，已被 [ADR-0005](../../architecture/decisions/0005-deep-research-mvp-scope.md) 收敛。本文中的“首版”“必须”和开发清单均不是当前任务；仅供将来评估被后置能力。当前请从[实施任务](../implementation-tasks.md)进入。

版本：0.3 · 2026-09-13 · 状态：Mastra 选型已确定，契约为实施设计，尚未提供对应实现。

底层执行按 [ADR-0003](../../architecture/decisions/0003-mastra-foundation.md) 使用 Mastra。公共 API 使用产品身份和 Zod DTO，不暴露框架内部 run、thread 或存储对象。

本文件定义 [后端设计](platform-backend-design.md) 的最小对接面。M0 把这些约定落实为 `src/contracts` 的共享 Zod schema；届时本文保留语义与示例，字段以该 schema 为唯一机器可读定义。不要在前端、mock 和后端各抄一份类型。

[深度研究工作流](../../deep-research-workflow.md) 使用独立 ResearchTask API，由 Mastra Workflow 执行，不对应多个聊天 Run。聊天任务、研究任务共用来源、成果和事件传输设施，生命周期各有明确入口。

研究字段细节、算法和开发顺序见[完整开发方案](full-development-plan.md)、[契约示例](../contract-examples.md)及 [ADR-0004](../../architecture/decisions/0004-zhihu-research-evidence.md)。HTTP 路径、公共错误与事件仍由本文件拥有。

## 1. 通用协议

- Base URL 由桌面或开发启动器提供，仅 loopback，同源访问。
- JSON 使用 camelCase；产品 ID、消息 ID 与游标均视作不透明字符串，外部 Int64 不转为 JS Number。
- 时间统一为 UTC ISO 8601；版本为正整数，不用时间戳猜并发先后。
- mutation 提交 `requestId`。同一身份与命令内，相同 ID、相同参数返回原结果；不同参数返回 `REQUEST_CONFLICT`。UI 重试网络请求复用原 ID，用户发起新操作使用新 ID。
- `ok` 是结果判别字段；展示文本不负责程序分支。成功与错误 HTTP 状态同时准确表达结果。
- 所有凭证接口只允许写入或返回是否配置；任何普通读取响应不得返回完整凭证。
- 未实现能力由 capability 标注，不能用空数组和成功响应占位。

统一错误示例：

```json
{
  "ok": false,
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "简报已有更新，请查看最新版本后再提交。",
    "retryable": false,
    "details": { "resourceId": "brief-1", "currentRevision": 4 }
  },
  "requestId": "request-1"
}
```

| HTTP | 错误码 | 语义 |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | 输入结构或枚举不合法 |
| 401 | `AUTH_REQUIRED` / `AUTH_INVALID` | 本地会话或外部账号凭证缺失/失效；details 指明能力域 |
| 403 | `SCOPE_DENIED` | 请求对象不属于当前授权资料范围 |
| 404 | `NOT_FOUND` | 对象不存在，details 用 resourceKind 指明对象 |
| 409 | `REVISION_CONFLICT` / `REQUEST_CONFLICT` / `RUN_NOT_ACTIVE` / `RUN_BUSY` | 版本、幂等键或任务时机冲突 |
| 409 | `TASK_NOT_ACTIVE` / `TASK_BUSY` | 研究任务不处于可操作状态，或活动执行尚未完成收尾 |
| 409 | `EXECUTION_STALE` / `BUDGET_EXCEEDED` | 研究执行许可过期，或同步调用准入超过任务预算 |
| 409 | `APPROVAL_EXPIRED` / `RESULT_ALREADY_SAVED` | 确认已失效，或重试对象已有保存结果 |
| 422 | `EVIDENCE_REQUIRED` / `INVALID_CITATION` / `MODEL_CAPABILITY_UNSUPPORTED` | 研究或模型能力条件不成立 |
| 422 | `MODEL_OUTPUT_INVALID` / `MODEL_CONTEXT_LIMIT` | 模型结果修正后仍无效，或有限上下文仍超出模型能力 |
| 429 | `RATE_LIMITED` / `QUOTA_EXHAUSTED` | 外部服务限制 |
| 503 | `MODEL_NOT_CONFIGURED` / `CAPABILITY_UNAVAILABLE` | 功能尚未配置或不可用 |
| 502 | `UPSTREAM_ERROR` / `PROTOCOL_ERROR` | 上游故障或响应不符合契约 |
| 500 | `STORAGE_ERROR` / `INTERNAL_ERROR` | 本地存储或未知错误，日志保留脱敏 cause |

`retryable` 指相同只读/幂等请求是否适合稍后重试，不授权重放整个聊天/研究任务或外部副作用。任务内预算终止使用 `BUDGET_EXCEEDED`，保留已获取来源和已保存成果。

## 2. 能力、配置与组织

| 方法与路径 | 对应应用入口 | 请求 / 结果概要 |
| --- | --- | --- |
| `GET /api/status` | 进程健康查询 | 无凭证仅返回 ready/version，不泄漏路径、账号或配置 |
| `GET /api/capabilities` | `getCapabilities` | 各能力的 state/reasonCode；模型和知乎分别表达 |
| `GET /api/model-profiles` | `listModelProfiles` | 脱敏模型配置、有效思考档位、输入能力与验证状态 |
| `PUT /api/model-profiles/{id}` | `saveModelProfile` | requestId、expectedRevision、providerKind/modelId/baseUrl 等非密钥字段 |
| `PUT /api/model-profiles/{id}/credential` | `setModelCredential` | 受保护的写入接口；日志屏蔽 body，只返回 configured |
| `POST /api/model-profiles/{id}/verify` | `verifyModelProfile` | 显式进行小额真实模型与工具能力验证，返回结构化结果 |
| `GET /api/spaces` | `listSpaces` | 分组列表，包含固定默认分组 |
| `POST /api/spaces` | `createSpace` | requestId、title → space |
| `PATCH /api/spaces/{id}` | `renameSpace` | requestId、expectedRevision、title |
| `GET /api/skills` | `listSkills` | 内置技能 ID、说明、启用状态、版本、加载诊断 |
| `PUT /api/skills/{id}/enabled` | `setSkillEnabled` | requestId、enabled；不接受任意文件路径 |
| `GET /api/usage` | `getUsage` | 模型用量与费用估算、知乎配额分别返回，未知值为 null |

Space 归档在 M3 通过明确命令增加，不允许伪装成 rename 的附加字段。模型 profile 是产品配置身份；由 Mastra 官方支持的模型配置解析为执行参数，同厂商不同 profile 的凭证必须隔离，不能在并发请求间通过修改全局环境变量切换账号。

能力示例（目标契约 fixture，不表示当前已实现）：

```json
{
  "ok": true,
  "capabilities": [
    { "id": "agent.chat", "state": "ready", "reasonCode": null },
    { "id": "research.search", "state": "ready", "reasonCode": null },
    { "id": "research.deep", "state": "not_implemented", "reasonCode": null },
    { "id": "agent.guidance", "state": "not_implemented", "reasonCode": null },
    { "id": "account.collections", "state": "needs_configuration", "reasonCode": "OAUTH_NOT_CONFIGURED" },
    { "id": "agent.mcp", "state": "not_implemented", "reasonCode": null }
  ]
}
```

## 3. 会话与任务

| 方法与路径 | 对应应用入口 | 语义 |
| --- | --- | --- |
| `POST /api/conversations` | `createConversation` | 创建或关联 Research，再创建 Conversation 与首个 queued Run |
| `GET /api/conversations?spaceId=&cursor=&limit=` | `listConversations` | 游标列表；limit 默认 30，最大 100 |
| `GET /api/conversations/{id}` | `getConversation` | 会话元数据、研究 ID、队列状态与当前/最近 Run 引用 |
| `GET /api/conversations/{id}/transcript?cursor=&limit=` | `getTranscript` | 从 Mastra Memory 投影的稳定历史；不返回完整原始 provider payload |
| `PATCH /api/conversations/{id}` | `updateConversationMetadata` | requestId、expectedRevision、title/pinned |
| `POST /api/conversations/{id}/archive` | `archiveConversation` | 停止聊天 Run 并归档；不取消独立研究任务，收尾完成前不显示归档完成 |
| `POST /api/conversations/{id}/restore` | `restoreConversation` | 恢复列表可见性，不自动恢复队列 |
| `POST /api/conversations/{id}/messages` | `submitRun` | 创建新 Run；繁忙时只排队 |
| `POST /api/conversations/{id}/queue/resume` | `resumeQueue` | 显式恢复派发，先检查前一任务已结束 |
| `POST /api/conversations/{id}/context/reset` | `resetConversationContext` | 仅空闲时创建新 Memory thread；旧历史只读保留，当前资料重新选择 |
| `GET /api/runs/{id}` | `getRun` | 权威运行快照和 stream cursor |
| `GET /api/runs/{id}/events` | `observeRun` | SSE 过程事件 |
| `PATCH /api/runs/{id}` | `editQueuedRun` | 仅 queued 可改 goal；需要 expectedRevision |
| `POST /api/runs/{id}/cancel` | `cancelRun` | queued 直接取消；活动 Run 进入 stopping 并暂停后续派发 |
| `POST /api/runs/{id}/guidance` | `guideRun` | 需 agent.guidance capability；验证框架交付边界后启用，否则返回 CAPABILITY_UNAVAILABLE |
| `POST /api/runs/{id}/retry` | `retryRun` | 创建新 Run 并保留 retryOfRunId；有已保存成果时返回冲突和成果引用 |

创建会话示例：

```json
{
  "requestId": "request-1",
  "spaceId": "space-default",
  "goal": "比较应届生进入大公司与小公司的条件和风险",
  "mode": "discover",
  "modelProfileId": "profile-1",
  "thinkingLevel": "medium",
  "skillId": "evidence-research"
}
```

返回 HTTP 201：

```json
{
  "ok": true,
  "conversation": { "id": "conversation-1", "researchId": "research-1", "revision": 1 },
  "run": { "id": "run-1", "status": "queued", "revision": 1 }
}
```

创建会话可用 researchId 关联已有研究，与新建研究的 spaceId 二选一；之后关联不可变。这样独立研究生成报告后可以直接在同一 Research 下开始讨论，无须复制资料。

后续提交 HTTP 202，输入沿用 goal/mode/modelProfileId/thinkingLevel/skillId，但不再提交 spaceId 或 researchId。省略模型字段时，在接受请求时解析会话默认值并冻结。

三种模式：

| mode | 输出目标 | 可用能力 |
| --- | --- | --- |
| `discover` | 候选来源及覆盖缺口 | 按预算搜索、读取本次采集的候选，不能自动保存带结论的简报 |
| `discuss` | 回答或补充问题 | 解释当前选定资料及用户指定的既有简报，允许提出修改建议 |
| `brief` | 结构化并已保存的简报 | 引用冻结证据，提交本次预留成果；没有证据时拒绝接受 |

brief 提交还需要 `expectedSelectionRevision`。创建新简报时 `target` 为 `{ "kind": "new_brief" }`；用户明确要求修改既有简报时为 `{ "kind": "brief_revision", "briefId": "brief-1", "expectedRevision": 3 }`。目标由用户入口指定，模型不能自行把新建授权升级为覆盖任意文档。

补充消息默认按下一条聊天任务处理。guidance 的已接收与已应用状态必须区分，不能将普通排队伪装为当前执行已采纳；未实现该能力不影响发送、排队和停止。

同一会话只允许一个活动 Run；queued 有自己的身份，不是前端临时数组。修改 queued goal 后增加该 Run revision，保留 requestId 幂等信息，不能复用原创建 requestId 来表达编辑。

## 4. Run snapshot 与流式事件

Run snapshot 的稳定字段：

| 字段 | 含义 |
| --- | --- |
| id / conversationId / researchId | 任务及归属身份 |
| revision | 快照版本 |
| status | queued/running/waiting_approval/stopping/completed/failed/cancelled/interrupted |
| stage | 可空；preparing/searching/analyzing/writing/compacting；仅显式业务阶段，不从模型文案猜 |
| submittedAt / startedAt / finishedAt | 可空的时间事实 |
| inputSummary / modelProfileId / modelId | 用户可见输入与冻结的模型身份 |
| evidenceSelectionRevision / snapshotIds | 本次冻结的证据范围 |
| output | 可空，判别联合：answer/sources/brief/research_task/needs_input |
| savedArtifacts | 即使任务失败或中断也列出已提交的成果 |
| pendingApproval | 当前等待的明确操作请求，可空 |
| usage | provider 实际返回的用量，缺失为 null；费用标明 estimated |
| error | 可空的结构化错误 |
| streamCursor | 当前流式观察位置 |

`completed` 表示本次声明的工作完成。回答要求用户补充条件可以 completed 且 output.kind=needs_input；缺少必须的简报成果不能 completed。拒绝一个写入请求后，Agent 可以解释并结束，但不能声称写入完成。聊天创建研究任务时 output.kind=research_task，返回 taskId；聊天 Run 完成仅表示任务已创建，不表示研究已完成。

SSE 使用单一具名事件 `run.event`，内容以 `type` 判别；前端不按展示标题分支。每条事件包含：

```json
{
  "runId": "run-1",
  "sequence": 18,
  "type": "text.delta",
  "occurredAt": "2026-09-13T00:10:00.000Z",
  "data": { "messageId": "message-1", "delta": "根据这些来源" }
}
```

类型集合：`run.updated`、`text.delta`、`message.completed`、`tool.started`、`tool.progress`、`tool.completed`、`tool.failed`、`approval.requested`、`approval.resolved`、`sources.updated`、`brief.saved`、`context.compacted`、`usage.updated`。数据 shape 各自建共享 schema，不使用任意 details 对象承载所有业务状态。

SSE id/cursor 包含后端启动 epoch 与递增 sequence。运行内提供有界内存 replay buffer，不把每个 token 写进另一套数据库事件日志。聊天终态、消息和成果分别由 Run、Mastra Memory 与简报存储恢复。框架原始事件必须转换为此处产品协议；context.compacted 仅在实际启用并完成对应上下文处理时发出。

重连携带 `Last-Event-ID` 或 cursor。游标跨 epoch、已淘汰或无法连续重放时发送 `stream.reset`，携带当前 cursor，要求客户端重新读取 Run 与 transcript。前端先接通流并缓存新事件，再获取带边界游标的快照，只应用边界之后的事件；不能在取快照和重新订阅之间丢事件。只支持追加重放的 text.delta 以 messageId 聚合，快照覆盖同一消息的临时文本。

心跳只维护连接；连接关闭不取消任务。不把原始 provider 思考内容作为必需产品输出；首版展示明确的业务进度，正文与工具结果足以恢复会话。

## 5. 研究与来源

| 方法与路径 | 对应应用入口 | 请求 / 结果 |
| --- | --- | --- |
| `GET /api/research/{id}` | `getResearch` | 问题、分组、来源候选、选择版本、相关成果 |
| `POST /api/research/{id}/search` | `searchSources` | requestId、query、channels、count；确定性搜索，与 Agent 工具复用 |
| `GET /api/research/{id}/sources/{snapshotId}` | `readSource` | 研究成员范围内的稳定快照 |
| `PUT /api/research/{id}/evidence` | `selectEvidence` | requestId、expectedRevision、snapshotIds；空数组明确清空 |
| `POST /api/research/{id}/imports` | `importResearchText` | 首版 UTF-8 文本/Markdown 文件，校验类型与大小，返回受管理副本快照 |
| `GET /api/hot` | `listHotContent` | 共享缓存结果及 fetchedAt/stale，不虚构热度 |

来源详情 DTO 包含 `snapshotId`、`sourceKey`、`originKind`、`title`、`url`、`canonicalUrl`、`author`（可空）、`text`、`textHash`、`contentExtent`、`locatorKind`、`sourceTime`、`sourceTimeKind`、`fetchedAt`、`identityScope` 和 retrieval 元信息。列表卡片可由详情投影 `authorName`，不能再建立可写的另一份作者事实。`originKind` 为 zhihu/web/knowledge/local/brief；`contentExtent` 为 summary/snippet/full_text；`locatorKind` 为 document/retrieval_response/derived_report。未取得原文 URL 时 url=null，不造链接。

EvidenceSpan 使用 `{snapshotId,field,start,end,quote}`；field 是 `{kind:'text'}` 或 `{kind:'selected_comment',index}`，按 UTF-16 半开区间精确校验。知识库未定位字符串按 retrieval_response 展示，不等于已读到具体原文。完整字段见开发方案第 6 节。

search 还返回各 channel 的 `status: success/empty/failed`、error 和 fetchedAt。任一渠道成功时可返回部分成果；全部失败返回对应错误。`stale` 数据不能伪装成新抓取。

手选证据变化只影响之后接受的 brief Run，独立研究使用自己的批准范围与 manifest。要求立即撤回资料时停止相关聊天/研究执行，并按需重置聊天上下文；删除历史内容与改变本次引用范围是不同操作。


## 6. 独立研究任务

| 方法与路径 | 应用入口 | 请求 / 语义 |
| --- | --- | --- |
| `POST /api/research-tasks` | createResearchTask | requestId、target、goal、scope、budget、modelProfileId、autoStart；异步生成计划 |
| `GET /api/research-tasks?researchId=&cursor=&limit=` | listResearchTasks | 独立任务列表，支持没有会话的研究 |
| `GET /api/research-tasks/{id}` | getResearchTask | 产品只读快照，由框架执行与产品事实组合 |
| `GET /api/research-tasks/{id}/events` | observeResearchTask | SSE 研究过程 |
| `PUT /api/research-tasks/{id}/plan` | updateResearchPlan | requestId、expectedRevision、结构化计划；无活动执行时更新 |
| `POST /api/research-tasks/{id}/start` | startResearchTask | requestId、expectedPlanRevision、expectedControlRevision；从 PLAN_READY 启动 |
| `POST /api/research-tasks/{id}/pause` | pauseResearchTask | requestId、expectedControlRevision；先失效旧执行许可，再完成暂停 |
| `POST /api/research-tasks/{id}/resume` | resumeResearchTask | requestId、expectedPlanRevision、expectedControlRevision；paused/interrupted 时显式继续 |
| `POST /api/research-tasks/{id}/cancel` | cancelResearchTask | requestId；停止当前及后续工作，终态请求返回当前结果 |

create 的 target 为 `{kind:'existing_research',researchId}` 或 `{kind:'new_research',spaceId}`；goal 作为独立字段只出现一次。框架引用由后端生成。创建即授权预算内规划，autoStart 默认 false。规划后通过 Workflow suspend 等待用户启动；autoStart=true 仅代表已经明确要求按创建范围直接执行。完整输入样例见[契约示例](../contract-examples.md)。

返回 HTTP 202 示意：

```json
{
  "ok": true,
  "task": {
    "id": "task-1",
    "researchId": "research-1",
    "status": "queued",
    "stage": "planning",
    "planRevision": null,
    "controlRevision": 1
  }
}
```

快照最小字段：

| 字段 | 含义 |
| --- | --- |
| id / researchId | 产品任务与研究身份，无必填 conversationId |
| status | queued/running/waiting_input/pausing/paused/stopping/completed/failed/cancelled/interrupted |
| stage | 可空；planning/collecting/evaluating/writing/reviewing/saving |
| plan / planRevision | 当前结构化计划；规划完成前可空 |
| controlRevision | 应用控制版本，保证旧执行不能提交 |
| waitReason | 可空；结构化 reasonCode 和用户可见说明，如 PLAN_READY / MISSING_CONTEXT |
| steps / coverage | 真实执行进度与各子问题覆盖；模型判断与客观计数区分 |
| budget / usage | 批准上限、累计调用与剩余预算；实际费用缺失为 null |
| stopReason / completeness / unresolvedQuestions | 结束依据与未解决问题；完成流程不代表证据完整 |
| savedArtifacts | 已保存的简报版本，包括中断前成果 |
| error / streamCursor | 结构化错误与观察位置 |
| allowedActions | start/editPlan/pause/resume/cancel 各对应 enabled 与 reasonCode；由同一服务端政策投影 |

快照不直接暴露 Mastra checkpoint。status/stage 从官方快照与控制意图投影，禁止客户端提交它们。planRevision 与 controlRevision 分别检查，不用展示阶段推断修改权限。

普通计划编辑要求 waiting_input 或 paused 且无活动执行。收紧范围时先 pause，使旧控制版本失效，收尾后再编辑。对缺失背景的 waiting_input，更新计划补足条件后由 start 命令通过受支持的入口继续；PLAN_READY 与 MISSING_CONTEXT 分别检查所需条件。计划改变后建立同 task 的新框架 attempt，载入新计划，不手改旧快照。completed/cancelled/failed 不能通过 resume 重开；创建新任务时可显式引用已有成果或允许快照。

研究 SSE 使用具名事件 `research.event`，每条包含 taskId、sequence、type、occurredAt、data。type 包括 research.updated、plan.updated、step.started、step.completed、step.failed、sources.updated、usage.updated、brief.saved。stepId 与 attemptId 为稳定结构字段，不能用步骤标题关联结果。

研究复用第 4 节的 epoch/cursor、有界重放、快照边界和 stream.reset 机制；重置后读取研究 snapshot。研究流不依赖活动聊天 Run 的事件，断线不会取消任务。

各研究 event.data 的字段在共享 Zod 中定义，最小形状见开发方案第 14 节。首版研究只流式发送业务进度，报告通过已保存 BriefRevision 读取，不把未校验草稿作为正式正文流。

暂停请求返回 HTTP 202 不等于已暂停。等待可恢复 checkpoint 与活动执行结束后才显示 paused；不能安全暂停则如实投影 interrupted。resume 保留 taskId 与累计预算，可映射到新的框架执行尝试；UI 不自己派发下一步骤。

## 7. 简报与确认

| 方法与路径 | 对应应用入口 | 语义 |
| --- | --- | --- |
| `GET /api/briefs?researchId=&cursor=&limit=` | `listBriefs` | 查询本地成果 |
| `GET /api/briefs/{id}` | `getBrief` | 当前版本与来源引用 |
| `PATCH /api/briefs/{id}` | `editBrief` | requestId、expectedRevision、结构正文和用户笔记；事务写新版本 |
| `GET /api/briefs/{id}/revisions` | `listBriefRevisions` | 不可变版本列表 |
| `POST /api/briefs/{id}/restore-revision` | `restoreBriefRevision` | requestId、expectedRevision、fromRevision；新建版本，不改旧记录 |
| `POST /api/briefs/{id}/trash` | `trashBrief` | 进入可恢复回收状态，已有历史引用仍可辨识 |
| `POST /api/briefs/{id}/restore` | `restoreBrief` | 取消回收状态，不改变正文 |
| `POST /api/approvals/{id}/decision` | `decideApproval` | requestId、decision=approve/deny；消费前重验执行身份、控制版本与目标版本 |

简报正文示意：

```json
{
  "id": "brief-1",
  "researchId": "research-1",
  "revision": 1,
  "revisionId": "brief-revision-1",
  "title": "应届生择业条件比较",
  "sections": {
    "conclusion": [ { "text": "不同建议依赖不同的培养与风险条件。", "sourceRefs": ["snapshot-1", "snapshot-2"] } ],
    "evidence": [ { "text": "一条来源强调培养体系，另一条强调职责跨度。", "sourceRefs": ["snapshot-1", "snapshot-2"] } ],
    "disagreements": [ { "text": "两者对早期职责跨度的收益判断不同。", "sourceRefs": ["snapshot-1", "snapshot-2"] } ],
    "gaps": [ "仅覆盖选定摘要，尚缺同一行业与岗位的可比样本。" ]
  },
  "userNotesMarkdown": "",
  "origin": { "kind": "conversation_run", "runId": "run-2" }
}
```

成果 origin 为判别联合：`{ kind: "conversation_run", runId }` 或 `{ kind: "research_task", taskId }`。研究报告仍用本节的四部分正文、引用与版本写入口；不创建伪造聊天 Run，也不增加第二个可写 Report 库。

每个版本另有不可变 revisionId，brief 的 id 和递增 revision 保持既有语义；后续研究用 priorBriefRevisionIds 引用精确版本。研究 origin 的版本追加 researchMeta：taskId、planRevision、manifestId、stopReason、completeness、unresolvedQuestions、limitations、coverageSummary、generatedAt。段落可关联 questionId/findingIds，sourceRefs 仍为 snapshotIds。模型只提交正文，统计、时间、完整度和停止依据由应用生成。完整样例见[契约示例](../contract-examples.md)。

示例均为虚构占位内容。模型生成的段落统一标为看山归纳；原文摘录直接从对应快照展示，统计与时间由后端生成，缺口由 gaps 展示。用户笔记独立保存，模型提交工具无权覆盖 `userNotesMarkdown`。

`submit_brief` 工具使用相同 sections schema，成果身份、目标版本、执行身份与操作 ID 由后端任务上下文注入，不由模型编造。所有 sourceRefs 必须存在并属于本次冻结证据。模型提交格式或引用无效时允许预算内修正，仍失败则任务失败；不偷偷删除坏引用后宣称成果有效。

普通用户编辑也验证引用存在及研究成员范围。更新已有简报时，模型要改写涉及旧来源的段落，必须先将对应来源纳入本次证据；不能用未授权的历史摘要补足依据。

Approval 返回请求 ID、action、targetId、expectedRevision、可审阅的变更、expiresAt 和当前决策。后端按 conversation_run 或 research_task 的结构化执行身份绑定授权，研究还绑定控制版本与 attempt；toolCallId 仅在工具操作需要时记录，用户不填写框架标识。重复批准不重复写入，批准已失效的请求返回明确冲突。

## 8. 前端迁移表

| 现有原型 | 对接目标 | 处理方式 |
| --- | --- | --- |
| `src/workbench/api-contracts` 及较大的内部依赖闭包 | `src/contracts` 的最小公共 schema | 按切片迁移，旧入口可暂时 re-export，禁止两份独立 schema |
| `/api/conversations` 的 goal 交互 | 保留路径与 goal 概念，响应改用明确的 research/run ID | 更新一个 API client 映射层，组件不拼服务端协议 |
| `/api/ordinary/runs/{id}/view`、`/stream` | `/api/runs/{id}`、`/events` | 在 M0 明确迁移并更新 mock，不长期维护两套运行路由 |
| 多种含糊的 planning/blocked/paused 状态 | Run 状态 + stage + queuePaused | 按结构字段渲染，不从提示文案还原状态 |
| 将深度研究视为长聊天或子 Run 集合 | 独立 ResearchTask snapshot / events | 任务可没有会话，聊天只保存任务引用 |
| 框架特定会话、工具与消息形状 | Zod 产品 DTO | 由后端映射 Mastra 类型，前端不导入框架 |
| React 队列自行派发下一条 | 服务端 queued Run | 前端只提交、编辑和取消意图，不重复启动任务 |
| 临时前端会话与无限增长 transcript | 分页历史 + 活动 Run snapshot/stream | 切换页面重新读取快照，避免串会话 |
| 普通知识笔记作为所有成果的形状 | 专用 Brief DTO 与用户笔记字段 | 第一批实现简报视图；泛知识库功能后续独立接入 |
| 请求失败自动回退 fixture | 显式 demo/real 模式 | real 模式保留失败、空结果与未配置状态 |
| 全模型固定 low/medium/high | profile 的真实 thinkingLevels | 未验证能力标 unknown，不当成不支持或默认支持 |

这是一次共同的契约收敛，不是承诺“前端零改动”。M0 交付字段 schema、关键状态 fixture 和 API client 迁移点后，前端即可独立推进布局与交互；后端不依赖这些组件。

## 9. 开发与验收约定

CLI 与前端均调用同一应用入口。聊天验收：创建会话 → 观察 Run → 读取来源 → 选择证据 → 提交 brief Run → 读取简报 → 重启后读取历史。研究验收：直接创建任务 → 读取计划 → 启动 → 观察取证 → 暂停/继续 → 读取报告；这条路径不需要先创建 Conversation。

至少准备这些共享 fixture：空来源、渠道部分失败、未配置模型、排队、引导能力未实现、等待确认、版本冲突、停止中、已取消、中断但成果已保存、流式游标失效，以及研究计划待启动、研究暂停、部分覆盖、旧计划尝试被拒绝。fixture 必须经过共享 schema 校验，并明确标为示例。

契约变更与实现必须在同一切片更新 schema、API client、mock 和相关文档。新增高风险字段或状态只增加保护真实不变量的最小验证，不为每个 DTO 镜像编写测试。
