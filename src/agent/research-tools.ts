import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { DeepResearchSystem, ReadSourceResult, UnitSearchResult } from "../application/deep-research.ts";

export type ResearchToolsContext = {
  engine: DeepResearchSystem;
  taskId: string;
  unitId: string;
  questionId: string;
  allowWebSupplement: boolean;
  runSignal: AbortSignal;
};

/**
 * 调查单元工具：官方 createTool 适配，内部调用应用命令。
 * taskId/unitId/questionId 与权限绑定在可信执行上下文（闭包）中，
 * 模型不能通过参数切换任务、单元或扩大范围。
 */
export function createResearchTools(context: ResearchToolsContext) {
  const { engine, taskId, unitId, questionId, allowWebSupplement, runSignal } = context;

  const searchZhihu = createTool({
    id: "search-zhihu",
    description:
      "搜索知乎公开内容（摘要）。同一任务内相同查询会复用已有结果。返回来源列表：sourceId、标题、作者、时间语义与摘要文本。",
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe("知乎搜索词，使用概念名、具体问题、使用场景、年份、失败经验或争议点"),
      purpose: z
        .enum(["background", "supporting", "counterevidence", "verification", "qualification"])
        .describe("本次搜索的目的"),
    }),
    execute: async (input: { query: string; purpose: "background" | "supporting" | "counterevidence" | "verification" | "qualification" }): Promise<UnitSearchResult> => {
      return await engine.unitSearch({
        taskId,
        unitId,
        questionId,
        channel: "zhihu",
        text: input.query,
        purpose: input.purpose,
        runSignal,
      });
    },
  });

  const searchWeb = createTool({
    id: "search-web",
    description:
      "全网搜索（仅当任务明确允许时可用，用于官方事实补证）。返回来源列表，摘要不是全文。",
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe("全网搜索词，用于核对官方资料或原始出处"),
      purpose: z.enum(["verification", "supporting", "background"]).describe("本次搜索的目的"),
    }),
    execute: async (input: { query: string; purpose: "verification" | "supporting" | "background" }): Promise<UnitSearchResult> => {
      if (!allowWebSupplement) {
        return {
          status: "rejected",
          reason: "web_channel_not_allowed",
          sources: [],
        };
      }
      return await engine.unitSearch({
        taskId,
        unitId,
        questionId,
        channel: "web",
        text: input.query,
        purpose: input.purpose,
        runSignal,
      });
    },
  });

  const readSource = createTool({
    id: "read-source",
    description:
      "读取本任务已保存来源摘要的指定片段（从 offset 开始约 2,000 字符）。只能读取本任务来源，不能获取网页全文。",
    inputSchema: z.object({
      sourceId: z.string().min(1).max(64).describe("本任务搜索结果返回的 sourceId"),
      offset: z.number().int().min(0).max(100_000).default(0).describe("起始偏移，默认 0"),
    }),
    execute: async (input: { sourceId: string; offset: number }): Promise<ReadSourceResult> => {
      return await engine.readSourceExcerpt({ taskId, sourceId: input.sourceId, offset: input.offset });
    },
  });

  const tools: Record<string, typeof searchZhihu | typeof searchWeb | typeof readSource> = {
    search_zhihu: searchZhihu,
    read_source: readSource,
  };
  if (allowWebSupplement) {
    tools.search_web = searchWeb;
  }
  return tools;
}
