import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CircleAlert, RefreshCw, Users } from 'lucide-react'
import { getJson } from '@ui/api'
import type {
  CircleCommentView,
  CircleFeedView,
  CirclePostView,
  CircleStoryDetailView,
  CircleStoryView,
  CircleSummaryView,
} from '../../../../contracts/circles'
import './circles-page.css'

type Tab = 'feed' | 'stories'

type Loadable<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly message: string }

/** 圈子：知乎社区里的公开讨论，按圈子浏览内容流，另有黑客松故事可读。
 *  内容全部来自本地 API 的 /api/circles*，是外部公开文本，只读、不进入研究来源体系。 */
export function CirclesPage() {
  const [tab, setTab] = useState<Tab>('feed')

  return (
    <div className="ui-view circles-page">
      <div className="ui-view__frame">
        <div className="ui-view__head">
          <div>
            <h1 className="ui-view__lede">圈子</h1>
            <p className="ui-view__sub">
              知乎社区里的公开讨论。这里是别人写给人看的内容，看法归作者本人，互动数只说明关注度，不代表内容为真。
            </p>
          </div>
        </div>

        <div className="circles-tabs" role="tablist" aria-label="圈子内容">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'feed'}
            className="circles-tab"
            onClick={() => setTab('feed')}
          >
            圈子动态
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'stories'}
            className="circles-tab"
            onClick={() => setTab('stories')}
          >
            黑客松故事
          </button>
        </div>

        {tab === 'feed' ? <CircleFeed /> : <StoryList />}
      </div>
    </div>
  )
}

// ── 圈子动态 ────────────────────────────────────────────────────────────────

function CircleFeed() {
  const rings = useLoad<readonly CircleSummaryView[]>(
    useCallback(async (signal) => (await getJson<{ rings: readonly CircleSummaryView[] }>('/api/circles', { signal })).rings, []),
  )
  const [ringId, setRingId] = useState<string | null>(null)

  if (rings.status === 'loading') return <Loading label="正在读取圈子…" />
  if (rings.status === 'error') return <Failure message={rings.message} onRetry={rings.retry} />
  if (rings.data.length === 0) {
    return <Empty title="没有可浏览的圈子" detail="当前账号没有可访问的圈子。" />
  }

  const activeRingId = ringId ?? rings.data[0]?.id ?? null

  return (
    <div className="circles-feed">
      <div className="circles-rings" role="tablist" aria-label="选择圈子">
        {rings.data.map((ring) => (
          <button
            key={ring.id}
            type="button"
            role="tab"
            aria-selected={ring.id === activeRingId}
            className="circles-ring"
            onClick={() => setRingId(ring.id)}
          >
            {ring.name}
          </button>
        ))}
      </div>
      {activeRingId !== null && <RingPosts key={activeRingId} ringId={activeRingId} />}
    </div>
  )
}

function RingPosts({ ringId }: { ringId: string }) {
  const [feed, setFeed] = useState<CircleFeedView | null>(null)
  const [posts, setPosts] = useState<readonly CirclePostView[]>([])
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const seqRef = useRef(0)

  const load = useCallback(async (nextPage: number) => {
    const seq = ++seqRef.current
    if (nextPage === 1) setStatus('loading')
    else setLoadingMore(true)
    try {
      const data = await getJson<CircleFeedView>(`/api/circles/posts?ringId=${encodeURIComponent(ringId)}&page=${nextPage}`)
      if (seq !== seqRef.current) return
      setFeed(data)
      setPage(nextPage)
      // 同一批在翻页时可能重叠，按帖子 ID 去重；已有顺序保持不变。
      setPosts((current) => nextPage === 1 ? data.posts : mergeUnique(current, data.posts))
      setStatus('ready')
      setError('')
    } catch (cause) {
      if (seq !== seqRef.current) return
      setError(cause instanceof Error && cause.message !== '' ? cause.message : '知乎那边暂时没有响应，可以再试一次')
      setStatus('error')
    } finally {
      if (seq === seqRef.current) setLoadingMore(false)
    }
  }, [ringId])

  useEffect(() => { void load(1) }, [load])

  if (status === 'loading') return <Loading label="正在读取内容…" />
  if (status === 'error') return <Failure message={error} onRetry={() => void load(1)} />
  if (feed === null) return null

  return (
    <div className="circles-stream">
      <RingHeader feed={feed} />

      {posts.length === 0 ? (
        <Empty title="这个圈子暂时没有内容" detail="换个圈子，或者稍后再来。" />
      ) : (
        <ul className="circles-posts">
          {posts.map((post) => <PostCard key={post.id} post={post} />)}
        </ul>
      )}

      {posts.length > 0 && (
        <div className="circles-more">
          <button type="button" className="circles-more__button" disabled={loadingMore} onClick={() => void load(page + 1)}>
            {loadingMore ? '正在加载…' : '加载更多'}
          </button>
          <span className="circles-more__hint">内容顺序按平台返回，最新的一般在前面。</span>
        </div>
      )}
    </div>
  )
}

function RingHeader({ feed }: { feed: CircleFeedView }) {
  const { ring } = feed
  const meta = [
    ring.membershipCount !== undefined ? `${formatCount(ring.membershipCount)} 成员` : undefined,
    ring.discussionCount !== undefined ? `${formatCount(ring.discussionCount)} 条讨论` : undefined,
  ].filter((part) => part !== undefined).join(' · ')
  return (
    <section className="circles-ring-head">
      {ring.avatarUrl !== '' && (
        <img className="circles-ring-head__avatar" src={ring.avatarUrl} alt="" loading="lazy" />
      )}
      <div className="circles-ring-head__body">
        <h2 className="circles-ring-head__name">{ring.name}</h2>
        {ring.description !== '' && <p className="circles-ring-head__desc">{ring.description}</p>}
        {meta !== '' && <span className="circles-ring-head__meta">{meta}</span>}
      </div>
    </section>
  )
}

function PostCard({ post }: { post: CirclePostView }) {
  const meta = [
    formatTimestamp(post.publishedAt),
    post.likeCount !== undefined ? `赞同 ${formatCount(post.likeCount)}` : undefined,
    post.commentCount !== undefined ? `评论 ${formatCount(post.commentCount)}` : undefined,
  ].filter((part) => part !== undefined && part !== '').join(' · ')

  return (
    <li className="circles-post">
      {post.title !== undefined && <h3 className="circles-post__title">{post.title}</h3>}
      {post.content !== '' && <p className="circles-post__body">{post.content}</p>}
      {post.truncated && <span className="circles-post__clip">正文较长，这里只显示节选</span>}

      {post.imageUrls.length > 0 && (
        <div className="circles-post__images">
          {post.imageUrls.slice(0, 3).map((url) => (
            <img key={url} src={url} alt="" loading="lazy" />
          ))}
        </div>
      )}

      <div className="circles-post__meta">
        <span className="circles-post__author">{post.authorName}</span>
        {meta !== '' && <span>{meta}</span>}
      </div>

      {post.comments.length > 0 && (
        <ul className="circles-comments">
          {post.comments.map((comment) => <CommentRow key={comment.id} comment={comment} />)}
        </ul>
      )}
    </li>
  )
}

function CommentRow({ comment }: { comment: CircleCommentView }) {
  return (
    <li className="circles-comment">
      <span className="circles-comment__author">{comment.authorName}</span>
      <span className="circles-comment__body">{comment.content}</span>
      {comment.likeCount !== undefined && comment.likeCount > 0 && (
        <span className="circles-comment__meta">赞同 {formatCount(comment.likeCount)}</span>
      )}
    </li>
  )
}

// ── 黑客松故事 ──────────────────────────────────────────────────────────────

function StoryList() {
  const stories = useLoad<readonly CircleStoryView[]>(
    useCallback(async (signal) => (await getJson<{ stories: readonly CircleStoryView[] }>('/api/circles/stories', { signal })).stories, []),
  )
  const [selected, setSelected] = useState<CircleStoryView | null>(null)

  if (selected !== null) {
    return <StoryReader story={selected} onBack={() => setSelected(null)} />
  }

  if (stories.status === 'loading') return <Loading label="正在读取故事…" />
  if (stories.status === 'error') return <Failure message={stories.message} onRetry={stories.retry} />
  if (stories.data.length === 0) return <Empty title="暂时没有可读的故事" detail="故事库由活动方维护，稍后再来看看。" />

  return (
    <ul className="circles-stories">
      {stories.data.map((story) => (
        <li key={story.workId}>
          <button type="button" className="circles-story" onClick={() => setSelected(story)}>
            {story.artworkUrl !== undefined && (
              <img className="circles-story__cover" src={story.artworkUrl} alt="" loading="lazy" />
            )}
            <span className="circles-story__body">
              <span className="circles-story__title">{story.title}</span>
              {story.labels.length > 0 && (
                <span className="circles-story__labels">
                  {story.labels.map((label) => <span key={label} className="circles-label">{label}</span>)}
                </span>
              )}
              {story.description !== undefined && story.description !== '' && (
                <span className="circles-story__desc">{story.description}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function StoryReader({ story, onBack }: { story: CircleStoryView; onBack: () => void }) {
  const detail = useLoad<CircleStoryDetailView>(
    useCallback(async (signal) => await getJson<CircleStoryDetailView>(`/api/circles/story?workId=${encodeURIComponent(story.workId)}`, { signal }), [story.workId]),
  )

  return (
    <div className="circles-reader">
      <button type="button" className="circles-reader__back" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden />
        返回故事列表
      </button>

      <h2 className="circles-reader__title">{story.title}</h2>
      <div className="circles-reader__meta">
        {detail.status === 'ready' && detail.data.authorName !== undefined && (
          <span>作者 {detail.data.authorName}</span>
        )}
        {story.labels.length > 0 && (
          <span className="circles-story__labels">
            {story.labels.map((label) => <span key={label} className="circles-label">{label}</span>)}
          </span>
        )}
      </div>

      {detail.status === 'loading' && <Loading label="正在读取正文…" />}
      {detail.status === 'error' && <Failure message={detail.message} onRetry={detail.retry} />}

      {detail.status === 'ready' && (
        <>
          {detail.data.introduction !== undefined && detail.data.introduction !== '' && (
            <p className="circles-reader__intro">{detail.data.introduction}</p>
          )}
          <div className="circles-reader__content">
            {detail.data.content.split('\n').map((paragraph, index) => (
              paragraph === '' ? null : <p key={index}>{paragraph}</p>
            ))}
          </div>
          <p className="circles-reader__note">
            正文节选，最多 3000 字，不是全文。完整内容请在知乎阅读，作者与版权归其本人所有。
          </p>
        </>
      )}
    </div>
  )
}

// ── 共用 ────────────────────────────────────────────────────────────────────

/** 一次性只读加载：组件卸载或重新加载时中止旧请求，丢弃过期响应。 */
function useLoad<T>(load: (signal: AbortSignal) => Promise<T>): Loadable<T> & { retry: () => void } {
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    loadRef.current(controller.signal)
      .then((data) => { if (!controller.signal.aborted) setState({ status: 'ready', data }) })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: cause instanceof Error && cause.message !== '' ? cause.message : '知乎那边暂时没有响应，可以再试一次',
        })
      })
    return () => controller.abort()
  }, [attempt])

  return { ...state, retry: () => setAttempt((value) => value + 1) }
}

function Loading({ label }: { label: string }) {
  return (
    <div className="circles-notice" role="status">
      <RefreshCw size={15} aria-hidden />
      <span>{label}</span>
    </div>
  )
}

function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="circles-notice is-alert" role="alert">
      <CircleAlert size={15} aria-hidden />
      <div>
        <strong>没有读到内容</strong>
        <span>{message}</span>
      </div>
      <button type="button" className="circles-notice__retry" onClick={onRetry}>重试</button>
    </div>
  )
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="circles-notice">
      <Users size={15} aria-hidden />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  )
}

function mergeUnique(current: readonly CirclePostView[], incoming: readonly CirclePostView[]): readonly CirclePostView[] {
  const seen = new Set(current.map((post) => post.id))
  const merged = [...current]
  for (const post of incoming) {
    if (seen.has(post.id)) continue
    seen.add(post.id)
    merged.push(post)
  }
  return merged
}

function formatCount(count: number): string {
  if (count >= 10000) {
    const value = (count / 10000).toFixed(1)
    return `${value.endsWith('.0') ? value.slice(0, -2) : value} 万`
  }
  return String(count)
}

function formatTimestamp(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return undefined
  return `${time.getMonth() + 1}月${time.getDate()}日`
}
