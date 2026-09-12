/** 提问入口的种子问题契约：与本地 API `POST /api/research/seed-questions` 的响应结构一致。 */

export type SeedQuestionsView = {
  /** 生成时实际使用的主题，即提交上去的收藏标题。 */
  readonly topics: readonly string[];
  readonly generatedAt: string;
  readonly model: string;
  readonly questions: readonly string[];
};
