/** 圈子社区视图契约：与本地 API `/api/circles*` 的响应结构一致。
 *  上游正文一律由服务端转成纯文本，这里不出现任何 HTML。 */

export type CircleSummaryView = {
  readonly id: string;
  readonly name: string;
};

export type CircleRingView = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly avatarUrl: string;
  readonly membershipCount?: number;
  readonly discussionCount?: number;
};

export type CircleCommentView = {
  readonly id: string;
  readonly content: string;
  readonly authorName: string;
  readonly likeCount?: number;
  readonly replyCount?: number;
  readonly publishedAt?: string;
};

export type CirclePostView = {
  readonly id: string;
  /** 帖子自己的标题；上游常留空，由服务端从正文首段分离，分离不出则缺省。 */
  readonly title?: string;
  readonly content: string;
  /** 为 true 时界面必须说明正文是节选。 */
  readonly truncated: boolean;
  readonly authorName: string;
  readonly imageUrls: readonly string[];
  readonly publishedAt?: string;
  readonly likeCount?: number;
  readonly commentCount?: number;
  readonly favoriteCount?: number;
  readonly shareCount?: number;
  readonly comments: readonly CircleCommentView[];
};

export type CircleFeedView = {
  readonly ring: CircleRingView;
  readonly posts: readonly CirclePostView[];
  readonly page: number;
  readonly fetchedAt: string;
};

export type CircleStoryView = {
  readonly workId: string;
  readonly title: string;
  readonly artworkUrl?: string;
  readonly tabArtworkUrl?: string;
  readonly description?: string;
  readonly labels: readonly string[];
};

export type CircleStoryDetailView = {
  readonly workId: string;
  readonly chapterName?: string;
  readonly authorName?: string;
  readonly labels: readonly string[];
  readonly introduction?: string;
  readonly content: string;
  /** 上游对故事正文有长度上限，为 true 时说明是节选而非全文。 */
  readonly truncated: boolean;
};
