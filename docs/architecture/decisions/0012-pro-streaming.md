# ADR-0012：Pro 直答流式输出

日期：2026-09-14 · 状态：accepted。

## 问题

Pro 已调用 `zhida-agent`，但 `stream: false` 会让浏览器等待完整正文。检索增强回答的耗时不能保证为秒级；普通 JSON 请求也没有传递执行中止信号。现有等待界面展示 Ultra 的计划和来源，无法表达 Pro 的实际过程。

## 决策

- Pro 仍是单次知乎直答，不引入研究引擎、来源库或持久任务。按 [内容 API](../../content-api.md) 使用 `stream: true`，通过 `eventsource-parser` 解析 SSE。
- 网页端 `POST /api/research-tasks` 通过 `Accept: text/event-stream` 协商产品事件：`started`、`answer_delta`、`completed`、`failed`。不暴露上游推理内容、原始事件或凭证。普通 JSON 客户端继续获得完整 `TaskDetail`。
- 仅在收到上游 `[DONE]`、无错误且正文非空时完成。断流、空内容和 `finish_reason: error` 均不能产生完成态；失败保留界面上的部分正文并标注未完成。
- 客户端停止或断开时中止这次 Pro 请求；不自动重连、不重试 POST、不提供事件重放。重试可能再次消耗额度，`requestId` 在无存储的网页端不承诺去重。
- Pro 的等待和正文视图不展示 Ultra 的计划、来源计数与核验能力。本机 Ultra 的轮询、取消和持久化语义保持原定义。

## 边界

登录、限流和输入校验在 SSE 响应头发出前完成；流内错误用产品事件表达。SSE 只改变结果传输，不能突破托管平台的函数执行时长上限。`api/research-tasks.ts` 在 `vercel.json` 配置 300 秒，应用在 290 秒先报告超时。部署需启用支持该时长的 Fluid Compute；平台限制参见 [Vercel 官方时长说明](https://vercel.com/docs/functions/configuring-functions/duration)。

本机运行面仅在 Pro 请求协商 SSE 时使用同一个无存储命令；普通 JSON 创建仍保留已有任务存储，Ultra 路由保持原定义。两种传输的存储差异仅供本机兼容，网页端始终不保存历史。

验证：真实 HTTP 与可控上游覆盖增量先到达、UTF-8 切分、流内错误、空答案、断流、超时、中止和准入拒绝。2026-09-14 一次真实 `zhida-agent` 请求约 16.7 秒首段、18.4 秒完成，返回两个正文片段；不是逐字返回或研究质量保证。

本决策修订 ADR-0007 与 ADR-0011 中 Pro 必须同步返回、不可取消的传输约定；不改变 Ultra 的冻结范围。
