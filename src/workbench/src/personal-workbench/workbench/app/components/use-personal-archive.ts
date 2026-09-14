import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 个人档案（`/api/user/archive`）的取数。
 *
 * 与 `useCoreFeed` 的差别：档案一次返回多个组装视图，不是单一列表，因此单独解析响应形状。
 * 档案在服务端按用户做 TTL 与并发合并，这里只负责加载、失败与重试，不在前端做第二次缓存。
 */

export interface ArchiveProfile {
  readonly fullname: string
  readonly avatarUrl?: string
  readonly headline?: string
}

export interface ArchiveTruncation {
  readonly creations: boolean
  readonly followees: boolean
  readonly favlistContents: boolean
}

export interface ArchiveClusterItem {
  readonly title: string
  readonly url: string
  readonly kind: 'creation' | 'collection'
  readonly contentType?: string
}

export interface ArchiveQuestionCluster {
  readonly questionId: string
  readonly questionUrl: string
  readonly creationCount: number
  readonly collectionCount: number
  readonly total: number
  readonly items: readonly ArchiveClusterItem[]
}

export interface ArchiveDayBucket {
  readonly date: string
  readonly count: number
  readonly byType: Readonly<Record<string, number>>
}

export interface ArchiveCreationYear {
  readonly buckets: readonly ArchiveDayBucket[]
  readonly total: number
  readonly activeDays: number
  readonly streakDays: number
  readonly longestStreak: number
  readonly firstDate?: string
  readonly lastDate?: string
  readonly windowStart?: string
  readonly windowWeekday?: number
}

export type ArchiveResponseLabel = 'discussion' | 'reference' | 'approval'

export interface ArchiveResponseItem {
  readonly title: string
  readonly url: string
  readonly likeCount: number
  readonly commentCount: number
  readonly favoriteCount: number
  readonly label?: ArchiveResponseLabel
}

export interface ArchiveCollectionEntry {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly contentType?: string
  readonly favTime?: string
}

export interface ArchiveCollectionTimeline {
  readonly buckets: readonly { readonly period: string; readonly count: number; readonly items: readonly ArchiveCollectionEntry[] }[]
  readonly total: number
  readonly dormant: readonly ArchiveCollectionEntry[]
}

export interface ArchiveFolloweeTier {
  readonly tier: 'large' | 'peer' | 'niche'
  readonly count: number
  readonly items: readonly { readonly name: string; readonly url: string; readonly headline: string; readonly followerCount?: number; readonly avatarUrl?: string }[]
}

export interface ArchiveHeadlineKeyword {
  readonly keyword: string
  readonly count: number
  readonly sampleNames: readonly string[]
}

export interface ArchiveViews {
  readonly questionClusters: readonly ArchiveQuestionCluster[]
  readonly creationYear: ArchiveCreationYear
  readonly responseStructure: readonly ArchiveResponseItem[]
  readonly collectionTimeline: ArchiveCollectionTimeline
  readonly followeeTiers: readonly ArchiveFolloweeTier[]
  readonly headlineKeywords: readonly ArchiveHeadlineKeyword[]
}

export interface ArchiveCounts {
  readonly creations: number
  readonly followees: number
  readonly favlists: number
  readonly collections: number
}

export interface PersonalArchive {
  readonly syncedAt: string
  /** false 表示本次档案只活在会话内（后端未能解析出稳定身份），界面须如实说明。 */
  readonly persistent: boolean
  /** true 表示上游本次不可用，展示的是上一份快照，界面须标明不是刚同步的。 */
  readonly stale: boolean
  readonly truncated: ArchiveTruncation
  readonly profile?: ArchiveProfile
  readonly counts: ArchiveCounts
  readonly views: ArchiveViews
}

export interface ArchiveFeed {
  readonly status: 'loading' | 'ready' | 'error'
  readonly archive?: PersonalArchive
  readonly error?: string
  readonly retry: () => void
  /** 重新向服务端发起同步（跳过服务端 TTL 缓存），用于用户主动刷新。 */
  readonly refresh: () => void
}

/**
 * `enabled` 为 false 时不发起任何请求：档案同步会翻页取全创作/关注/收藏，
 * 不该在用户只是打开「我的知乎」看笔记时就消耗额度。
 */
export function usePersonalArchive(enabled = true): ArchiveFeed {
  const [state, setState] = useState<ArchiveFeed>({ status: 'loading', retry: () => {}, refresh: () => {} })
  const requestSeqRef = useRef(0)

  const start = useCallback((force: boolean) => {
    const seq = requestSeqRef.current + 1
    requestSeqRef.current = seq
    const controller = new AbortController()
    setState((previous) => ({ ...previous, status: 'loading', error: undefined, retry: () => start(false), refresh: () => start(true) }))
    const path = force ? '/api/user/archive?refresh=1' : '/api/user/archive'
    fetch(path, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        if (!response.ok) throw new Error(body?.message ?? `请求失败（${response.status}）。`)
        return readArchive(body)
      })
      .then((archive) => {
        if (requestSeqRef.current !== seq) return
        if (archive === undefined) {
          setState({ status: 'error', error: '档案响应格式无法识别。', retry: () => start(false), refresh: () => start(true) })
          return
        }
        setState({ status: 'ready', archive, retry: () => start(false), refresh: () => start(true) })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestSeqRef.current !== seq) return
        setState({
          status: 'error',
          error: error instanceof Error && error.message ? error.message : '暂时不可用。',
          retry: () => start(false),
          refresh: () => start(true),
        })
      })
  }, [])

  useEffect(() => {
    if (!enabled) return
    return start(false)
  }, [enabled, start])

  return state
}

/** 响应缺字段时按空视图降级，而不是抛错——档案是只读展示，局部缺失不应让整页失败。 */
function readArchive(body: unknown): PersonalArchive | undefined {
  const record = asRecord(body)
  if (record === undefined) return undefined
  const syncedAt = readString(record.syncedAt)
  if (syncedAt === '') return undefined
  const views = asRecord(record.views)
  if (views === undefined) return undefined
  const counts = asRecord(record.counts)
  return {
    syncedAt,
    persistent: record.persistent === true,
    stale: record.stale === true,
    truncated: {
      creations: readRecordField(record.truncated, 'creations') === true,
      followees: readRecordField(record.truncated, 'followees') === true,
      favlistContents: readRecordField(record.truncated, 'favlistContents') === true,
    },
    profile: readProfile(record.profile),
    counts: {
      creations: readNumber(counts, 'creations'),
      followees: readNumber(counts, 'followees'),
      favlists: readNumber(counts, 'favlists'),
      collections: readNumber(counts, 'collections'),
    },
    views: {
      questionClusters: readArray(views.questionClusters, readCluster),
      creationYear: readCreationYear(views.creationYear),
      responseStructure: readArray(views.responseStructure, readResponseItem),
      collectionTimeline: readCollectionTimeline(views.collectionTimeline),
      followeeTiers: readArray(views.followeeTiers, readTier),
      headlineKeywords: readArray(views.headlineKeywords, readKeyword),
    },
  }
}

function readCluster(record: Record<string, unknown>): ArchiveQuestionCluster | undefined {
  const questionId = readString(record.questionId)
  const questionUrl = readString(record.questionUrl)
  if (questionId === '' || questionUrl === '') return undefined
  return {
    questionId,
    questionUrl,
    creationCount: readNumber(record, 'creationCount'),
    collectionCount: readNumber(record, 'collectionCount'),
    total: readNumber(record, 'total'),
    items: readArray(record.items, readClusterItem),
  }
}

function readClusterItem(record: Record<string, unknown>): ArchiveClusterItem | undefined {
  const title = readString(record.title)
  const url = readString(record.url)
  const kind = record.kind === 'creation' || record.kind === 'collection' ? record.kind : undefined
  if (title === '' || url === '' || kind === undefined) return undefined
  return { title, url, kind, contentType: readOptional(record, 'contentType') }
}

function readCreationYear(value: unknown): ArchiveCreationYear {
  const record = asRecord(value) ?? {}
  const weekday = record.windowWeekday
  return {
    buckets: readArray(record.buckets, readDayBucket),
    total: readNumber(record, 'total'),
    activeDays: readNumber(record, 'activeDays'),
    streakDays: readNumber(record, 'streakDays'),
    longestStreak: readNumber(record, 'longestStreak'),
    firstDate: readOptional(record, 'firstDate'),
    lastDate: readOptional(record, 'lastDate'),
    windowStart: readOptional(record, 'windowStart'),
    windowWeekday: typeof weekday === 'number' && weekday >= 0 && weekday <= 6 ? weekday : undefined,
  }
}

function readDayBucket(record: Record<string, unknown>): ArchiveDayBucket | undefined {
  const date = readString(record.date)
  if (date === '') return undefined
  const byType = asRecord(record.byType) ?? {}
  const counts: Record<string, number> = {}
  for (const [key, value] of Object.entries(byType)) {
    if (typeof value === 'number' && Number.isFinite(value)) counts[key] = value
  }
  return { date, count: readNumber(record, 'count'), byType: counts }
}

function readResponseItem(record: Record<string, unknown>): ArchiveResponseItem | undefined {
  const title = readString(record.title)
  const url = readString(record.url)
  if (title === '' || url === '') return undefined
  return {
    title,
    url,
    likeCount: readNumber(record, 'likeCount'),
    commentCount: readNumber(record, 'commentCount'),
    favoriteCount: readNumber(record, 'favoriteCount'),
    label: record.label === 'discussion' || record.label === 'reference' || record.label === 'approval'
      ? record.label
      : undefined,
  }
}

function readCollectionTimeline(value: unknown): ArchiveCollectionTimeline {
  const record = asRecord(value) ?? {}
  return {
    buckets: readArray(record.buckets, (bucket) => {
      const period = readString(bucket.period)
      if (period === '') return undefined
      return { period, count: readNumber(bucket, 'count'), items: readArray(bucket.items, readCollectionEntry) }
    }),
    total: readNumber(record, 'total'),
    dormant: readArray(record.dormant, readCollectionEntry),
  }
}

function readCollectionEntry(record: Record<string, unknown>): ArchiveCollectionEntry | undefined {
  const id = readString(record.id)
  const title = readString(record.title)
  const url = readString(record.url)
  if (id === '' || title === '' || url === '') return undefined
  return { id, title, url, contentType: readOptional(record, 'contentType'), favTime: readOptional(record, 'favTime') }
}

function readTier(record: Record<string, unknown>): ArchiveFolloweeTier | undefined {
  const tier = record.tier
  if (tier !== 'large' && tier !== 'peer' && tier !== 'niche') return undefined
  return {
    tier,
    count: readNumber(record, 'count'),
    items: readArray(record.items, (item) => {
      const name = readString(item.name)
      const url = readString(item.url)
      if (name === '' || url === '') return undefined
      return {
        name,
        url,
        headline: readString(item.headline),
        followerCount: typeof item.followerCount === 'number' ? item.followerCount : undefined,
        avatarUrl: readOptional(item, 'avatarUrl'),
      }
    }),
  }
}

function readKeyword(record: Record<string, unknown>): ArchiveHeadlineKeyword | undefined {
  const keyword = readString(record.keyword)
  if (keyword === '') return undefined
  const names = Array.isArray(record.sampleNames)
    ? record.sampleNames.filter((name): name is string => typeof name === 'string' && name !== '')
    : []
  return { keyword, count: readNumber(record, 'count'), sampleNames: names }
}

function readProfile(value: unknown): ArchiveProfile | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const fullname = readString(record.fullname)
  if (fullname === '') return undefined
  return { fullname, avatarUrl: readOptional(record, 'avatarUrl'), headline: readOptional(record, 'headline') }
}

function readArray<T>(value: unknown, read: (item: Record<string, unknown>) => T | undefined): T[] {
  if (!Array.isArray(value)) return []
  const items: T[] = []
  for (const raw of value) {
    const record = asRecord(raw)
    if (record === undefined) continue
    const item = read(record)
    if (item !== undefined) items.push(item)
  }
  return items
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readOptional(record: Record<string, unknown>, key: string): string | undefined {
  const value = readString(record[key])
  return value === '' ? undefined : value
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readRecordField(record: unknown, key: string): unknown {
  return asRecord(record)?.[key]
}
