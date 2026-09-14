/** 入口种子契约：与本地 API `GET /api/research/seeds?kind=...` 的响应结构一致。
 *  素材按入口各取各的（深度研究用本人收藏，众声用公开热榜），提炼机制与响应形状相同。 */

export const ENTRY_SEED_KINDS = ['research', 'voices'] as const;
export type EntrySeedKind = (typeof ENTRY_SEED_KINDS)[number];

export type EntrySeedsView = {
  readonly kind: EntrySeedKind;
  /** 生成时实际使用的素材标题（本人收藏 / 热榜条目）；素材为空时为空。 */
  readonly topics: readonly string[];
  readonly generatedAt: string;
  /** 未调用直答时缺省——没有主题就不消耗额度，也就没有模型名。 */
  readonly model?: string;
  /** 没有收藏时为空列表，此时不是失败。 */
  readonly items: readonly string[];
};
