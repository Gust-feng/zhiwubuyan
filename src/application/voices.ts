import { ProductError } from "../platform/zhihu/errors.ts";
import { questionIdFromZhihuUrl, questionUrl } from "../platform/zhihu/urls.ts";
import type { ContentGateway, ContentSource } from "../platform/zhihu/content.ts";
import type { ZhidaGateway, ZhidaModel } from "../platform/zhihu/zhida.ts";

const CLUSTER_MODEL: ZhidaModel = "zhida-fast-1p5";
/** 知乎搜索单页上限 10 条，取满以提高「同一问题下多条命中」的锚定命中率。 */
const SEARCH_COUNT = 10;
/** 从锚定问题下读取的回答条数；送入聚类前还会按总上限再截一次。 */
const ANSWER_COUNT = 12;
/**
 * 送入直答聚类的来源条数上限。实测 zhida-fast-1p5 在 12 条以内稳定返回 JSON，
 * 13 条起会退化成自我介绍式回答，因此这是硬约束，不能按来源多少无限追加。
 */
const CLUSTER_SOURCE_LIMIT = 12;
/** 锚定时保留的「别处相关讨论」总条数，其余名额留给该问题下的回答。 */
const RELATED_LIMIT = 3;
/** 补充全网时，别处讨论里最多保留的全网来源条数，其余名额留给站内讨论。 */
const WEB_RELATED_LIMIT = 2;
/** 全网搜索请求条数（上游上限 20）。 */
const WEB_COUNT = 6;
const SUMMARY_LIMIT = 600;
const CACHE_TTL_MS = 15 * 60 * 1000;
/** 同一问题在搜索结果里出现到这么多条，才算这个议题的聚焦落点。 */
const ANCHOR_MIN_HITS = 2;

/** 检索范围：只读知乎站内，或在站内之外补充全网来源。 */
export type VoicesScope = "zhihu" | "web";

/** 全网来源的时间范围；站内搜索没有时间过滤，仅在 scope 为 web 时生效。 */
export type VoicesRecency = "any" | "7d" | "1m" | "3m";

export type VoiceCluster = {
  id: string;
  label: string;
  statement: string;
  /**
   * 支撑这个说法的来源，按来路带 kind：`question_answers` 是锚定问题下的回答，
   * 其它是别处问题下的相关讨论。前端据此把主体常驻、补充折叠；未锚定时全部是相关讨论。
   */
  sources: ContentSource[];
};

export type VoicesAnchor = {
  questionId: string;
  title: string;
  /** 知乎问题页地址，由平台适配层提供，界面不自行拼接。 */
  url: string;
  /** 从该问题下实际读取到的回答条数。 */
  answerCount: number;
};

export type VoicesAnchorCandidate = {
  questionId: string;
  title: string;
  hitCount: number;
};

export type Voices = {
  /** 用户输入的议题原文。 */
  issue: string;
  generatedAt: string;
  model: string;
  empty: boolean;
  emptyReason?: string;
  /** 这个议题在知乎上的聚焦落点；为 undefined 表示讨论分散在多个问题。 */
  anchor?: VoicesAnchor;
  /** 其它可切换的落点候选，供用户改看别处。 */
  anchorCandidates: VoicesAnchorCandidate[];
  clusters: VoiceCluster[];
  consensus?: string;
  tension?: string;
  unclustered: ContentSource[];
  sourceCount: number;
};

export type VoicesInput = {
  issue: string;
  model?: ZhidaModel;
  /** 指定落点问题；不传时由检索结果自动判定。 */
  anchorQuestionId?: string;
  /** 是否补充全网来源；不传按只读知乎站内。 */
  scope?: VoicesScope;
  /** 全网来源的时间范围；不传表示不限时间。 */
  recency?: VoicesRecency;
};

export function createVoicesCommand(input: {
  content: ContentGateway;
  zhida: ZhidaGateway;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());
  const cache = new Map<string, { at: number; voices: Voices }>();
  const inFlight = new Map<string, Promise<Voices>>();

  async function compose(request: VoicesInput): Promise<Voices> {
    const issue = request.issue.trim();
    if (!issue) throw new ProductError("INVALID_INPUT", "议题不能为空。");

    const scope = request.scope ?? "zhihu";
    const recency = request.recency ?? "any";
    const zhihuSearch = await input.content.searchZhihu({ query: issue, count: SEARCH_COUNT });
    // 全网是站内之外的补充；站内搜索没有时间过滤，时间范围只作用于全网。
    const webSearch = scope === "web"
      ? await input.content.searchGlobal({
          query: issue,
          count: WEB_COUNT,
          filter: recencyFilter(recency, clock()),
        })
      : undefined;
    const zhihuFound = zhihuSearch.items;
    const webFound = webSearch?.items ?? [];
    if (zhihuFound.length === 0 && webFound.length === 0) {
      return emptyVoices(issue, clock().toISOString(), zhihuSearch.emptyReason);
    }

    // 落点只在站内结果里判定：全网结果带不带知乎链接都不该影响「同一问题」的判定。
    const anchor = resolveAnchor(zhihuFound, request.anchorQuestionId);
    const candidates = anchorCandidates(zhihuFound, anchor);
    const answers = anchor
      ? (await input.content.listQuestionAnswers({
          questionId: anchor.questionId,
          questionTitle: anchor.title,
          count: ANSWER_COUNT,
        })).items
      : [];
    const zhihuRelated = anchor
      ? zhihuFound.filter((source) => source.questionId !== anchor.questionId)
      : zhihuFound;
    // 锚定时：该问题下的回答是主体，别处的讨论是补充；补充里给全网留出固定名额。
    const webTake = Math.min(webFound.length, WEB_RELATED_LIMIT, RELATED_LIMIT);
    const relatedKept = [...zhihuRelated.slice(0, RELATED_LIMIT - webTake), ...webFound.slice(0, webTake)];
    const answersKept = answers.slice(0, CLUSTER_SOURCE_LIMIT - relatedKept.length);
    const all = answersKept.length > 0
      ? [...answersKept, ...relatedKept]
      : [...zhihuFound.slice(0, CLUSTER_SOURCE_LIMIT - webTake), ...webFound.slice(0, webTake)].slice(0, CLUSTER_SOURCE_LIMIT);
    // 只有真读到回答才算落点成立；读不到就如实降级为「讨论分散在多个问题」。
    const resolvedAnchor =
      anchor !== undefined && answersKept.length > 0
        ? { questionId: anchor.questionId, title: anchor.title, url: questionUrl(anchor.questionId), answerCount: answersKept.length }
        : undefined;

    const model = request.model ?? CLUSTER_MODEL;
    const prompt = buildPrompt(issue, all);
    // 直答偶尔会返回不可解析的内容（自我介绍式退化或残缺 JSON）。这里只对这条幂等的
    // 生成请求重试一次；仍失败才如实报错，不无限重试。
    const raw = await input.zhida.answer({ model, prompt });
    let parsed = safeParseClusters(raw.content);
    if (parsed === undefined || parsed.clusters.length === 0) {
      const retry = await input.zhida.answer({ model, prompt });
      parsed = safeParseClusters(retry.content);
    }
    if (parsed === undefined || parsed.clusters.length === 0) {
      throw new ProductError("PROTOCOL_ERROR", "看山没能把这些说法整理成结构，请再试一次。");
    }
    return finalize({
      issue,
      generatedAt: clock().toISOString(),
      model: raw.model,
      anchor: resolvedAnchor,
      candidates,
      all,
      parsed,
    });
  }

  return {
    async execute(request: VoicesInput): Promise<Voices> {
      const issue = request.issue.trim();
      if (!issue) throw new ProductError("INVALID_INPUT", "议题不能为空。");
      const anchorKey = request.anchorQuestionId?.trim() ?? "";
      // 范围与时间会影响取数结果，必须进缓存键，否则不同参数会串用同一份结果。
      const key = `${issue.replace(/\s+/g, " ").toLowerCase()}\u0000${anchorKey}\u0000${request.scope ?? "zhihu"}\u0000${request.recency ?? "any"}`;

      const cached = cache.get(key);
      if (cached && clock().getTime() - cached.at < CACHE_TTL_MS) return cached.voices;

      const running = inFlight.get(key);
      if (running) return running;

      const task = compose(request)
        .then((voices) => {
          cache.set(key, { at: clock().getTime(), voices });
          return voices;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, task);
      return task;
    },
  };
}

function emptyVoices(issue: string, generatedAt: string, emptyReason?: string): Voices {
  return {
    issue,
    generatedAt,
    model: CLUSTER_MODEL,
    empty: true,
    emptyReason,
    anchorCandidates: [],
    clusters: [],
    unclustered: [],
    sourceCount: 0,
  };
}

/** 全网搜索的 publish_time 过滤表达式；秒级时间戳，不限时间时返回 undefined。 */
function recencyFilter(recency: VoicesRecency, now: Date): string | undefined {
  const days = RECENCY_DAYS[recency];
  if (days === undefined) return undefined;
  const since = Math.floor(now.getTime() / 1000) - days * 24 * 60 * 60;
  return `publish_time>=${since}`;
}

const RECENCY_DAYS: Readonly<Record<VoicesRecency, number | undefined>> = {
  any: undefined,
  "7d": 7,
  "1m": 30,
  "3m": 90,
};

/**
 * 判定议题的聚焦落点：统计检索结果分别落在哪些知乎问题上，取命中最多且达到阈值的问题。
 * 指定了 anchorQuestionId 时优先使用它，但仍要求该问题在本次检索里出现过，避免凭空锚定。
 */
function resolveAnchor(
  sources: ContentSource[],
  requestedQuestionId?: string,
): { questionId: string; title: string; answerCount: number } | undefined {
  const hits = countQuestionHits(sources);
  const requested = requestedQuestionId?.trim();
  if (requested) {
    const entry = hits.get(requested);
    if (!entry) return undefined;
    return { questionId: requested, title: entry.title, answerCount: entry.count };
  }
  let best: { questionId: string; title: string; answerCount: number } | undefined;
  for (const [questionId, entry] of hits) {
    if (entry.count < ANCHOR_MIN_HITS) continue;
    if (!best || entry.count > best.answerCount) {
      best = { questionId, title: entry.title, answerCount: entry.count };
    }
  }
  return best;
}

function countQuestionHits(sources: ContentSource[]): Map<string, { title: string; count: number }> {
  const hits = new Map<string, { title: string; count: number }>();
  for (const source of sources) {
    const questionId = source.questionId ?? questionIdFromZhihuUrl(source.url);
    if (!questionId) continue;
    const existing = hits.get(questionId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    hits.set(questionId, { title: questionTitle(source.title), count: 1 });
  }
  return hits;
}

function anchorCandidates(
  sources: ContentSource[],
  anchor: { questionId: string } | undefined,
): VoicesAnchorCandidate[] {
  return [...countQuestionHits(sources)]
    .filter(([questionId]) => questionId !== anchor?.questionId)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 2)
    .map(([questionId, entry]) => ({ questionId, title: entry.title, hitCount: entry.count }));
}

/** 搜索结果里回答的标题就是它所属的问题标题，去掉知乎搜索附加的站点后缀。 */
function questionTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.endsWith(" - 知乎") ? trimmed.slice(0, -4).trim() : trimmed;
}

function buildPrompt(issue: string, sources: ContentSource[]): string {
  const lines = sources.map((source, index) => {
    const meta = [
      source.kind === "question_answers" ? "该问题下的回答" : "别处的相关讨论",
      source.authorName,
      source.contentType?.toLowerCase() === "article" ? "文章" : "回答",
      source.voteCount !== undefined ? `赞 ${source.voteCount}` : undefined,
    ].filter(Boolean).join("，");
    const title = source.title.trim();
    const heading = title === "" ? "" : `《${title}》`;
    return `S${index + 1}.${heading}（${meta}）：${source.summary.slice(0, SUMMARY_LIMIT)}`;
  });
  return [
    `你在「知无不言」产品里负责把一个议题下的不同说法整理出来。下面是围绕议题「${issue}」检索到的 ${sources.length} 条知乎内容摘要。`,
    "",
    "任务：",
    "1. 把这些内容按立场或看法聚成 2 到 5 个说法簇，每条内容只归入最匹配的一个簇。",
    "2. 每个簇输出：label（10 字以内的说法名）、statement（2 到 3 句话，概括这个说法的主张和依据）、sourceIds（支持该说法的来源编号，如 \"S1\"）。",
    "3. 另外输出 consensus（各说法共同认可的一点；没有就写\"没有明显共识\"）和 tension（最主要的分歧点，一句话）。",
    "4. 只使用给出的来源信息，不要引入外部资料；说法之间确实对立时才写分歧，不夸大分歧。",
    "5. 只输出 JSON，不要输出其他内容，格式：",
    '{"clusters":[{"label":"...","statement":"...","sourceIds":["S1"]}],"consensus":"...","tension":"..."}',
    "",
    "来源：",
    lines.join("\n\n"),
  ].join("\n");
}

type ParsedClusters = {
  clusters: Array<{ label: string; statement: string; sourceIds: string[] }>;
  consensus?: string;
  tension?: string;
};

function parseClusters(text: string): ParsedClusters {
  const jsonText = text.replace(/```(?:json)?/g, "").trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new ProductError("PROTOCOL_ERROR", "直答没有返回可解析的整理结果。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  } catch {
    throw new ProductError("PROTOCOL_ERROR", "直答返回的整理结果不是合法 JSON。");
  }
  return readParsedClusters(parsed);
}

/** 解析失败返回 undefined（供重试判断），不抛错。 */
function safeParseClusters(text: string): ParsedClusters | undefined {
  try {
    return parseClusters(text);
  } catch {
    return undefined;
  }
}

function readParsedClusters(parsed: unknown): ParsedClusters {
  const record = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const clusters = (Array.isArray(record.clusters) ? record.clusters : []).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    const label = typeof entry.label === "string" ? entry.label.trim() : "";
    const statement = typeof entry.statement === "string" ? entry.statement.trim() : "";
    if (!label || !statement) return [];
    const sourceIds = Array.isArray(entry.sourceIds)
      ? entry.sourceIds.filter((id): id is string => typeof id === "string" && id.trim() !== "")
      : [];
    return [{ label, statement, sourceIds }];
  });
  return {
    clusters,
    consensus: readText(record.consensus),
    tension: readText(record.tension),
  };
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function finalize(input: {
  issue: string;
  generatedAt: string;
  model: string;
  anchor: VoicesAnchor | undefined;
  candidates: VoicesAnchorCandidate[];
  all: ContentSource[];
  parsed: ParsedClusters;
}): Voices {
  // 说法编号覆盖全部来源，与提示词里的 S 编号一致；来路由每条来源自己的 kind 承载。
  const byTag = new Map(input.all.map((source, index) => [`S${index + 1}`, source]));
  const claimed = new Set<string>();
  const clusters = input.parsed.clusters.flatMap((cluster, index) => {
    const sources = cluster.sourceIds.flatMap((tag) => {
      const source = byTag.get(tag.trim().toUpperCase());
      if (!source || claimed.has(source.id)) return [];
      claimed.add(source.id);
      return [source];
    });
    // 没有真实来源支撑的说法不展示，这是产品诚实原则的一部分。
    if (sources.length === 0) return [];
    return [{
      id: `cluster-${index + 1}`,
      label: cluster.label,
      statement: cluster.statement,
      sources,
    }];
  });

  const unclaimed = input.all.filter((source) => !claimed.has(source.id));
  return {
    issue: input.issue,
    generatedAt: input.generatedAt,
    model: input.model,
    empty: false,
    anchor: input.anchor,
    anchorCandidates: input.candidates,
    clusters,
    consensus: input.parsed.consensus,
    tension: input.parsed.tension,
    unclustered: unclaimed,
    sourceCount: input.all.length,
  };
}
