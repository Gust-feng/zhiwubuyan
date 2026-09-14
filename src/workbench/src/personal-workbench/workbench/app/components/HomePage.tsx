import { useState } from 'react'
import { ArrowRight, Bookmark, LockKeyhole, Network, PenLine, Users } from 'lucide-react'
import { HomeAnswerPanel, HomeAskBar } from './home-feed-view'
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
import { useHomeAnswer, type HomeFeedScope } from './use-home-feed'
import { useCoreFeed } from './use-core-feed'
import { usePersonalArchive } from './use-personal-archive'
import { KnowledgeNetwork } from './personal-archive'
import { useWorkbenchSurface } from '@ui/workbench/surface'
import { isZhihuUserSession, useZhihuSession } from '@ui/workbench/zhihu-account'
import { useZhihuLogin } from '@ui/features/auth/login-request'
import './home-page.css'
import './workbench-views.css'

interface HomePageProps {
  /** 带着问题进入众声：直答面板的「众声」入口用它承接需要可核对引用的情况。 */
  onOpenVoices: (issue: string) => void
  /** 带着检索条件进入检索视图：结果独立成页，不插回首页内容流。 */
  onOpenSearch: (query: string, scope: HomeFeedScope) => void
}

/**
 * 首页：搜索入口、直答与个人数据摘要；检索结果由独立视图承载，热榜浏览由探索页独占。
 * 直答快答是同一输入框的第二条通路，返回生成内容、不进证据体系，界面固定标注可能出错。
 * 研究入口与进展留在侧栏的深度研究板块，首页不再重复承载研究卡片。
 */
export function HomePage({ onOpenVoices, onOpenSearch }: HomePageProps) {
  const [draft, setDraft] = useState('')
  const [scope, setScope] = useState<HomeFeedScope>('zhihu')
  const answer = useHomeAnswer()
  const surfaceState = useWorkbenchSurface()
  const { state: sessionState, reload: reloadSession } = useZhihuSession()
  const { openLogin } = useZhihuLogin()
  const [tier, setTier] = useState<'fast' | 'thinking'>('fast')
  const [asked, setAsked] = useState('')

  // 网页端直答与检索要消耗调用方额度，匿名访客不发请求，改为拉起登录。
  // 桌面端用用户自带凭证，不拦；公开热榜由探索页单独读取。
  // 本地开发预览（developerMode）额度挂在本机 ACS 上，与服务端 requireWebLogin 的豁免一致，不拦；
  // 账号相关界面仍只认真实 OAuth 会话（isZhihuUserSession）。
  const session = sessionState.status === 'ready' ? sessionState.session : undefined
  const authenticated = session !== undefined && isZhihuUserSession(session)
  const developerPreview = session?.developerMode === true
  const loginRequired = surfaceState.surface === 'web' && surfaceState.ready && !authenticated && !developerPreview

  const askZhida = (question: string, nextTier: 'fast' | 'thinking') => {
    if (question.trim() === '') return
    if (loginRequired) {
      openLogin('home')
      return
    }
    setAsked(question)
    answer.ask(question, nextTier)
  }

  // 主题检索同样要求登录；热榜（探索页）保持匿名可读。
  const submitSearch = (query: string): void => {
    const next = query.trim()
    if (next === '') return
    if (loginRequired) {
      openLogin('home')
      return
    }
    onOpenSearch(next, scope)
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
              ? session.profile
              : undefined}
            onLogin={() => openLogin('home')}
            onRetry={sessionState.status === 'error' ? reloadSession : undefined}
          />
        </div>

        <HomeAskBar
          draft={draft}
          onDraftChange={setDraft}
          scope={scope}
          onScopeChange={setScope}
          onSubmit={() => submitSearch(draft)}
          onAsk={() => askZhida(draft, tier)}
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
        </div>

        <HomePersonalSummary />
      </div>
    </div>
  )
}

/** 个人数据只在确认已登录后挂载，避免匿名访问误打用户接口。 */
function HomePersonalSummary() {
  const { state: sessionState, reload } = useZhihuSession()
  const { openLogin } = useZhihuLogin()

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
      <GuestPersonalPreview onLogin={() => openLogin('home')} />
    )
  }

  return (
    <section className="ui-home__personal" aria-labelledby="home-personal-title">
      <header className="ui-home__personal-head">
        <div>
          <span className="ui-home__section-rule" aria-hidden />
          <h2 id="home-personal-title">我的知乎摘要</h2>
          <p>从最近的创作、收藏、关注与同题脉络继续阅读。</p>
        </div>
      </header>

      <AuthenticatedHomeSummary />
    </section>
  )
}

/** 未登录预览只画形状，不放任何真实或编造的数据；形状本身说明登录后能得到什么。 */
type PreviewKind = 'creation' | 'collection' | 'followee' | 'knowledge'

function PreviewGhost({ kind }: { readonly kind: PreviewKind }) {
  if (kind === 'creation') {
    return (
      <span className="ui-home__ghost ui-home__ghost--lines" aria-hidden>
        <i /><i /><i /><i /><i />
      </span>
    )
  }

  if (kind === 'collection') {
    return (
      <span className="ui-home__ghost ui-home__ghost--media" aria-hidden>
        {[0, 1, 2].map((row) => (
          <span className="ui-home__ghost-media-row" key={row}>
            <i className="ui-home__ghost-thumb" />
            <span className="ui-home__ghost-media-text"><i /><i /></span>
            <Bookmark className="ui-home__ghost-mark" size={12} aria-hidden />
          </span>
        ))}
      </span>
    )
  }

  if (kind === 'followee') {
    return (
      <span className="ui-home__ghost ui-home__ghost--avatars" aria-hidden>
        {[0, 1, 2].map((index) => <i key={index} />)}
      </span>
    )
  }

  return (
    <span className="ui-home__ghost ui-home__ghost--graph" aria-hidden>
      <svg viewBox="0 0 168 96" focusable="false">
        <g className="ui-home__ghost-graph-edges">
          <line x1="84" y1="48" x2="30" y2="22" />
          <line x1="84" y1="48" x2="140" y2="24" />
          <line x1="84" y1="48" x2="24" y2="72" />
          <line x1="84" y1="48" x2="86" y2="86" />
          <line x1="84" y1="48" x2="146" y2="70" />
        </g>
        <g className="ui-home__ghost-graph-nodes">
          <circle cx="84" cy="48" r="13" />
          <circle cx="30" cy="22" r="7" />
          <circle cx="140" cy="24" r="7" />
          <circle cx="24" cy="72" r="7" />
          <circle cx="86" cy="86" r="7" />
          <circle cx="146" cy="70" r="7" />
        </g>
      </svg>
      <span className="ui-home__ghost-graph-label ui-home__ghost-graph-label--insight">认知</span>
      <span className="ui-home__ghost-graph-label ui-home__ghost-graph-label--tech">技术</span>
      <span className="ui-home__ghost-graph-label ui-home__ghost-graph-label--life">生活</span>
      <span className="ui-home__ghost-graph-label ui-home__ghost-graph-label--product">产品</span>
      <span className="ui-home__ghost-graph-label ui-home__ghost-graph-label--society">社会</span>
    </span>
  )
}

function GuestPersonalPreview({ onLogin }: { readonly onLogin: () => void }) {
  const items = [
    { kind: 'creation', icon: PenLine, title: '创作', subtitle: '记录思考，分享见解', detail: '在这里，遇见更好的表达自己。' },
    { kind: 'collection', icon: Bookmark, title: '收藏', subtitle: '好的想法，值得反复阅读', detail: '收藏你感兴趣的内容。' },
    { kind: 'followee', icon: Users, title: '关注', subtitle: '与有趣的人，一起看更大的世界', detail: '发现值得关注的创作者。' },
    { kind: 'knowledge', icon: Network, title: '知识脉络', subtitle: '从问题出发，构建自己的知识地图', detail: '让知识成为你的思考路径。' },
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
        {items.map(({ kind, icon: Icon, title, subtitle, detail }) => (
          <article className="ui-home__preview-card" key={title}>
            <div className="ui-home__preview-title"><Icon size={17} aria-hidden /><h3>{title}</h3><ArrowRight className="ui-home__preview-title-arrow" size={16} aria-hidden /></div>
            <p className="ui-home__preview-subtitle">{subtitle}</p>
            <button
              type="button"
              className="ui-home__preview-lock"
              onClick={onLogin}
              aria-label={`登录后查看${title}`}
            >
              <PreviewGhost kind={kind} />
              <span className="ui-home__preview-gate">
                <span className="ui-home__preview-badge"><LockKeyhole size={15} aria-hidden /></span>
                <strong>登录后查看</strong>
                <span className="ui-home__preview-detail">{detail}</span>
              </span>
            </button>
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
      <KnowledgeSummaryCard />
    </div>
  )
}

/** 知识脉络复用档案的同题聚合：服务端按 TTL 与并发合并，首页只在快照过期时才触发一次同步。 */
function KnowledgeSummaryCard() {
  const archive = usePersonalArchive(true)
  const clusters = archive.archive?.views.questionClusters ?? []
  return (
    <section className="ui-home__core" aria-label="知识脉络">
      <div className="ui-home__core-head">
        <Network size={15} className="ui-home__core-glyph" aria-hidden />
        <h2 className="ui-home__core-name">知识脉络</h2>
        <span className="ui-home__core-role">同题聚合</span>
        {archive.status === 'ready' && (
          <span className="ui-home__core-meta">{clusters.length} 组</span>
        )}
      </div>

      {archive.status === 'loading' && (
        <div className="ui-home__skeleton" aria-label="正在同步">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="ui-home__skeleton-row" />
          ))}
        </div>
      )}

      {archive.status === 'error' && (
        <div className="ui-home__core-notice">
          <p>{archive.error}</p>
          <button type="button" onClick={archive.retry}>重试</button>
        </div>
      )}

      {archive.status === 'ready' && (
        <div className="ui-home__knowledge">
          <KnowledgeNetwork clusters={clusters} />
        </div>
      )}
    </section>
  )
}
