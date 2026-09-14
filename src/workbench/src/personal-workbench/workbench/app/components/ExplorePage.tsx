import { useState } from 'react'
import { BookOpen, ExternalLink, Flame } from 'lucide-react'
import { useZhihuLogin } from '@ui/features/auth/login-request'
import { isZhihuUserSession, useZhihuSession } from '@ui/workbench/zhihu-account'
import { FeedCard } from './home-feed-view'
import { formatCount, HotRow } from './home-feeds'
import { useCoreFeed, type CoreFeed } from './use-core-feed'
import { useHomeFeed, type HomeFeedItem, type HomeFeedState } from './use-home-feed'
import './explore-page.css'
import './workbench-views.css'

interface RecommendedQuestion {
  readonly id: string
  readonly title: string
}
/** 热榜只在本页读取一次，主议题、讨论列表与 Top 5 都由同一份结果切片。 */
export function ExplorePage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const feed = useHomeFeed({ refreshKey })
  const retry = (): void => setRefreshKey((current) => current + 1)

  return (
    <div className="ui-view ui-explore">
      <div className="ui-view__frame ui-explore__frame">
        <header className="ui-explore__header">
          <h1>发现</h1>
          <div className="ui-explore__context">
            <p>从今天正在发生的讨论里，找到值得继续追问的问题。</p>
          </div>
        </header>

        <div className="ui-explore__layout">
          <main className="ui-explore__main">
            <FeatureIssue feed={feed} onRetry={retry} />
            <DiscussionList feed={feed} onRetry={retry} />
          </main>
          <aside className="ui-explore__aside" aria-label="探索侧栏">
            <HotRanking feed={feed} onRetry={retry} />
            <KnowledgePicks />
          </aside>
        </div>
      </div>
    </div>
  )
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
  const title = item.url === '' ? (
    <h3 className="ui-explore__feature-title">{item.title}</h3>
  ) : (
    <a className="ui-explore__feature-title" href={item.url} target="_blank" rel="noreferrer">
      {item.title}<ExternalLink size={15} aria-hidden />
    </a>
  )
  return (
    <article className="ui-explore__feature-body">
      {title}
      {item.summary !== '' && <p className="ui-explore__feature-summary">{item.summary}</p>}
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
    </article>
  )
}

function DiscussionList({ feed, onRetry }: { readonly feed: HomeFeedState; readonly onRetry: () => void }) {
  const items = feed.items.slice(1, 6)
  return (
    <section className="ui-explore__discussion" aria-labelledby="explore-discussion-title">
      <div className="ui-explore__section-head">
        <h2 id="explore-discussion-title">正在讨论</h2>
        <span>来自今日热榜</span>
      </div>
      {feed.status === 'loading' && (
        <div className="ui-explore__list-skeleton" aria-label="正在获取讨论">
          {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
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

function HotRanking({ feed, onRetry }: { readonly feed: HomeFeedState; readonly onRetry: () => void }) {
  const items = feed.items.slice(0, 5)
  return (
    <section className="ui-explore__side-card" aria-labelledby="explore-hot-title">
      <div className="ui-explore__side-head">
        <Flame size={15} className="is-hot" aria-hidden />
        <h2 id="explore-hot-title">知乎热榜</h2>
        <span>Top 5</span>
      </div>
      {feed.status === 'loading' && (
        <div className="ui-explore__side-skeleton" aria-label="正在获取热榜">
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
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

/** 知识精选按账号画像生成；未登录时只解释登录收益，不请求用户推荐接口。 */
function KnowledgePicks() {
  const { state: sessionState } = useZhihuSession()
  const { openLogin } = useZhihuLogin()
  const personalized = sessionState.status === 'ready' && isZhihuUserSession(sessionState.session)
  return (
    <section className="ui-explore__side-card" aria-labelledby="explore-knowledge-title">
      <div className="ui-explore__side-head">
        <BookOpen size={15} aria-hidden />
        <h2 id="explore-knowledge-title">{personalized ? '知识精选' : '值得追问的问题'}</h2>
      </div>
      {sessionState.status === 'loading' && (
        <div className="ui-explore__side-skeleton" aria-label="正在确认登录状态">
          {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
        </div>
      )}
      {sessionState.status === 'ready' && personalized && <KnowledgeList />}
      {/* 未登录不请求推荐接口：推荐属于用户数据域，热榜例外不能扩散到这里。 */}
      {sessionState.status === 'ready' && !personalized && (
        <div className="ui-explore__login-note">
          <p>登录后查看按你的知乎画像推荐的问题。</p>
          <button type="button" onClick={() => openLogin('explore')}>登录查看</button>
        </div>
      )}
      {sessionState.status === 'error' && <ExploreNotice message={sessionState.message} compact />}
    </section>
  )
}

function KnowledgeList() {
  const feed = useCoreFeed('/api/user/recommendations', readRecommendedQuestions)
  return <KnowledgeListState feed={feed} />
}

function KnowledgeListState({ feed }: { readonly feed: CoreFeed<RecommendedQuestion> }) {
  if (feed.status === 'loading') {
    return (
      <div className="ui-explore__side-skeleton" aria-label="正在获取知识精选">
        {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
      </div>
    )
  }
  if (feed.status === 'error') {
    return <ExploreNotice message={feed.error ?? '推荐暂不可用。'} onRetry={feed.retry} compact />
  }
  if (feed.items.length === 0) return <ExploreNotice message="暂时没有推荐的问题。" compact />
  return (
    <ol className="ui-explore__knowledge-list">
      {feed.items.slice(0, 4).map((item, index) => (
        <li key={item.id}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <p>{item.title}</p>
        </li>
      ))}
    </ol>
  )
}

function readRecommendedQuestions(body: Record<string, unknown>): readonly RecommendedQuestion[] {
  if (!Array.isArray(body.items)) return []
  return body.items.flatMap((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return []
    const item = raw as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : ''
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    return id === '' || title === '' ? [] : [{ id, title }]
  })
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
