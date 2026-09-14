import { useState } from 'react'
import { ArrowRight, Bookmark, LockKeyhole, Network, PenLine, Users } from 'lucide-react'
import { HomeAnswerPanel, HomeAskBar, HomeFeedView, useHomeSearchState } from './home-feed-view'
import {
  CollectionRow,
  CoreCard,
  CreationRow,
  FolloweeRow,
  HomeMasthead,
  readCollectionItems,
  readCreationItems,
  readFolloweeItems,
} from './home-feeds'
import { useHomeAnswer, useHomeFeed } from './use-home-feed'
import { useCoreFeed } from './use-core-feed'
import { useWorkbenchSurface } from '@ui/workbench/surface'
import { isZhihuUserSession, useZhihuSession } from '@ui/workbench/zhihu-account'
import { useZhihuLogin } from '@ui/features/auth/login-request'
import './home-page.css'
import './workbench-views.css'

interface HomePageProps {
  /** 带着问题进入众声：直答面板的「众声」入口用它承接需要可核对引用的情况。 */
  onOpenVoices: (issue: string) => void
}

/**
 * 首页：搜索、直答与个人数据摘要；热榜浏览由探索页独占。
 * 直答快答是同一输入框的第二条通路，返回生成内容、不进证据体系，界面固定标注可能出错。
 * 研究入口与进展留在侧栏的深度研究板块，首页不再重复承载研究卡片。
 */
export function HomePage({ onOpenVoices }: HomePageProps) {
  const search = useHomeSearchState()
  const feed = useHomeFeed({
    topic: search.topic,
    scope: search.scope,
    type: search.type,
    enabled: search.topic !== '',
  })
  const answer = useHomeAnswer()
  const surfaceState = useWorkbenchSurface()
  const { state: sessionState, reload: reloadSession } = useZhihuSession()
  const { openLogin } = useZhihuLogin()
  const [tier, setTier] = useState<'fast' | 'thinking'>('fast')
  const [asked, setAsked] = useState('')

  // 网页端直答要消耗调用方额度，未登录不发请求，改为拉起登录。
  // 桌面端用用户自带凭证，不拦；公开热榜由探索页单独读取。
  const authenticated = sessionState.status === 'ready' && isZhihuUserSession(sessionState.session)
  const loginRequired = surfaceState.surface === 'web' && surfaceState.ready && !authenticated

  const askZhida = (question: string, nextTier: 'fast' | 'thinking') => {
    if (question.trim() === '') return
    if (loginRequired) {
      openLogin('home')
      return
    }
    setAsked(question)
    answer.ask(question, nextTier)
  }

  // 主题检索同样要求登录；热榜（无检索词）保持匿名可读。
  const submitSearch = (query: string): void => {
    if (query.trim() !== '' && loginRequired) {
      openLogin('home')
      return
    }
    search.submit(query)
  }

  return (
    <div className="ui-view ui-home">
      <div className="ui-view__frame ui-home__frame">
        <div className="ui-home__masthead-wrap">
          <HomeMasthead
            state={sessionState.status === 'loading'
              ? 'loading'
              : sessionState.status === 'error'
                ? 'error'
              : authenticated ? 'authenticated' : 'guest'}
            profile={authenticated
              ? sessionState.session.profile
              : undefined}
            onLogin={() => openLogin('home')}
            onRetry={sessionState.status === 'error' ? reloadSession : undefined}
          />
        </div>

        <HomeAskBar
          draft={search.draft}
          onDraftChange={search.setDraft}
          scope={search.scope}
          onScopeChange={search.setScope}
          onSubmit={() => submitSearch(search.draft)}
          onAsk={() => askZhida(search.draft, tier)}
        />

        <div className="ui-home__content">
          {answer.state.status !== 'idle' && (
            <HomeAnswerPanel
              state={answer.state}
              tier={tier}
              onTierChange={(next) => {
                setTier(next)
                if (asked !== '') askZhida(asked, next)
              }}
              onClose={() => answer.reset()}
              onRetry={() => askZhida(asked, tier)}
              onExplore={() => onOpenVoices(asked)}
            />
          )}

          {search.topic !== '' && (
            <HomeFeedView
              feed={feed}
              topic={search.topic}
              type={search.type}
              onTypeChange={search.setType}
              onRetry={() => search.submit(search.topic || search.draft)}
              onClearTopic={search.clear}
            />
          )}
        </div>

        <HomePersonalSummary />
      </div>
    </div>
  )
}

/** 个人数据只在确认已登录后挂载，避免匿名访问误打用户接口。 */
function HomePersonalSummary() {
  const { state: sessionState, reload } = useZhihuSession()

  if (sessionState.status === 'loading') {
    return (
      <section className="ui-home__personal ui-home__personal--guest" aria-label="个人摘要">
        <div className="ui-home__personal-prompt" role="status">正在确认登录状态…</div>
      </section>
    )
  }

  if (sessionState.status === 'error') {
    return (
      <section className="ui-home__personal ui-home__personal--guest" aria-label="个人摘要">
        <div className="ui-home__personal-prompt" role="status">
          <span>{sessionState.message}</span>
          <button type="button" onClick={reload}>重新检查</button>
        </div>
      </section>
    )
  }

  if (!isZhihuUserSession(sessionState.session)) {
    return (
      <GuestPersonalPreview onLogin={() => undefined} />
    )
  }

  return (
    <section className="ui-home__personal" aria-labelledby="home-personal-title">
      <header className="ui-home__personal-head">
        <div>
          <span className="ui-home__section-rule" aria-hidden />
          <h2 id="home-personal-title">我的知乎摘要</h2>
          <p>从最近的创作、收藏与关注继续阅读。</p>
        </div>
      </header>

      <AuthenticatedHomeSummary />
    </section>
  )
}

function GuestPersonalPreview({ onLogin }: { readonly onLogin: () => void }) {
  const items = [
    { icon: PenLine, title: '创作', subtitle: '记录思考，分享见解', detail: '在这里，遇见更好的表达自己。' },
    { icon: Bookmark, title: '收藏', subtitle: '好的想法，值得反复阅读', detail: '收藏你感兴趣的内容。' },
    { icon: Users, title: '关注', subtitle: '与有趣的人，一起看更大的世界', detail: '发现值得关注的创作者。' },
    { icon: Network, title: '知识脉络', subtitle: '从问题出发，构建自己的知识地图', detail: '让知识成为你的思考路径。' },
  ] as const

  return (
    <section className="ui-home__personal ui-home__personal--guest" aria-label="个人功能预览">
      <header className="ui-home__personal-head">
        <div>
          <span className="ui-home__section-rule" aria-hidden />
          <h2>你的知乎</h2>
          <p>登录后，开启属于你的知识轨迹。</p>
        </div>
      </header>
      <div className="ui-home__preview-grid">
        {items.map(({ icon: Icon, title, subtitle, detail }) => (
          <article className="ui-home__preview-card" key={title}>
            <div className="ui-home__preview-title"><Icon size={17} aria-hidden /><h3>{title}</h3><ArrowRight size={14} aria-hidden /></div>
            <p className="ui-home__preview-subtitle">{subtitle}</p>
            <button type="button" className="ui-home__preview-lock" onClick={onLogin}>
              <span className="ui-home__preview-lock-icon"><LockKeyhole size={19} aria-hidden /></span>
              <strong>登录后查看</strong>
              <span>{detail}</span>
            </button>
            <button type="button" className="ui-home__preview-more" onClick={onLogin}>了解{title}功能 <ArrowRight size={13} aria-hidden /></button>
          </article>
        ))}
      </div>
    </section>
  )
}

function AuthenticatedHomeSummary() {
  const creations = useCoreFeed('/api/user/contents', readCreationItems)
  const collections = useCoreFeed('/api/user/collections', readCollectionItems)
  const followees = useCoreFeed('/api/user/followees', readFolloweeItems)
  const [expanded, setExpanded] = useState({ creations: false, collections: false, followees: false })

  const toggle = (key: keyof typeof expanded): void => {
    setExpanded((current) => ({ ...current, [key]: !current[key] }))
  }

  return (
    <div className="ui-home__personal-grid">
      <CoreCard
        icon={PenLine}
        name="创作"
        role="最近发布"
        feed={creations}
        limit={expanded.creations ? creations.items.length : 3}
        moreLabel={creations.items.length > 3 ? (expanded.creations ? '收起' : '查看更多') : undefined}
        onMore={() => toggle('creations')}
        renderItem={(item) => <CreationRow item={item} />}
      />
      <CoreCard
        icon={Bookmark}
        name="收藏"
        role="最近保存"
        feed={collections}
        limit={expanded.collections ? collections.items.length : 3}
        moreLabel={collections.items.length > 3 ? (expanded.collections ? '收起' : '查看更多') : undefined}
        onMore={() => toggle('collections')}
        renderItem={(item) => <CollectionRow item={item} />}
      />
      <CoreCard
        icon={Users}
        name="关注"
        role="正在关注"
        feed={followees}
        limit={expanded.followees ? followees.items.length : 3}
        moreLabel={followees.items.length > 3 ? (expanded.followees ? '收起' : '查看更多') : undefined}
        onMore={() => toggle('followees')}
        renderItem={(item) => <FolloweeRow item={item} />}
      />
    </div>
  )
}
