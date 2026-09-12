import { useCallback, useEffect, useRef, useState } from 'react'

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

/** 单个内容面的取数：加载、空、失败、重试共用一组状态，过期响应直接丢弃。 */
export function useCoreFeedLoader<T>(loadPage: (signal: AbortSignal) => Promise<CoreFeedPage<T>>): CoreFeed<T> {
  const [state, setState] = useState<CoreFeed<T>>({
    status: 'loading',
    items: [],
    retry: () => {},
  })
  const requestSeqRef = useRef(0)

  const load = useCallback(() => {
    const seq = requestSeqRef.current + 1
    requestSeqRef.current = seq
    const controller = new AbortController()
    setState((previous) => ({
      ...previous,
      status: 'loading',
      error: undefined,
      retry: load,
    }))
    loadPage(controller.signal)
      .then((page) => {
        if (requestSeqRef.current !== seq) return
        setState({ status: 'ready', items: page.items, fetchedAt: page.fetchedAt, retry: load })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestSeqRef.current !== seq) return
        setState({
          status: 'error',
          items: [],
          error: error instanceof Error && error.message ? error.message : '暂时不可用。',
          retry: load,
        })
      })
    return () => controller.abort()
  }, [loadPage])

  useEffect(() => load(), [load])

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

  return useCoreFeedLoader(loadPage)
}

export function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

export function readNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
