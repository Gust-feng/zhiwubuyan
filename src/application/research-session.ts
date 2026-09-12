import { randomUUID } from "node:crypto";
import { ProductError } from "../platform/zhihu/errors.ts";
import type { ContentGateway, ContentSource, SearchResult } from "../platform/zhihu/content.ts";
import { composeResearchBrief, type ResearchBrief } from "./research-brief.ts";

export type ResearchSession = {
  id: string;
  question: string;
  createdAt: string;
  sources: ContentSource[];
  collections: ResearchBrief["collections"];
};

export interface ResearchSessionStore {
  save(session: ResearchSession): void;
  get(id: string): ResearchSession | undefined;
}

export function createMemoryResearchSessionStore(limit = 50): ResearchSessionStore {
  const sessions = new Map<string, ResearchSession>();
  return {
    save(session) {
      sessions.set(session.id, session);
      while (sessions.size > limit) {
        const oldest = sessions.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        sessions.delete(oldest);
      }
    },
    get(id) {
      return sessions.get(id);
    },
  };
}

export function createResearchSessionApplication(input: {
  content: ContentGateway;
  store: ResearchSessionStore;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());
  return {
    async begin(request: {
      question: string;
      includeGlobal?: boolean;
      includeHot?: boolean;
    }): Promise<ResearchSession> {
      const question = request.question.trim();
      if (!question) throw new ProductError("INVALID_INPUT", "研究问题不能为空。");
      const tasks: Promise<SearchResult>[] = [input.content.searchZhihu({ query: question, count: 10 })];
      if (request.includeGlobal !== false) tasks.push(input.content.searchGlobal({ query: question, count: 8 }));
      if (request.includeHot === true) tasks.push(input.content.listHotContent({ limit: 20 }));
      const results = await Promise.all(tasks);
      const sources = uniqueByUrl(results.flatMap((result) => result.items));
      const session: ResearchSession = {
        id: randomUUID(),
        question,
        createdAt: clock().toISOString(),
        sources,
        collections: results.map((result) => ({
          kind: result.kind,
          itemCount: result.items.length,
          emptyReason: result.emptyReason,
        })),
      };
      input.store.save(session);
      return session;
    },
    buildBrief(request: { sessionId: string; selectedIds: string[] }): ResearchBrief {
      const session = input.store.get(request.sessionId);
      if (!session) throw new ProductError("INVALID_INPUT", "研究会话已失效，请重新搜索。");
      const known = new Set(session.sources.map((source) => source.id));
      const selectedIds = request.selectedIds.filter((id) => known.has(id));
      if (selectedIds.length !== request.selectedIds.length) {
        throw new ProductError("INVALID_INPUT", "选择中包含不属于当前研究会话的来源。");
      }
      return composeResearchBrief({
        question: session.question,
        sources: session.sources,
        selectedIds,
        collections: session.collections,
        generatedAt: clock().toISOString(),
      });
    },
  };
}

function uniqueByUrl(sources: ContentSource[]): ContentSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}
