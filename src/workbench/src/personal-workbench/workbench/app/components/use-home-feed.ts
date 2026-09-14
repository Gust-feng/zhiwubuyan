import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 首页内容流与问答的取数。
 * 与 use-core-feed 的区别：这里要携带检索词与筛选条件，并且区分「上游失败」与
 * 「确实没有结果」——首页在额度耗尽时拿到的是上一批缓存，不能伪装成最新内容。
 */

export type HomeFeedChannel = 'hot' | 'topic'
export type HomeFeedScope = 'zhihu' | 'web'
export type HomeFeedType = 'all' | 'answer' | 'article'

export interface HomeFeedItem {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly summary: string
  readonly contentType?: string
  readonly authorName?: string
  readonly authorBadgeText?: string
  readonly voteCount?: number
  readonly commentCount?: number
  readonly thumbnailUrl?: string
}

export interface HomeFeed {
  readonly channel: HomeFeedChannel
  readonly topic?: string
  readonly fetchedAt: string
  readonly items: readonly HomeFeedItem[]
  readonly emptyReason?: string
  readonly stale?: boolean
}

export interface HomeFeedState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly channel: HomeFeedChannel
  readonly items: readonly HomeFeedItem[]
  readonly fetchedAt?: string
  readonly stale: boolean
  readonly error?: string
  /** 已确认的空结果：上游明确返回零条，且不是失败。 */
  readonly empty: boolean
}

export interface HomeAnswer {
  readonly question: string
  readonly tier: 'fast' | 'thinking'
  readonly model: string
  readonly content: string
  readonly generatedAt: string
}

export interface HomeAnswerState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly answer?: HomeAnswer
  readonly error?: string
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 上游条目在应用层已归一；界面只读取真实存在的字段，缺失就留空。 */
export function readHomeFeedItems(body: Record<string, unknown>): readonly HomeFeedItem[] {
  const items = Array.isArray(body.items) ? body.items : []
  return items.flatMap((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return []
    const item = raw as Record<string, unknown>
    const id = readString(item.id)
    const title = readString(item.title)
    if (id === '' || title === '') return []
    return [{
      id,
      title,
      url: readString(item.url),
      summary: readString(item.summary),
      contentType: readString(item.contentType) || undefined,
      authorName: readString(item.authorName) || undefined,
      authorBadgeText: readString(item.authorBadgeText) || undefined,
      voteCount: readNumber(item.voteCount),
      commentCount: readNumber(item.commentCount),
      thumbnailUrl: readString(item.thumbnailUrl) || undefined,
    }]
  })
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null
  return body?.message ?? `请求失败（${response.status}）。`
}

export function useHomeFeed(input: {
  topic?: string
  scope?: HomeFeedScope
  type?: HomeFeedType
  /** false 时不请求；首页没有检索词时由探索页独占热榜读取。 */
  enabled?: boolean
  /** 仅用于用户显式重试；服务端仍负责热榜缓存与单飞。 */
  refreshKey?: number
}): HomeFeedState {
  const { topic = '', scope = 'zhihu', type = 'all', enabled = true, refreshKey = 0 } = input
  const [state, setState] = useState<HomeFeedState>({
    status: 'loading',
    channel: 'hot',
    items: [],
    stale: false,
    empty: false,
  })
  const seqRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      seqRef.current += 1
      setState({
        status: 'ready',
        channel: topic === '' ? 'hot' : 'topic',
        items: [],
        fetchedAt: undefined,
        stale: false,
        empty: true,
      })
      return
    }
    const seq = seqRef.current + 1
    seqRef.current = seq
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (topic !== '') {
      params.set('topic', topic)
      params.set('scope', scope)
      params.set('type', type)
    }
    const query = params.toString()
    setState((previous) => ({
      ...previous,
      status: 'loading',
      error: undefined,
    }))
    fetch(`/api/home/feed${query === '' ? '' : `?${query}`}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response))
        const body = (await response.json()) as unknown
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          return { items: [], channel: 'hot' as const, fetchedAt: undefined, stale: false, empty: true }
        }
        const record = body as Record<string, unknown>
        const items = readHomeFeedItems(record)
        return {
          items,
          channel: record.channel === 'topic' ? ('topic' as const) : ('hot' as const),
          fetchedAt: readString(record.fetchedAt) || undefined,
          stale: record.stale === true,
          empty: items.length === 0,
        }
      })
      .then((page) => {
        if (seqRef.current !== seq) return
        setState({
          status: 'ready',
          channel: page.channel,
          items: page.items,
          fetchedAt: page.fetchedAt,
          stale: page.stale,
          empty: page.empty,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || seqRef.current !== seq) return
        setState({
          status: 'error',
          channel: topic === '' ? 'hot' : 'topic',
          items: [],
          fetchedAt: undefined,
          stale: false,
          empty: false,
          error: error instanceof Error && error.message ? error.message : '暂时不可用。',
        })
      })
    return () => controller.abort()
  }, [enabled, refreshKey, topic, scope, type])

  return state
}

/** 首页问答：一次一个问题，重复提交同一问题时丢弃过期响应。 */
export function useHomeAnswer(): {
  state: HomeAnswerState
  ask: (question: string, tier: 'fast' | 'thinking') => void
  reset: () => void
} {
  const [state, setState] = useState<HomeAnswerState>({ status: 'idle' })
  const seqRef = useRef(0)

  const ask = useCallback((question: string, tier: 'fast' | 'thinking') => {
    const trimmed = question.trim()
    if (trimmed === '') return
    const seq = seqRef.current + 1
    seqRef.current = seq
    setState({ status: 'loading' })
    fetch('/api/home/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: trimmed, tier }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response))
        return (await response.json()) as HomeAnswer
      })
      .then((answer) => {
        if (seqRef.current !== seq) return
        setState({ status: 'ready', answer })
      })
      .catch((error: unknown) => {
        if (seqRef.current !== seq) return
        setState({
          status: 'error',
          error: error instanceof Error && error.message ? error.message : '暂时不可用。',
        })
      })
  }, [])

  const reset = useCallback(() => {
    seqRef.current += 1
    setState({ status: 'idle' })
  }, [])

  return { state, ask, reset }
}
