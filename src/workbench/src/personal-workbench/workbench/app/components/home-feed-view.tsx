import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, ExternalLink, Flame, Layers, Search, Sparkles } from 'lucide-react'
import { RichText } from '@ui/components/rich-text'
import type {
  HomeAnswerState,
  HomeFeedItem,
  HomeFeedScope,
  HomeFeedState,
  HomeFeedType,
} from './use-home-feed'
import './home-feed-view.css'

const TYPE_FILTERS: ReadonlyArray<{ key: HomeFeedType; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'answer', label: '回答' },
  { key: 'article', label: '文章' },
]

const CONTENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  answer: '回答',
  article: '文章',
  question: '问题',
  pin: '想法',
  zvideo: '视频',
}

export type HomeFeedViewProps = {
  readonly feed: HomeFeedState
  /** 当前生效的检索词；空字符串表示热榜频道。 */
  readonly topic: string
  /** 检索框里的草稿词。 */
  readonly draft: string
  readonly onDraftChange: (value: string) => void
  readonly scope: HomeFeedScope
  readonly onScopeChange: (scope: HomeFeedScope) => void
  readonly type: HomeFeedType
  readonly onTypeChange: (type: HomeFeedType) => void
  readonly onSubmitSearch: () => void
  readonly onRetry: () => void
  readonly onClearTopic: () => void
  /** 记入「今日想问」；缺省时不显示该动作。 */
  readonly onRemember?: (question: string) => void
}

/**
 * 首页内容流：热榜是默认种子，主题检索是用户主动发起。
 * 只呈现上游真实返回的标题、摘要、类型、作者与互动数；缺失字段留空，不用占位内容补齐。
 */
export function HomeFeedView(props: HomeFeedViewProps) {
  const { feed } = props
  const topicActive = props.topic !== ''
  return (
    <section className="uhf" aria-label={topicActive ? '主题检索' : '知乎热榜'}>
      <div className="uhf__head">
        <span className={topicActive ? 'uhf__glyph' : 'uhf__glyph is-hot'} aria-hidden>
          {topicActive ? <Layers size={15} /> : <Flame size={15} />}
        </span>
        <h2 className="uhf__name">{topicActive ? '主题检索' : '知乎热榜'}</h2>
        <span className="uhf__role">{topicActive ? '按你的检索词' : '正在讨论'}</span>
        {topicActive && (
          <div className="uhf__filters" role="group" aria-label="内容类型">
            {TYPE_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className={props.type === filter.key ? 'uhf__filter is-active' : 'uhf__filter'}
                aria-pressed={props.type === filter.key}
                onClick={() => props.onTypeChange(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        )}
        <FeedTime feed={feed} />
      </div>

      {topicActive && (
        <div className="uhf__topic">
          <span className="uhf__topic-text">正在检索「{props.topic}」</span>
          <button type="button" className="uhf__topic-clear" onClick={props.onClearTopic}>返回热榜</button>
        </div>
      )}

      {feed.status === 'loading' && (
        <div className="uhf__skeleton" aria-label="正在获取内容">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="uhf__skeleton-row" />)}
        </div>
      )}

      {feed.status === 'error' && (
        <div className="uhf__notice" role="alert">
          <p>{feed.error}</p>
          <button type="button" onClick={props.onRetry}>重试</button>
        </div>
      )}

      {feed.status === 'ready' && feed.empty && (
        <div className="uhf__notice">
          <p>{topicActive ? '没有找到匹配的内容，换个说法或放宽筛选试试。' : '热榜暂时没有内容。'}</p>
          {topicActive && <button type="button" onClick={props.onClearTopic}>返回热榜</button>}
        </div>
      )}

      {feed.status === 'ready' && feed.items.length > 0 && (
        <ol className="uhf__list">
          {feed.items.map((item) => <li key={item.id}><FeedCard item={item} onRemember={props.onRemember} /></li>)}
        </ol>
      )}
    </section>
  )
}

/** 热榜没有新增条数或热度值，界面只用真实时间说话，不用「暴涨/爆了」这类编造。 */
function FeedTime({ feed }: { readonly feed: HomeFeedState }) {
  if (feed.status !== 'ready' || feed.fetchedAt === undefined) return null
  const time = new Date(feed.fetchedAt)
  if (Number.isNaN(time.getTime())) return null
  const label = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  if (feed.stale) {
    return <span className="uhf__time uhf__time--stale">上游暂不可用，显示 {label} 获取的内容</span>
  }
  return <span className="uhf__time">{feed.channel === 'hot' ? `${label} 获取` : `检索于 ${label}`}</span>
}

function FeedCard({ item, onRemember }: { readonly item: HomeFeedItem; readonly onRemember?: (question: string) => void }) {
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
            {onRemember !== undefined && (
              <button type="button" className="uhf__ghost" onClick={() => onRemember(item.title)}>记下</button>
            )}
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
  readonly onAsk: () => void
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
      <label className="uha__scope">
        <span className="uha-visually-hidden">检索范围</span>
        <select
          aria-label="检索范围"
          value={props.scope}
          onChange={(event) => props.onScopeChange(event.target.value === 'web' ? 'web' : 'zhihu')}
        >
          <option value="zhihu">仅知乎</option>
          <option value="web">补充全网</option>
        </select>
      </label>
      <button type="submit" className="uha__submit">搜内容</button>
      <button type="button" className="uha__ask" onClick={props.onAsk}>
        <Sparkles size={13} aria-hidden />
        问直答
      </button>
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
 * 首页问答面板。正文是知乎直答生成内容、不附原始来源，
 * 因此固定标注这一点，并引导需要引用时转入众声或深度研究。
 */
export function HomeAnswerPanel(props: HomeAnswerPanelProps) {
  const { state } = props
  if (state.status === 'idle') return null
  const question = state.answer?.question ?? ''
  return (
    <section className="uha-panel" aria-label="知乎直答">
      <div className="uha-panel__head">
        <Sparkles size={15} className="uha-panel__glyph" aria-hidden />
        <h2 className="uha-panel__name">知乎直答</h2>
        <span className="uha-panel__role">快速答，不附原始来源</span>
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
          <p className="uha-panel__note">
            以上为知乎直答（{state.answer.model}）生成内容，未附原始来源；需要可核对的引用请转入众声或深度研究。
          </p>
          <div className="uha-panel__foot">
            <button type="button" className="uha__ask" onClick={props.onExplore}>
              看不同立场
              <ArrowRight size={13} aria-hidden />
            </button>
            {props.children}
          </div>
        </div>
      )}
    </section>
  )
}

/** 供页面复用的检索状态容器：把草稿与已提交的检索词分开，避免每次输入都重新取数。 */
export function useHomeSearchState(initialTopic = ''): {
  topic: string
  draft: string
  scope: HomeFeedScope
  type: HomeFeedType
  setDraft: (value: string) => void
  setScope: (scope: HomeFeedScope) => void
  setType: (type: HomeFeedType) => void
  submit: (draft: string) => void
  clear: () => void
} {
  const [topic, setTopic] = useState(initialTopic)
  const [draft, setDraft] = useState(initialTopic)
  const [scope, setScope] = useState<HomeFeedScope>('zhihu')
  const [type, setType] = useState<HomeFeedType>('all')
  return {
    topic,
    draft,
    scope,
    type,
    setDraft,
    setScope,
    setType,
    submit: (value) => {
      const next = value.trim()
      setDraft(next)
      setTopic(next)
    },
    clear: () => {
      setDraft('')
      setTopic('')
    },
  }
}
