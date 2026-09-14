# 赛事故事与知识内容接口

这些接口面向当前知乎赛事内容，不需要 Access Secret 或 OAuth token。它们与开放平台公共内容接口、用户数据接口分开处理，不能作为长期稳定的平台承诺。

## 端点

| 内容 | 方法 | 地址 |
|---|---|---|
| 故事列表 | GET | `https://api.zhihu.com/km-indep-home/hackathon/v2/story/list` |
| 故事详情 | GET | `https://api.zhihu.com/km-indep-home/hackathon/v2/story/{work_id}` |
| 知识列表 | GET | `https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/list` |
| 知识详情 | GET | `https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/{work_id}` |

列表返回数组，条目通常包含 `work_id`、`title`、`artwork`、`tab_artwork`、`description` 和 `labels`。详情通常包含 `work_id`、`chapter_name`、`author_avatar`、`author_name`、`labels`、`introduction` 和 `content`。

详情 ID 必须来自对应类型的列表结果，拒绝包含 `/`、`?`、`#`、回车或换行的值，并使用 URL path 编码函数。只访问文档列出的 `api.zhihu.com` 主机，不根据返回内容切换域名；失败时展示真实状态和收敛后的错误，不循环重试。

展示、摘要或改编正文时保留作者和来源归属，控制读取长度，不把原文伪装成产品或用户原创。活动结束后接口路径和可用性可能变化。
