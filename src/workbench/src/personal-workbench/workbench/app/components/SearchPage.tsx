import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, FileText, Globe, NotebookPen, ArrowRight, X, AlertCircle, LoaderCircle } from 'lucide-react'
import { beginRemoteSearch, completeRemoteSearch, failRemoteSearch, type RemoteSearchState } from '../../../../workbench/search-state'
import type { ConversationSummary } from '@ui/contracts/conversation'
import { GUTTER, READING_WIDTH, composerSurface } from './tokens'
import { useNotes } from './notesStore'
import { searchPersonalKnowledge, type PersonalKnowledgeSearchHit } from './personalKnowledgeClient'

/**
 * 全局检索 —— 覆盖「我写的笔记」、读进来的材料和对话。
 *
 * 当前索引由 SQLite 投影的真实笔记和会话组成；后续若引入服务端
 * 检索，本组件只保留结果的呈现与筛选。
 */

type ResultType = 'note' | 'file' | 'web' | 'conversation'
type FilterType = 'all' | ResultType

interface SearchResult {
  id: string
  name: string
  type: ResultType
  area: string
  snippet: string
  /** 搜索命中所用的全文(标题+正文),不展示。 */
  haystack: string
  conversationId?: string
}

/** 从一段正文里,围绕命中词截取一小段摘要。 */
function makeSnippet(text: string, query: string, fallback = ''): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return fallback
  const q = query.trim().toLowerCase()
  if (q) {
    const idx = flat.toLowerCase().indexOf(q)
    if (idx >= 0) {
      const start = Math.max(0, idx - 30)
      return (start > 0 ? '…' : '') + flat.slice(start, start + 90) + '…'
    }
  }
  return flat.slice(0, 90) + (flat.length > 90 ? '…' : '')
}

const FILTER_LABELS: { key: FilterType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'note', label: '笔记' },
  { key: 'file', label: '材料' },
  { key: 'web', label: '网页' },
  { key: 'conversation', label: '对话' },
]

function resultIcon(type: ResultType) {
  switch (type) {
    case 'note':
      return <NotebookPen size={14} style={{ color: '#6f8778' }} />
    case 'file':
      return <FileText size={14} style={{ color: '#6A90B0' }} />
    case 'web':
      return <Globe size={14} style={{ color: '#4A8A6A' }} />
    case 'conversation':
      return null
  }
}

function typeLabel(type: ResultType) {
  switch (type) {
    case 'note': return '笔记'
    case 'file': return '材料'
    case 'web': return '网页'
    case 'conversation': return '对话'
  }
}

interface SearchPageProps {
  conversations: readonly ConversationSummary[]
  onOpenNote: (id: string) => void
  /** 打开对话后由宿主按其固定 owner 进入对应表面。 */
  onOpenConversation: (conversationId: string) => boolean | Promise<boolean>
}

const searchMemory: { query: string; filter: FilterType } = { query: '', filter: 'all' }

export function SearchPage({ onOpenNote, onOpenConversation, conversations }: SearchPageProps) {
  const { notes } = useNotes()
  const [query, setQuery] = useState(searchMemory.query)
  const [debouncedQuery, setDebouncedQuery] = useState(searchMemory.query)
  const [filter, setFilter] = useState<FilterType>(searchMemory.filter)
  const [remoteNotesState, setRemoteNotesState] = useState<RemoteSearchState<PersonalKnowledgeSearchHit>>({ status: 'idle' })
  const [remoteSearchAttempt, setRemoteSearchAttempt] = useState(0)
  const [openingResultId, setOpeningResultId] = useState<string | null>(null)
  const [openingError, setOpeningError] = useState<string | undefined>()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { searchMemory.query = query }, [query])
  useEffect(() => {
    const normalized = debouncedQuery.trim()
    if (!normalized) {
      setRemoteNotesState({ status: 'idle' })
      return undefined
    }
    setRemoteNotesState((current) => beginRemoteSearch(current))
    const abortController = new AbortController()
    void searchPersonalKnowledge(normalized, 50, abortController.signal).then(
      (results) => setRemoteNotesState(completeRemoteSearch(results)),
      (error: unknown) => {
        if (!isAbortError(error)) {
          setRemoteNotesState((current) => failRemoteSearch(current, error instanceof Error ? error.message : '搜索笔记失败。'))
        }
      },
    )
    return () => abortController.abort()
  }, [debouncedQuery, remoteSearchAttempt])

  const remoteSearchPending = remoteNotesState.status === 'loading'
  const remoteSearchError = remoteNotesState.status === 'error' ? remoteNotesState.message : undefined
  // 构建索引:笔记 + 材料 + 对话。debouncedQuery 变化时重算摘要。
  const index = useMemo<SearchResult[]>(() => {
    const noteResults: SearchResult[] = remoteNotesState.status === 'ready'
      ? remoteNotesState.results.map(({ note, snippet }) => ({
          id: note.id,
          name: note.title || '无标题',
          type: 'note',
          area: '我的知乎',
          snippet: snippet || '(空笔记)',
          haystack: `${note.title} ${debouncedQuery}`,
        }))
      : notes.map((n) => ({
          id: n.id,
          name: n.title || '无标题',
          type: 'note',
          area: '我的知乎',
          snippet: makeSnippet(n.bodyMarkdown, debouncedQuery, '(空笔记)'),
          haystack: `${n.title} ${n.bodyMarkdown}`,
        }))
    const conversationResults: SearchResult[] = conversations
      .map((conversation) => ({
        id: conversation.conversationId,
        name: conversation.title,
        type: 'conversation',
        area: '对话',
        snippet: makeSnippet(conversation.preview ?? '', debouncedQuery, conversation.status ?? '对话'),
        haystack: `${conversation.title} ${conversation.preview ?? ''}`,
        conversationId: conversation.conversationId,
      }))
    return [...noteResults, ...conversationResults]
  }, [conversations, debouncedQuery, notes, remoteNotesState])

  const filtered = useMemo(
    () =>
      index.filter((r) => {
        const matchesType = filter === 'all' || r.type === filter
        const q = debouncedQuery.trim().toLowerCase()
        const matchesQuery = !q || r.haystack.toLowerCase().includes(q)
        return matchesType && matchesQuery
      }),
    [index, debouncedQuery, filter]
  )

  const counts = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    const hits = index.filter((r) => !q || r.haystack.toLowerCase().includes(q))
    return {
      all: hits.length,
      note: hits.filter((r) => r.type === 'note').length,
      file: hits.filter((r) => r.type === 'file').length,
      web: hits.filter((r) => r.type === 'web').length,
      conversation: hits.filter((r) => r.type === 'conversation').length,
    } as Record<FilterType, number>
  }, [index, debouncedQuery])

  async function handleResultClick(result: SearchResult) {
    if (openingResultId !== null) return
    setOpeningError(undefined)
    setOpeningResultId(result.id)
    try {
      if (result.conversationId !== undefined) {
        const opened = await onOpenConversation(result.conversationId)
        if (opened === false) throw new Error('无法打开这条对话。')
      } else if (result.type === 'note') {
        onOpenNote(result.id)
      }
    } catch (error: unknown) {
      setOpeningError(error instanceof Error ? error.message : '打开结果失败，请重试。')
    } finally {
      setOpeningResultId(null)
    }
  }
  return (
    <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="mx-auto pt-8 pb-16" style={{ maxWidth: READING_WIDTH, paddingLeft: GUTTER, paddingRight: GUTTER }}>
          {/* 搜索框 */}
          <div className="flex items-center gap-3 px-4 py-3 mb-5" style={composerSurface(true)}>
            <Search size={15} style={{ color: 'var(--ui-text-3)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索笔记、材料和对话"
              placeholder="搜索笔记、材料、对话…"
              spellCheck={false}
              className="flex-1 rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent)]"
              style={{ color: 'var(--ui-text-1)', background: 'transparent' }}
            />
            {query && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setQuery('')}
                className="p-0.5 rounded shrink-0 transition-colors hover:bg-[var(--ui-hover-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent)]"
                style={{ color: 'var(--ui-text-3)' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* 类型筛选 */}
          <div className="flex items-center gap-1.5 mb-5">
            {FILTER_LABELS.map(({ key, label }) => {
              const active = filter === key
              return (
                <button
                  type="button"
                  key={key}
                  aria-pressed={active}
                  onClick={() => setFilter(key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent)]"
                  style={{
                    background: active ? 'var(--ui-accent-bg)' : 'var(--ui-surface-hover)',
                    color: active ? 'var(--ui-accent)' : 'var(--ui-text-2)',
                    border: active ? '1px solid color-mix(in srgb, var(--ui-accent) 25%, transparent)' : '1px solid transparent',
                  }}
                >
                  {label}
                  <span
                    className="rounded px-1 text-[10px]"
                    style={{
                      background: active ? 'var(--ui-accent-bg)' : 'var(--ui-hover-tint)',
                      color: active ? 'var(--ui-accent)' : 'var(--ui-text-3)',
                    }}
                  >
                    {counts[key]}
                  </span>
                </button>
              )
            })}
          </div>

          {/* 结果计数 */}
          <p className="text-xs mb-4" style={{ color: 'var(--ui-text-3)' }}>
            {debouncedQuery.trim() ? `找到 ${filtered.length} 条结果` : `共 ${filtered.length} 个项目`}
          </p>

          {remoteSearchPending && debouncedQuery.trim() && (
            <div className="mb-3 flex items-center gap-2 text-xs" style={{ color: 'var(--ui-text-3)' }} role="status">
              <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
              正在更新笔记结果…
            </div>
          )}
          {remoteSearchError !== undefined && (
            <div className="mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs" style={{ background: 'var(--ui-amber)', color: 'var(--ui-warn-text)' }} role="alert">
              <AlertCircle size={13} aria-hidden="true" />
              <span className="min-w-0 flex-1">{remoteSearchError}</span>
              <button type="button" className="font-medium underline underline-offset-2" onClick={() => setRemoteSearchAttempt((value) => value + 1)}>重试</button>
            </div>
          )}
          {openingError !== undefined && (
            <div className="mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs" style={{ background: 'var(--ui-amber)', color: 'var(--ui-warn-text)' }} role="alert">
              <AlertCircle size={13} aria-hidden="true" />
              <span className="min-w-0 flex-1">{openingError}</span>
            </div>
          )}

          {/* 结果列表 */}
          <div className="space-y-0.5">
            {filtered.map((result) => (
              <button
                key={result.id}
                type="button"
                disabled={openingResultId !== null}
                aria-busy={openingResultId === result.id}
                className="w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent)] disabled:cursor-wait disabled:opacity-70"
                style={{ background: hoveredId === result.id ? 'var(--ui-surface-hover)' : 'transparent' }}
                onMouseEnter={() => setHoveredId(result.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => void handleResultClick(result)}
              >
                <div className="mt-0.5 shrink-0">{openingResultId === result.id ? <LoaderCircle size={14} className="animate-spin" aria-label="正在打开" /> : resultIcon(result.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-medium" style={{ color: 'var(--ui-text-1)' }}>
                      {result.name}
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: 'rgba(45,40,34,0.05)', color: 'var(--ui-text-3)' }}
                    >
                      {typeLabel(result.type)}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--ui-text-3)', lineHeight: 1.65 }}>
                    {result.snippet}
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--ui-text-3)' }}>{result.area}</p>
                </div>
                <div
                  className="mt-0.5 shrink-0 transition-opacity"
                  style={{ opacity: hoveredId === result.id ? 1 : 0, color: 'var(--ui-text-3)' }}
                >
                  <ArrowRight size={13} />
                </div>
              </button>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm mb-1" style={{ color: 'var(--ui-text-2)' }}>
                没有找到匹配的内容
              </p>
              <p className="text-xs" style={{ color: 'var(--ui-text-3)' }}>
                试试其他关键词,或切换到「全部」类型
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}
