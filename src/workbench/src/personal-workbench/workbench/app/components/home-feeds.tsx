import { useState, type ReactNode } from 'react'
import {
  ExternalLink,
  Search,
  type LucideIcon,
} from 'lucide-react'
import {
  readNumberField,
  readStringField,
  type CoreFeed,
} from './use-core-feed'
import { ZhihuLogo } from '@ui/components/zhihu-logo'
import type { ZhihuAccountProfile } from '@ui/workbench/zhihu-account'
import './home-page.css'

type HomeIdentityState = 'loading' | 'error' | 'guest' | 'authenticated'

export function HomeMasthead({ state, profile, onLogin, onRetry }: {
  readonly state: HomeIdentityState
  readonly profile?: ZhihuAccountProfile
  readonly onLogin: () => void
  readonly onRetry?: () => void
}) {
  const name = state === 'authenticated'
    ? profile?.fullname.trim() || '我的知乎'
    : '暂时无法确认登录状态'
  const avatarUrl = profile?.avatarUrl?.trim()
  const personalized = state === 'authenticated'
  const subtitle = state === 'authenticated'
    ? profile?.headline?.trim() || '把好奇留给问题，也留给自己。'
    : '重新检查后即可继续。'
  return (
    <header className="ui-home__masthead" data-state={state}>
      <div
        className={personalized ? 'ui-home__identity-avatar' : 'ui-home__identity-avatar ui-home__identity-avatar--empty'}
        aria-hidden="true"
      >
        {personalized && (avatarUrl !== undefined && avatarUrl !== ''
          ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" />
          : <span>{name.slice(0, 1)}</span>)}
        {personalized && <i />}
      </div>
      {/* 确认期间只占位：把「正在连接」当标题写出来，等于把管线状态摆成首屏主视觉。 */}
      {state === 'loading' && (
        <div className="ui-home__identity-skeleton" role="status" aria-label="正在确认账号状态">
          <i aria-hidden="true" /><i aria-hidden="true" />
        </div>
      )}
      {(state === 'authenticated' || state === 'error') && <><h1>{name}</h1><p>{subtitle}</p></>}
      {state === 'guest' && (
        <button type="button" className="ui-home__identity-action" onClick={onLogin}>
          <ZhihuLogo />
          <span>使用知乎登录</span>
        </button>
      )}
      {state === 'error' && onRetry !== undefined && (
        <button type="button" className="ui-home__identity-action" onClick={onRetry}>重新检查</button>
      )}
      <blockquote>
        <span className="ui-home__quote-bracket">「</span>好的问题，
        <br />
        让世界更大一点。<span className="ui-home__quote-bracket">」</span>
        <cite>知无不言</cite>
      </blockquote>
    </header>
  )
}

export function HomeSearchBar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const [searchQuery, setSearchQuery] = useState('')
  return (
    <form
      className="ui-home__search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        if (searchQuery.trim().length > 0) onOpenSearch?.()
      }}
    >
      <Search size={15} className="ui-home__search-icon" aria-hidden />
      <input
        className="ui-home__search-input"
        type="search"
        placeholder="搜索知乎的问题、回答与文章"
        aria-label="搜索知乎内容"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />
      <kbd className="ui-home__search-kbd">Ctrl K</kbd>
    </form>
  )
}

/** 首页热榜与我的知乎三个个人面各读各的接口，读取器保持模块级稳定引用，配合 useCoreFeed 的依赖约定。 */
export interface HotItem {
  readonly id: string
  readonly title: string
  readonly url: string
}

export function readHotItems(body: Record<string, unknown>): readonly HotItem[] {
  return collectItems(body).map((item) => ({
    id: readStringField(item, 'id'),
    title: readStringField(item, 'title'),
    url: readStringField(item, 'url'),
  })).filter((item) => item.id !== '' && item.title !== '')
}

interface CollectedItem {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly contentType?: string
  readonly sourceLabel?: string
}

export function readCollectionItems(body: Record<string, unknown>): readonly CollectedItem[] {
  return collectItems(body).map((item) => {
    const favlists = item.favlistNames
    const favlistLabel = Array.isArray(favlists)
      ? favlists.find((name) => typeof name === 'string' && name !== '')
      : undefined
    const author = readStringField(item, 'authorName')
    return {
      id: readStringField(item, 'id'),
      title: readStringField(item, 'title'),
      url: readStringField(item, 'url'),
      contentType: readOptional(item, 'contentType'),
      sourceLabel: favlistLabel ?? (author !== '' ? author : undefined),
    }
  }).filter((item) => item.id !== '' && item.title !== '')
}

interface CreationItem {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly contentType?: string
  readonly likeCount?: number
  readonly commentCount?: number
}

export function readCreationItems(body: Record<string, unknown>): readonly CreationItem[] {
  return collectItems(body).map((item) => ({
    id: readStringField(item, 'id'),
    title: readStringField(item, 'title'),
    url: readStringField(item, 'url'),
    contentType: readOptional(item, 'contentType'),
    likeCount: readNumberField(item, 'likeCount'),
    commentCount: readNumberField(item, 'commentCount'),
  })).filter((item) => item.id !== '' && item.title !== '')
}

interface FolloweeItem {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly headline: string
  readonly followerCount?: number
  readonly avatarUrl?: string
}

export function readFolloweeItems(body: Record<string, unknown>): readonly FolloweeItem[] {
  return collectItems(body).map((item) => ({
    id: readStringField(item, 'id'),
    name: readStringField(item, 'name'),
    url: readStringField(item, 'url'),
    headline: readStringField(item, 'headline'),
    followerCount: readNumberField(item, 'followerCount'),
    avatarUrl: readOptional(item, 'avatarUrl'),
  })).filter((item) => item.id !== '' && item.name !== '')
}

function collectItems(body: Record<string, unknown>): readonly Record<string, unknown>[] {
  const items = body.items
  if (!Array.isArray(items)) return []
  return items.filter((item): item is Record<string, unknown> =>
    item !== null && typeof item === 'object' && !Array.isArray(item),
  )
}

function readOptional(record: Record<string, unknown>, key: string): string | undefined {
  const value = readStringField(record, key)
  return value === '' ? undefined : value
}

const CONTENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  answer: '回答',
  article: '文章',
  pin: '想法',
  question: '问题',
  zvideo: '视频',
}

function contentLabel(contentType: string | undefined): string {
  if (contentType === undefined) return ''
  return CONTENT_TYPE_LABELS[contentType] ?? contentType
}

interface CoreCardProps<T> {
  icon: LucideIcon
  name: string
  role: string
  accent?: boolean
  feed: CoreFeed<T>
  limit: number
  moreLabel?: string
  onMore?: () => void
  renderItem: (item: T, index: number) => ReactNode
}

export function CoreCard<T>({ icon: Icon, name, role, accent = false, feed, limit, moreLabel, onMore, renderItem }: CoreCardProps<T>) {
  return (
    <section className="ui-home__core" aria-label={name}>
      <div className="ui-home__core-head">
        <Icon size={15} className={accent ? 'ui-home__core-glyph is-accent' : 'ui-home__core-glyph'} aria-hidden />
        <h2 className="ui-home__core-name">{name}</h2>
        <span className="ui-home__core-role">{role}</span>
        {moreLabel !== undefined && onMore !== undefined && (
          <button type="button" className="ui-home__core-more" onClick={onMore}>{moreLabel}</button>
        )}
      </div>

      {feed.status === 'loading' && (
        <div className="ui-home__skeleton" aria-label="正在获取">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="ui-home__skeleton-row" />
          ))}
        </div>
      )}

      {feed.status === 'error' && (
        <div className="ui-home__core-notice">
          <p>{feed.error}</p>
          <button type="button" onClick={feed.retry}>重试</button>
        </div>
      )}

      {feed.status === 'ready' && feed.items.length === 0 && (
        <div className="ui-home__core-notice">
          <p>暂时没有内容。</p>
        </div>
      )}

      {feed.status === 'ready' && feed.items.length > 0 && (
        <ul className="ui-home__core-list">
          {feed.items.slice(0, limit).map((item, index) => (
            <li key={index}>{renderItem(item, index)}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CoreRowLink({ url, variant, children }: { url: string; variant?: string; children: ReactNode }) {
  const className = variant === undefined ? 'ui-home__row' : `ui-home__row ${variant}`
  if (url === '') {
    return <div className={className}>{children}</div>
  }
  return (
    <a className={className} href={url} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={12} className="ui-home__row-open" aria-hidden />
    </a>
  )
}

export function HotRow({ item, rank }: { item: HotItem; rank: number }) {
  return (
    <CoreRowLink url={item.url} variant="ui-home__row--ranked">
      <span className="ui-home__rank" data-rank={rank}>{rank}</span>
      <span className="ui-home__row-title">{item.title}</span>
    </CoreRowLink>
  )
}

export function CollectionRow({ item }: { item: CollectedItem }) {
  const label = contentLabel(item.contentType)
  return (
    <CoreRowLink url={item.url}>
      <span className="ui-home__row-title">{item.title}</span>
      <span className="ui-home__row-meta">
        {label}{label !== '' && item.sourceLabel !== undefined ? ' · ' : ''}{item.sourceLabel ?? ''}
      </span>
    </CoreRowLink>
  )
}

export function CreationRow({ item }: { item: CreationItem }) {
  const parts: string[] = []
  const label = contentLabel(item.contentType)
  if (label !== '') parts.push(label)
  if (item.likeCount !== undefined) parts.push(`赞同 ${formatCount(item.likeCount)}`)
  if (item.commentCount !== undefined) parts.push(`评论 ${formatCount(item.commentCount)}`)
  return (
    <CoreRowLink url={item.url}>
      <span className="ui-home__row-title">{item.title}</span>
      {parts.length > 0 && <span className="ui-home__row-meta">{parts.join(' · ')}</span>}
    </CoreRowLink>
  )
}

export function FolloweeRow({ item }: { item: FolloweeItem }) {
  return (
    <CoreRowLink url={item.url} variant="ui-home__row--followee">
      {item.avatarUrl !== undefined
        ? <img className="ui-home__avatar" src={item.avatarUrl} alt="" loading="lazy" />
        : <span className="ui-home__avatar ui-home__avatar--initial">{item.name.slice(-2, -1) || item.name.slice(0, 1)}</span>}
      <span className="ui-home__followee">
        <span className="ui-home__row-title">{item.name}</span>
        {item.headline !== '' && <span className="ui-home__row-meta">{item.headline}</span>}
      </span>
      {item.followerCount !== undefined && (
        <span className="ui-home__followers">{formatCount(item.followerCount)} 关注者</span>
      )}
    </CoreRowLink>
  )
}

export function formatCount(count: number): string {
  if (count >= 10000) {
    const value = (count / 10000).toFixed(1)
    return `${value.endsWith('.0') ? value.slice(0, -2) : value} 万`
  }
  return String(count)
}
