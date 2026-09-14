# 深度研究契约示例

这些都是离线 fixture，**没有调用模型或知乎，不代表研究结论**。example.invalid 是不可访问的测试域名；真实模式必须使用上游实际 URL，不得回退这些样例。机器定义以实现后的共享 Zod 为准，字段语义见[后端 API](../backend-api.md)，运行契约见 [ADR-0006](../architecture/decisions/0006-supervised-research-runtime.md)，只做研究范围继续按 ADR-0005。

## 1. 创建请求

POST /api/research-tasks。省略 allowWebSupplement 等价于 false；相同 requestId 仅返回同一任务。

```json
{
  "requestId": "74a52ce5-0da4-481d-894b-a4f94a0a6201",
  "question": "远程小团队如何兼顾专注与协作？",
  "allowWebSupplement": false
}
```

## 2. 任务完成后的详情响应

示例是三个单元并行派发后遇到上游额度耗尽，保留已取得的一份材料并生成部分报告；不是运行成绩或停止策略的评测。初始响应 status=starting、stage=null、plan/analysis/reportId/endedAt=null、findings/queries=[]、请求计数为 0。

```json
{
  "ok": true,
  "data": {
    "id": "task-fixture-1",
    "question": "远程小团队如何兼顾专注与协作？",
    "status": "completed",
    "stage": null,
    "createdAt": "2026-09-13T04:00:00.000Z",
    "endedAt": "2026-09-13T04:00:40.000Z",
    "sourceCount": 1,
    "reportId": "report-fixture-1",
    "error": null,
    "allowWebSupplement": false,
    "plan": {
      "objective": "远程小团队如何兼顾专注与协作？",
      "assumptions": [
        "按跨时区的小团队情境进行研究。"
      ],
      "questions": [
        {
          "id": "q1",
          "text": "材料描述了哪些专注与协作之间的条件？",
          "priority": "high",
          "closedReason": null
        },
        {
          "id": "q2",
          "text": "哪些减少会议的做法可能失败？",
          "priority": "high",
          "closedReason": null
        },
        {
          "id": "q3",
          "text": "结论适用于哪些岗位和团队？",
          "priority": "high",
          "closedReason": null
        }
      ],
      "version": 2
    },
    "analysis": {
      "answers": [
        {
          "questionId": "q1",
          "coverage": "partial",
          "text": "材料提到了会议、专注与文档约定的关系。",
          "gaps": [
            "没有比较不同组织条件。"
          ],
          "findingIds": [
            "finding-fixture-1"
          ]
        },
        {
          "questionId": "q2",
          "coverage": "unanswered",
          "text": "尚无可用失败案例。",
          "gaps": [
            "缺少反证。"
          ],
          "findingIds": []
        },
        {
          "questionId": "q3",
          "coverage": "unanswered",
          "text": "尚无足够适用范围资料。",
          "gaps": [
            "岗位和规模未知。"
          ],
          "findingIds": []
        }
      ]
    },
    "queries": [
      {
        "id": "query-fixture-1",
        "questionId": "q1",
        "channel": "zhihu",
        "text": "远程 小团队 减少会议 专注 经验",
        "purpose": "background",
        "status": "succeeded",
        "sourceIds": [
          "source-fixture-1"
        ],
        "discardedCount": 0,
        "error": null,
        "requestedAt": "2026-09-13T04:00:00.000Z",
        "completedAt": "2026-09-13T04:00:05.000Z",
        "unitId": "unit-fixture-1"
      },
      {
        "id": "query-fixture-2",
        "questionId": "q2",
        "channel": "zhihu",
        "text": "远程团队 减少会议 协作失败",
        "purpose": "counterevidence",
        "status": "failed",
        "sourceIds": [],
        "discardedCount": null,
        "error": {
          "code": "QUOTA_EXHAUSTED",
          "message": "测试场景：上游可用额度耗尽。"
        },
        "requestedAt": "2026-09-13T04:00:00.000Z",
        "completedAt": "2026-09-13T04:00:05.000Z",
        "unitId": "unit-fixture-2"
      },
      {
        "id": "query-fixture-3",
        "questionId": "q3",
        "channel": "zhihu",
        "text": "异步协作 小团队 适用条件",
        "purpose": "verification",
        "status": "failed",
        "sourceIds": [],
        "discardedCount": null,
        "error": {
          "code": "QUOTA_EXHAUSTED",
          "message": "测试场景：上游可用额度耗尽。"
        },
        "requestedAt": "2026-09-13T04:00:00.000Z",
        "completedAt": "2026-09-13T04:00:05.000Z",
        "unitId": "unit-fixture-3"
      }
    ],
    "usage": {
      "searchRequests": 3,
      "modelRequests": 8,
      "inputTokens": null,
      "outputTokens": null,
      "elapsedMs": 40000
    },
    "limits": {
      "maxConcurrentUnits": 3,
      "maxConcurrentSearches": 4,
      "maxSearchRequests": 160,
      "maxModelRequests": 200,
      "maxSources": 800,
      "timeoutMs": 2700000,
      "synthesisModelReserve": 12,
      "synthesisTimeReserveMs": 600000,
      "unitMaxSteps": 12,
      "unitMaxSearchRequests": 8,
      "unitTimeoutMs": 300000,
      "maxRepairPasses": 1
    },
    "modelInfo": {
      "provider": "fixture",
      "modelId": "fixture-model"
    },
    "findings": [
      {
        "id": "finding-fixture-1",
        "unitId": "unit-fixture-1",
        "questionId": "q1",
        "statement": "这份材料把减少会议的收益与跨时区协作的文档条件联系起来。",
        "kind": "experience",
        "conditions": [
          "小团队",
          "跨时区协作"
        ],
        "limitations": [
          "人工构造的测试摘要，不代表真实经验或统计结论。"
        ],
        "evidence": [
          {
            "sourceId": "source-fixture-1",
            "quote": "在小团队中，减少会议可能提升专注，但跨时区协作仍需要明确的文档约定。",
            "relation": "qualify"
          }
        ]
      }
    ]
  }
}
```

## 3. 来源响应

GET /api/research-tasks/{id}/sources。contentId 超过 Number 安全整数范围，必须按字符串传递。以下文本全部人工构造。

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "source-fixture-1",
        "taskId": "task-fixture-1",
        "channel": "zhihu",
        "identity": "answer:9007199254740993",
        "textHash": "4233c902ae0768fd59443615868f902bb5a000cd26c698f7e396c2eb39758b6e",
        "title": "虚构验收材料：小团队协作",
        "url": "https://example.invalid/fixture-answer?source=fixture",
        "canonicalUrl": "https://example.invalid/fixture-answer",
        "text": "在小团队中，减少会议可能提升专注，但跨时区协作仍需要明确的文档约定。",
        "contentExtent": "summary",
        "author": {
          "name": "虚构测试作者",
          "avatarUrl": null,
          "badgeIconUrl": null,
          "badges": []
        },
        "sourceTime": null,
        "timeKind": "unknown",
        "retrievedAt": "2026-09-13T04:00:00.000Z",
        "metadata": {
          "contentType": "Answer",
          "contentId": "9007199254740993",
          "voteCount": null,
          "commentCount": null,
          "authorityLevel": null,
          "rankingScore": null,
          "selectedComments": []
        }
      }
    ]
  }
}
```

## 4. 报告响应

GET /api/research-tasks/{id}/report。Writer 给出 findingIds，应用根据证据派生段落 sourceIds，顶层 sourceIds 为其去重集合。Markdown 编号和链接根据已存来源渲染，不接受模型生成的外部链接。

```json
{
  "ok": true,
  "data": {
    "id": "report-fixture-1",
    "taskId": "task-fixture-1",
    "title": "远程小团队协作：材料中的条件与缺口",
    "sections": {
      "conclusion": [
        {
          "text": "这份材料提示，减少会议和明确文档约定需要一起考虑。",
          "sourceIds": [
            "source-fixture-1"
          ],
          "findingIds": [
            "finding-fixture-1"
          ]
        }
      ],
      "evidence": [
        {
          "text": "在小团队中，减少会议可能提升专注，但跨时区协作仍需要明确的文档约定。",
          "sourceIds": [
            "source-fixture-1"
          ],
          "findingIds": [
            "finding-fixture-1"
          ]
        }
      ],
      "disagreements": [],
      "gaps": [
        "没有取得失败案例的有效资料。",
        "不能判断不同岗位或团队规模的适用条件。"
      ]
    },
    "sourceIds": [
      "source-fixture-1"
    ],
    "completeness": "partial",
    "stopReason": "upstream_unavailable",
    "limitations": [
      "仅使用搜索摘要，未阅读全文。",
      "单份材料没有统计代表性，来源时间未知。",
      "并行请求遇到上游额度耗尽，部分问题没有取得资料。"
    ],
    "createdAt": "2026-09-13T04:00:40.000Z"
  }
}
```

## 5. 重复键冲突

相同 requestId 携带不同问题或来源开关时返回 HTTP 409。相同输入重复创建应返回 HTTP 200 与原任务，不是下面的错误。

```json
{
  "ok": false,
  "error": {
    "code": "REQUEST_CONFLICT",
    "message": "该 requestId 已用于不同的研究请求。"
  }
}
```

取消、失败或中断但未生成报告时，GET report 返回 REPORT_NOT_READY；任务/来源仍可读取。API 读取成功不等于任务成功，不能用 ok 字段替代 status。
