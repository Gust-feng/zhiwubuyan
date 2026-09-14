import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJsonCached, readCachedJson } from './json-cache'

export interface CoreFeed<T> {
  readonly status: 'loading' | 'ready' | 'error'
  readonly items: readonly T[]
  readonly fetchedAt?: string
  readonly error?: string
  readonly retry: () => void
}

export interface CoreFeedPage<T> {
  readonly items: readonly T[]
  readonly fetchedAt?: string
}

/**
 * 首帧取上一份结果时允许的缓存年龄。
 * 比请求侧的 30 秒 TTL 长得多：它的唯一用途是**给首帧一个初值**，把「切换视图先闪一次加载」压掉；
 * 数据本身仍按 30 秒 TTL 在后台重新取，列表也照旧显示实际获取时间，不假装是刚取到的。
 */
const INITIAL_REUSE_TTL_MS = 5 * 60 * 1000

/**
 * 单个内容面的取数：加载、空、失败、重试共用一组状态，过期响应直接丢弃。
 *
 * `cacheKey` 提供时结果进进程内短时缓存：视图切换会卸载再挂载本组件，
 * 有缓存就拿它当**首帧初值**，不再闪一次 loading；随后按 TTL 决定要不要在后台重新取，
 * 重新取期间界面保留已有内容，不退回骨架。
 */
export function useCoreFeedLoader<T>(
  loadPage: (signal: AbortSignal) => Promise<CoreFeedPage<T>>,
  cacheKey?: string,
): CoreFeed<T> {
  // 初值直接查缓存：命中就是 ready，界面不会先空一下再填。
  const [state, setState] = useState<CoreFeed<T>>(() => {
    const cached = cacheKey === undefined
      ? undefined
      : readCachedJson<CoreFeedPage<T>>(cacheKey, INITIAL_REUSE_TTL_MS)
    if (cached === undefined) return { status: 'loading', items: [], retry: () => {} }
    return { status: 'ready', items: cached.items, fetchedAt: cached.fetchedAt, retry: () => {} }
  })
  const requestSeqRef = useRef(0)
  const forceRef = useRef(false)

  const load = useCallback((force = false) => {
    const seq = requestSeqRef.current + 1
    requestSeqRef.current = seq
    const controller = new AbortController()
    if (force) forceRef.current = true
    // 已经有内容就留在界面上：刷新在后台完成，不回到骨架，也就不会有那一次闪。
    setState((previous) => previous.status === 'ready'
      ? { ...previous, retry: () => load(true) }
      : { ...previous, status: 'loading', error: undefined, retry: () => load(true) })
    const request = cacheKey === undefined
      ? loadPage(controller.signal)
      : fetchJsonCached(cacheKey, () => loadPage(controller.signal), { force })
    request
      .then((page) => {
        if (requestSeqRef.current !== seq) return
        setState({ status: 'ready', items: page.items, fetchedAt: page.fetchedAt, retry: () => load(true) })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestSeqRef.current !== seq) return
        setState({
          status: 'error',
          items: [],
          error: error instanceof Error && error.message ? error.message : '暂时不可用。',
          retry: () => load(true),
        })
      })
    return () => controller.abort()
  }, [loadPage, cacheKey])

  useEffect(() => {
    return load(forceRef.current)
  }, [load])

  return state
}

/** 知乎上游接口的响应体形状不固定，由读取器投影成条目。 */
export function useCoreFeed<T>(
  path: string,
  readItems: (body: Record<string, unknown>) => readonly T[],
): CoreFeed<T> {
  const loadPage = useCallback(async (signal: AbortSignal): Promise<CoreFeedPage<T>> => {
    const response = await fetch(path, { signal })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null
      throw new Error(body?.message ?? `请求失败（${response.status}）。`)
    }
    const body = (await response.json()) as unknown
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return { items: [] }
    const record = body as Record<string, unknown>
    return {
      items: readItems(record),
      fetchedAt: typeof record.fetchedAt === 'string' ? record.fetchedAt : undefined,
    }
  }, [path, readItems])

  // 按路径缓存：视图切换重挂载时直接用上一份结果，不再闪 loading。
  return useCoreFeedLoader(loadPage, path)
}

export function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

export function readNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
