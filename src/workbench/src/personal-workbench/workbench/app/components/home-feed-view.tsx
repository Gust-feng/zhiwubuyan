import { type FormEvent, type ReactNode } from 'react'
import { ArrowRight, ExternalLink, Search, Sparkles } from 'lucide-react'
import { RichText } from '@ui/components/rich-text'
import type {
  HomeAnswerState,
  HomeFeedItem,
  HomeFeedScope,
  HomeFeedState,
} from './use-home-feed'
import './home-feed-view.css'

const CONTENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  answer: '回答',
  article: '文章',
  question: '问题',
  pin: '想法',
  zvideo: '视频',
}

/** 检索范围取值与展示文案的单一来源：检索条分段控件与检索页上下文共用。 */
export const SCOPE_OPTIONS: ReadonlyArray<{ readonly key: HomeFeedScope; readonly label: string }> = [
  { key: 'zhihu', label: '仅知乎' },
  { key: 'web', label: '补充全网' },
]

export type SearchFeedListProps = {
  readonly feed: HomeFeedState
  readonly onRetry: () => void
}

/**
 * 检索结果列表：只呈现上游真实返回的标题、摘要、类型、作者与互动数；缺失字段留空，不用占位内容补齐。
 */
export function SearchFeedList({ feed, onRetry }: SearchFeedListProps) {
  return (
    <div className="uhf">
      {feed.status === 'loading' && (
        <div className="uhf__skeleton" aria-label="正在获取内容">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="uhf__skeleton-row" />)}
        </div>
      )}

      {feed.status === 'error' && (
        <div className="uhf__notice" role="alert">
          <p>{feed.error}</p>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      )}

      {feed.status === 'ready' && feed.empty && (
        <div className="uhf__notice">
          <p>没有找到匹配的内容，换个说法或放宽筛选试试。</p>
        </div>
      )}

      {feed.status === 'ready' && feed.items.length > 0 && (
        <ol className="uhf__list">
          {feed.items.map((item) => <li key={item.id}><FeedCard item={item} /></li>)}
        </ol>
      )}
    </div>
  )
}

/** 检索没有新增条数或热度值，界面只用真实时间说话；上游不可用时如实标注显示的是旧内容。 */
export function FeedTime({ feed }: { readonly feed: HomeFeedState }) {
  if (feed.status !== 'ready' || feed.fetchedAt === undefined) return null
  const time = new Date(feed.fetchedAt)
  if (Number.isNaN(time.getTime())) return null
  const label = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  if (feed.stale) {
    return <span className="uhf__time uhf__time--stale">上游暂不可用，显示 {label} 获取的内容</span>
  }
  return <span className="uhf__time">检索于 {label}</span>
}

export function FeedCard({ item }: { readonly item: HomeFeedItem }) {
  const typeLabel = CONTENT_TYPE_LABELS[(item.contentType ?? '').toLowerCase()] ?? item.contentType
  const meta = formatMeta(item)
  return (
    <article className="uhf__card">
      <div className="uhf__card-body">
        <a className="uhf__card-title" href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
        {item.summary !== '' && <p className="uhf__summary">{item.summary}</p>}
        <div className="uhf__card-foot">
          <span className="uhf__byline">
            {typeLabel !== undefined && <span className="uhf__type">{typeLabel}</span>}
            {item.authorName !== undefined && <span className="uhf__author">{item.authorName}</span>}
            {item.authorBadgeText !== undefined && <span className="uhf__badge">{item.authorBadgeText}</span>}
            {meta !== '' && <span className="uhf__stat">{meta}</span>}
          </span>
          <span className="uhf__card-actions">
            {item.url !== '' && (
              <a className="uhf__open" href={item.url} target="_blank" rel="noreferrer">
                阅读原文
                <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </span>
        </div>
      </div>
      {item.thumbnailUrl !== undefined && (
        <img className="uhf__thumb" src={item.thumbnailUrl} alt="" loading="lazy" />
      )}
    </article>
  )
}

/** 只展示真实存在的数字；没有互动数据的上游（如问题回答）不显示这一行。 */
function formatMeta(item: HomeFeedItem): string {
  const parts: string[] = []
  if (item.voteCount !== undefined) parts.push(`${formatCount(item.voteCount)} 赞同`)
  if (item.commentCount !== undefined) parts.push(`${formatCount(item.commentCount)} 评论`)
  return parts.join(' · ')
}

function formatCount(count: number): string {
  if (count >= 10000) {
    const value = (count / 10000).toFixed(1)
    return `${value.endsWith('.0') ? value.slice(0, -2) : value} 万`
  }
  return String(count)
}

export type HomeAskBarProps = {
  readonly draft: string
  readonly onDraftChange: (value: string) => void
  readonly scope: HomeFeedScope
  readonly onScopeChange: (scope: HomeFeedScope) => void
  readonly onSubmit: () => void
  /** 问直答通路；检索视图只检索内容，不传则不渲染该按钮。 */
  readonly onAsk?: () => void
}

/** 同一个输入框承载两条通路：检索知乎内容，或直接问知乎直答。 */
export function HomeAskBar(props: HomeAskBarProps) {
  function submit(event: FormEvent) {
    event.preventDefault()
    props.onSubmit()
  }
  return (
    <form className="uha" role="search" onSubmit={submit}>
      <Search size={15} className="uha__icon" aria-hidden />
      <input
        className="uha__input"
        type="search"
        placeholder="搜索知乎的问题、回答与文章"
        aria-label="搜索知乎内容"
        value={props.draft}
        onChange={(event) => props.onDraftChange(event.target.value)}
      />
      <div className="uha__scope" role="group" aria-label="检索范围">
        {SCOPE_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={props.scope === option.key ? 'uha__scope-option is-active' : 'uha__scope-option'}
            aria-pressed={props.scope === option.key}
            onClick={() => props.onScopeChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button type="submit" className="uha__submit">搜内容</button>
      {props.onAsk !== undefined && (
        <button type="button" className="uha__ask" onClick={props.onAsk}>
          <Sparkles size={13} aria-hidden />
          问直答
        </button>
      )}
    </form>
  )
}

export type HomeAnswerPanelProps = {
  readonly state: HomeAnswerState
  readonly tier: 'fast' | 'thinking'
  readonly onTierChange: (tier: 'fast' | 'thinking') => void
  readonly onClose: () => void
  readonly onRetry: () => void
  readonly onExplore: () => void
  readonly children?: ReactNode
}

/**
 * 首页问答面板。正文是知乎直答生成内容，界面只固定标注生成内容可能出错、
 * 重要信息需自行核对，并给出转入众声看不同说法的入口。
 */
export function HomeAnswerPanel(props: HomeAnswerPanelProps) {
  const { state } = props
  if (state.status === 'idle') return null
  return (
    <section className="uha-panel" aria-label="知乎直答">
      <div className="uha-panel__head">
        <Sparkles size={15} className="uha-panel__glyph" aria-hidden />
        <h2 className="uha-panel__name">知乎直答</h2>
        <span className="uha-panel__role">直答生成，未附原始来源</span>
        <div className="uha-panel__tiers" role="group" aria-label="回答档位">
          {(['fast', 'thinking'] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              className={props.tier === tier ? 'uha-panel__tier is-active' : 'uha-panel__tier'}
              aria-pressed={props.tier === tier}
              onClick={() => props.onTierChange(tier)}
            >
              {tier === 'fast' ? '快速' : '深度思考'}
            </button>
          ))}
        </div>
        <button type="button" className="uha-panel__close" onClick={props.onClose}>收起</button>
      </div>

      {state.status === 'loading' && (
        <div className="uha-panel__loading" aria-label="正在生成回答">
          <span /><span /><span />
        </div>
      )}

      {state.status === 'error' && (
        <div className="uhf__notice" role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={props.onRetry}>重试</button>
        </div>
      )}

      {state.status === 'ready' && state.answer !== undefined && (
        <div className="uha-panel__body">
          <p className="uha-panel__question">{state.answer.question}</p>
          <div className="uha-panel__answer">
            <RichText text={state.answer.content} />
          </div>
          <p className="uha-panel__note">知无不言也可能会犯错，请核查重要信息。</p>
          <div className="uha-panel__foot">
            <button type="button" className="uha__ask" onClick={props.onExplore}>
              众声
              <ArrowRight size={13} aria-hidden />
            </button>
            {props.children}
          </div>
        </div>
      )}
    </section>
  )
}
