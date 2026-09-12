import { ProductError } from "../platform/zhihu/errors.ts";
import type { ContentGateway, ContentSource, ContentSourceKind, SearchResult } from "../platform/zhihu/content.ts";

export type ResearchBriefInput = {
  question: string;
  zhihuCount?: number;
  globalCount?: number;
  hotLimit?: number;
  includeGlobal?: boolean;
  includeHot?: boolean;
  selectedIds?: string[];
};

export type ResearchBrief = {
  question: string;
  generatedAt: string;
  conclusion: string;
  empty: boolean;
  sources: ContentSource[];
  collections: Array<{
    kind: ContentSourceKind;
    itemCount: number;
    emptyReason?: string;
  }>;
};

export type ComposeResearchBriefInput = {
  question: string;
  sources: ContentSource[];
  selectedIds?: string[];
  collections: ResearchBrief["collections"];
  generatedAt?: string;
};

export function createResearchBriefCommand(content: ContentGateway, clock: () => Date = () => new Date()) {
  return {
    async execute(input: ResearchBriefInput): Promise<ResearchBrief> {
      const question = input.question.trim();
      if (!question) {
        throw new ProductError("INVALID_INPUT", "研究问题不能为空。");
      }

      const zhihu = await content.searchZhihu({ query: question, count: input.zhihuCount });
      const global = input.includeGlobal === false
        ? emptyCollection("global_search")
        : await content.searchGlobal({ query: question, count: input.globalCount });
      const hot = input.includeHot
        ? await content.listHotContent({ limit: input.hotLimit })
        : emptyCollection("hot_list");

      return composeResearchBrief({
        question,
        sources: uniqueSources([
        ...zhihu.items,
        ...global.items,
        ...relatedHotItems(hot.items, question),
        ]),
        selectedIds: input.selectedIds,
        collections: [
          { kind: zhihu.kind, itemCount: zhihu.items.length, emptyReason: zhihu.emptyReason },
          { kind: global.kind, itemCount: global.items.length },
          { kind: hot.kind, itemCount: hot.items.length },
        ],
        generatedAt: clock().toISOString(),
      });
    },
  };
}

export function composeResearchBrief(input: ComposeResearchBriefInput): ResearchBrief {
  const question = input.question.trim();
  if (!question) throw new ProductError("INVALID_INPUT", "研究问题不能为空。");
  const selected = selectSources(uniqueSources(input.sources), input.selectedIds);
  return {
    question,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    empty: selected.length === 0,
    conclusion: selected.length === 0
      ? `没有找到可引用的公开来源，无法对「${question}」形成研究结论。`
      : composeConclusion(question, selected),
    sources: selected,
    collections: input.collections,
  };
}

function emptyCollection(kind: ContentSourceKind): SearchResult {
  return { kind, fetchedAt: new Date(0).toISOString(), items: [] };
}

function uniqueSources(items: ContentSource[]): ContentSource[] {
  const seen = new Set<string>();
  const result: ContentSource[] = [];
  for (const item of items) {
    const key = item.url || item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function selectSources(items: ContentSource[], selectedIds: string[] | undefined): ContentSource[] {
  if (!selectedIds || selectedIds.length === 0) return items.slice(0, 6);
  const wanted = new Set(selectedIds);
  return items.filter((item) => wanted.has(item.id));
}

function relatedHotItems(items: ContentSource[], question: string): ContentSource[] {
  const tokens = question.toLowerCase().split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length === 0) return [];
  return items.filter((item) => {
    const haystack = `${item.title} ${item.summary}`.toLowerCase();
    return tokens.some((token) => haystack.includes(token));
  });
}

function composeConclusion(question: string, sources: ContentSource[]): string {
  const zhihuCount = sources.filter((item) => item.kind === "zhihu_search").length;
  const globalCount = sources.filter((item) => item.kind === "global_search").length;
  const hotCount = sources.filter((item) => item.kind === "hot_list").length;
  const authors = sources
    .map((item) => item.authorName)
    .filter((name): name is string => Boolean(name))
    .slice(0, 3);
  const lead = sources[0];
  const parts = [
    `围绕「${question}」共引用 ${sources.length} 条公开来源`,
    `其中知乎 ${zhihuCount} 条、全网 ${globalCount} 条、相关热榜 ${hotCount} 条`,
  ];
  if (lead) parts.push(`主要依据是《${lead.title}》`);
  if (authors.length > 0) parts.push(`涉及作者 ${authors.join("、")}`);
  parts.push("以上结论只覆盖检索摘要，完整论述需打开原文核对。");
  return `${parts.slice(0, -1).join("；")}。${parts.at(-1)}`;
}
