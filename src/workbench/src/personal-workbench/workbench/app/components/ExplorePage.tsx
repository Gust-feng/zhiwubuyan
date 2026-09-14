import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Flame } from 'lucide-react'
import { FeedCard } from './home-feed-view'
import { formatCount, HotRow } from './home-feeds'
import { useHomeFeed, type HomeFeedItem, type HomeFeedState } from './use-home-feed'
import './explore-page.css'
import './workbench-views.css'

/** 热榜只在本页读取一次，主议题、讨论列表与 Top 5 都由同一份结果切片。 */
export function ExplorePage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const feed = useHomeFeed({ refreshKey })
  const retry = (): void => setRefreshKey((current) => current + 1)
  // 内容换了就要重新量一次：主议题的标题行数会改变主区可用高度。
  const revision = `${feed.status}:${feed.items.length}:${feed.items[0]?.id ?? ''}`
  const { counts, mainRef, asideRef } = useOneScreenCounts(revision)

  return (
    <div className="ui-view ui-explore">
      <div className="ui-view__frame ui-explore__frame">
        <header className="ui-explore__header">
          <h1>发现</h1>
          <div className="ui-explore__context">
            <p>今天大家在讨论什么，挑一条追问下去。</p>
          </div>
        </header>

        <div className="ui-explore__layout">
          <main className="ui-explore__main" ref={mainRef}>
            <FeatureIssue feed={feed} onRetry={retry} />
            <DiscussionList feed={feed} onRetry={retry} limit={counts.discussion} />
          </main>
          <aside className="ui-explore__aside" aria-label="探索侧栏" ref={asideRef}>
            <HotRanking feed={feed} onRetry={retry} limit={counts.hot} />
          </aside>
        </div>
      </div>
    </div>
  )
}

/** 条数下限保证版面成立，上限避免大窗口把整份热榜一次铺完。 */
const DISCUSSION_MIN = 1
const DISCUSSION_MAX = 8
const HOT_MIN = 5
const HOT_MAX = 20

/**
 * 发现页是一屏版面：两栏都不滚动，可显示的条数按容器实际高度算——窗口大就多显示，窗口小就少显示。
 * 参与计算的量都与已显示条数无关（容器高、单行高、列表起点），所以结果一次收敛，不会来回重排。
 */
function useOneScreenCounts(revision: string): {
  readonly counts: { readonly discussion: number; readonly hot: number }
  readonly mainRef: RefObject<HTMLElement | null>
  readonly asideRef: RefObject<HTMLElement | null>
} {
  const mainRef = useRef<HTMLElement | null>(null)
  const asideRef = useRef<HTMLElement | null>(null)
  // 先按下限起步，量完再放开：宁可先少显示两条，也不要先撑破再回缩。
  const [counts, setCounts] = useState({ discussion: DISCUSSION_MIN, hot: HOT_MIN })

  useLayoutEffect(() => {
    const main = mainRef.current
    const aside = asideRef.current
    if (main === null || aside === null) return
    const measure = (): void => {
      // 单栏堆叠时整页本来就会滚动，这时给足条数比压缩条数有用。
      const stacked = aside.getBoundingClientRect().top > main.getBoundingClientRect().top + 1
      const next = stacked ? { discussion: DISCUSSION_MAX, hot: HOT_MAX } : {
        discussion: fitCount(main, '.ui-explore__discussion-list', '.ui-explore__discussion', DISCUSSION_MIN, DISCUSSION_MAX),
        hot: fitCount(aside, '.ui-explore__side-card .ui-home__core-list', '.ui-explore__side-card', HOT_MIN, HOT_MAX),
      }
      setCounts((previous) => (
        previous.discussion === next.discussion && previous.hot === next.hot ? previous : next
      ))
    }
    measure()
    // 窗口尺寸变化必须走 resize：部分环境下后台标签不派发 ResizeObserver 回调，只监听它会让条数停在首次测量值。
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(main)
    observer.observe(aside)
    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [revision])

  return { counts, mainRef, asideRef }
}

/**
 * 逐条累加真实行高，取放得下的最大条数。
 * 不能用「可用高度 ÷ 最高一条」折算：标题行数不同会导致高度不等，最高值会把结果压小，
 * 表现就是列表底部留出一片空白。尚未渲染的条目按已知最高值保守估计，宁可少一条也不溢出。
 */
function fitCount(
  container: HTMLElement,
  listSelector: string,
  sectionSelector: string,
  min: number,
  max: number,
): number {
  const list = container.querySelector<HTMLElement>(listSelector)
  if (list === null || list.children.length === 0) return min
  const heights = Array.from(list.children).map((row) => row.getBoundingClientRect().height)
  const tallest = Math.max(...heights)
  if (tallest <= 0) return min
  const section = list.closest(sectionSelector)
  const trailing = section === null ? 0 : Number.parseFloat(getComputedStyle(section).paddingBottom) || 0
  const available = container.clientHeight - (list.getBoundingClientRect().top - container.getBoundingClientRect().top) - trailing
  let used = 0
  let fits = 0
  while (fits < max) {
    const height = fits < heights.length ? heights[fits] : tallest
    if (used + height > available) break
    used += height
    fits += 1
  }
  return Math.min(max, Math.max(min, fits))
}

function FeatureIssue({ feed, onRetry }: { readonly feed: HomeFeedState; readonly onRetry: () => void }) {
  const item = feed.items[0]
  return (
    <section className="ui-explore__feature" aria-labelledby="explore-feature-title">
      <div className="ui-explore__section-head">
        <h2 id="explore-feature-title">今日主议题</h2>
      </div>

      {feed.status === 'loading' && <FeatureSkeleton />}
      {feed.status === 'error' && <ExploreNotice message={`热榜暂不可用：${feed.error ?? '暂时无法获取内容。'}`} onRetry={onRetry} />}
      {feed.status === 'ready' && item === undefined && <ExploreNotice message="热榜暂时没有内容。" />}
      {feed.status === 'ready' && item !== undefined && <FeatureCard item={item} />}
    </section>
  )
}

function FeatureCard({ item }: { readonly item: HomeFeedItem }) {
  // 标题本身就是入口：点击直接跳到知乎原文，不再另挂外链图标。
  const title = item.url === '' ? (
    <h3 className="ui-explore__feature-title">{item.title}</h3>
  ) : (
    <a className="ui-explore__feature-title" href={item.url} target="_blank" rel="noreferrer">
      {item.title}
    </a>
  )
  // 热榜条目多数没有作者与互动数：三者都缺失时整块不渲染，避免留出一条只有边框的空行。
  const hasMeta = item.contentType !== undefined
    || item.authorName !== undefined
    || item.voteCount !== undefined
    || item.commentCount !== undefined
  return (
    <article className="ui-explore__feature-body">
      {title}
      {item.summary !== '' && <p className="ui-explore__feature-summary">{item.summary}</p>}
      {hasMeta && (
        <div className="ui-explore__feature-meta">
          {item.contentType !== undefined && <span>{item.contentType}</span>}
          {item.authorName !== undefined && <span>{item.authorName}</span>}
          {(item.voteCount !== undefined || item.commentCount !== undefined) && (
            <span className="ui-explore__feature-stats">
              {item.voteCount !== undefined && <span><strong>{formatCount(item.voteCount)}</strong> 赞同</span>}
              {item.commentCount !== undefined && <span><strong>{formatCount(item.commentCount)}</strong> 评论</span>}
            </span>
          )}
        </div>
      )}
    </article>
  )
}

/** 发现页是一屏版面：讨论条数与热榜条数都按一屏容量取定，靠数据切片而不是滚动承载。 */
function DiscussionList({ feed, onRetry, limit }: {
  readonly feed: HomeFeedState
  readonly onRetry: () => void
  readonly limit: number
}) {
  const items = feed.items.slice(1, 1 + limit)
  return (
    <section className="ui-explore__discussion" aria-labelledby="explore-discussion-title">
      <div className="ui-explore__section-head">
        <h2 id="explore-discussion-title">正在讨论</h2>
      </div>
      {feed.status === 'loading' && (
        <div className="ui-explore__list-skeleton" aria-label="正在获取讨论">
          {Array.from({ length: limit }, (_, index) => <span key={index} />)}
        </div>
      )}
      {feed.status === 'error' && <ExploreNotice message="讨论列表暂不可用。" onRetry={onRetry} />}
      {feed.status === 'ready' && items.length === 0 && <ExploreNotice message="暂时没有更多讨论。" />}
      {feed.status === 'ready' && items.length > 0 && (
        <ol className="uhf__list ui-explore__discussion-list">
          {items.map((item, index) => (
            <li key={item.id}>
              <span className="ui-explore__discussion-rank" aria-hidden>{String(index + 1).padStart(2, '0')}</span>
              <FeedCard item={item} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function HotRanking({ feed, onRetry, limit }: {
  readonly feed: HomeFeedState
  readonly onRetry: () => void
  readonly limit: number
}) {
  const items = feed.items.slice(0, limit)
  return (
    <section className="ui-explore__side-card" aria-labelledby="explore-hot-title">
      <div className="ui-explore__side-head">
        <Flame size={15} className="is-hot" aria-hidden />
        <h2 id="explore-hot-title">知乎热榜</h2>
      </div>
      {feed.status === 'ready' && feed.stale && (
        <p className="ui-explore__stale">上游暂不可用，下面是上一次获取的内容。</p>
      )}
      {feed.status === 'loading' && (
        <div className="ui-explore__side-skeleton" aria-label="正在获取热榜">
          {Array.from({ length: limit }, (_, index) => <span key={index} />)}
        </div>
      )}
      {feed.status === 'error' && <ExploreNotice message="热榜暂不可用。" onRetry={onRetry} compact />}
      {feed.status === 'ready' && items.length === 0 && <ExploreNotice message="热榜暂时没有内容。" compact />}
      {feed.status === 'ready' && items.length > 0 && (
        <ol className="ui-home__core-list">
          {items.map((item, index) => <li key={item.id}><HotRow item={item} rank={index + 1} /></li>)}
        </ol>
      )}
    </section>
  )
}

function FeatureSkeleton() {
  return (
    <div className="ui-explore__feature-skeleton" aria-label="正在获取主议题">
      <span /><span /><span />
    </div>
  )
}

function ExploreNotice({ message, onRetry, compact = false }: {
  readonly message: string
  readonly onRetry?: () => void
  readonly compact?: boolean
}) {
  return (
    <div className={compact ? 'ui-explore__notice is-compact' : 'ui-explore__notice'}>
      <p>{message}</p>
      {onRetry !== undefined && <button type="button" onClick={onRetry}>重试</button>}
    </div>
  )
}
