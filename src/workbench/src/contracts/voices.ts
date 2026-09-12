/** 众声视图契约：与本地 API `POST /api/research/voices` 的响应结构一致。 */

/** 检索范围：只读知乎站内，或在站内之外补上全网来源。 */
export type VoicesScope = "zhihu" | "web";

/** 全网来源的时间范围；站内搜索没有时间过滤，仅在 scope 为 web 时生效。 */
export type VoicesRecency = "any" | "7d" | "1m" | "3m";

export type VoiceSourceKind = "zhihu_search" | "global_search" | "hot_list" | "question_answers";

export type VoiceSource = {
  readonly id: string;
  readonly kind: VoiceSourceKind;
  readonly title: string;
  readonly url: string;
  readonly summary: string;
  readonly authorName?: string;
  readonly contentType?: string;
  readonly voteCount?: number;
  readonly commentCount?: number;
  readonly fetchedAt: string;
};

export type VoiceClusterView = {
  readonly id: string;
  readonly label: string;
  readonly statement: string;
  /** 来源按 kind 区分来路：question_answers 是落点问题下的回答，其它是别处的相关讨论。 */
  readonly sources: readonly VoiceSource[];
};

/** 这个议题在知乎上的聚焦落点；缺省表示讨论分散在多个问题。 */
export type VoicesAnchorView = {
  readonly questionId: string;
  readonly title: string;
  /** 问题页地址由服务端给出，界面不自行拼接平台 URL。 */
  readonly url: string;
  readonly answerCount: number;
};

export type VoicesAnchorCandidateView = {
  readonly questionId: string;
  readonly title: string;
  readonly hitCount: number;
};

export type VoicesView = {
  readonly issue: string;
  readonly generatedAt: string;
  readonly model: string;
  readonly empty: boolean;
  readonly emptyReason?: string;
  readonly anchor?: VoicesAnchorView;
  readonly anchorCandidates: readonly VoicesAnchorCandidateView[];
  readonly clusters: readonly VoiceClusterView[];
  readonly consensus?: string;
  readonly tension?: string;
  readonly unclustered: readonly VoiceSource[];
  readonly sourceCount: number;
};
