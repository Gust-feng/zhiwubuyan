import type { ReactNode } from 'react'
import { Bookmark, Layers, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react'
import { formatCount } from './home-feeds'
import type {
  ArchiveCollectionEntry,
  ArchiveFolloweeTier,
  ArchiveQuestionCluster,
  ArchiveResponseLabel,
  PersonalArchive,
} from './use-personal-archive'
import './personal-archive.css'

/**
 * 个人档案视图：把登录用户自己的创作、收藏与关注按规则组织成几个面。
 *
 * 每一屏的措辞都严格对应后端的可验证规则——同题、比例、天数、粉丝分层、关键词命中，
 * 不含对内容质量或用户兴趣的判断；档案覆盖不全时在页首如实标注，不显示为完整数据。
 */

export function PersonalArchiveView({ archive }: { readonly archive: PersonalArchive }) {
  const { views, counts, truncated, persistent, stale, syncedAt } = archive
  const { creationYear, responseStructure, collectionTimeline, followeeTiers, headlineKeywords } = views

  return (
    <div className="ui-archive">
      <ArchiveNotice
        truncated={truncated}
        persistent={persistent}
        stale={stale}
        syncedAt={syncedAt}
        counts={counts}
      />

      <ArchiveBlock
        icon={Layers}
        title="同题聚合"
        hint="同一个问题下你写过或收藏过的内容"
        empty="还没有出现「同一个问题下有多条内容」的情况。"
        hasContent={views.questionClusters.length > 0}
      >
        <ul className="ui-archive__clusters">
          {views.questionClusters.map((cluster) => <ClusterCard key={cluster.questionId} cluster={cluster} />)}
        </ul>
      </ArchiveBlock>

      <ArchiveBlock
        icon={TrendingUp}
        title="创作年轮"
        hint="按天统计的创作节奏与反响结构"
        empty="还没有可统计的创作时间。"
        hasContent={creationYear.total > 0 || responseStructure.length > 0}
      >
        <CreationYearPanel year={creationYear} />
        {responseStructure.length > 0 && (
          <ul className="ui-archive__responses">
            {responseStructure.slice(0, 12).map((item) => (
              <li key={item.url}>
                <a href={item.url} target="_blank" rel="noreferrer">
                  <span className="ui-archive__response-title">{item.title}</span>
                  <span className="ui-archive__response-meta">
                    {item.label !== undefined && (
                      <span className={`ui-archive__label ui-archive__label--${item.label}`}>{labelText(item.label)}</span>
                    )}
                    赞同 {formatCount(item.likeCount)} · 评论 {formatCount(item.commentCount)} · 收藏 {formatCount(item.favoriteCount)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </ArchiveBlock>

      <ArchiveBlock
        icon={Bookmark}
        title="收藏时间线"
        hint="按收藏月份排列，较早的单独列出以便重温"
        empty="还没有带收藏时间的条目。"
        hasContent={collectionTimeline.buckets.length > 0 || collectionTimeline.dormant.length > 0}
      >
        {collectionTimeline.buckets.length > 0 && (
          <ul className="ui-archive__timeline">
            {collectionTimeline.buckets.map((bucket) => (
              <li key={bucket.period}>
                <span className="ui-archive__period">{bucket.period}</span>
                <span className="ui-archive__period-count">{bucket.count} 条</span>
              </li>
            ))}
          </ul>
        )}
        {collectionTimeline.dormant.length > 0 && (
          <div className="ui-archive__dormant">
            <h4>收藏超过 30 天</h4>
            <ul>
              {collectionTimeline.dormant.slice(0, 8).map((item) => (
                <li key={item.id}><CollectionEntryLink item={item} /></li>
              ))}
            </ul>
          </div>
        )}
      </ArchiveBlock>

      <ArchiveBlock
        icon={Sparkles}
        title="关注圈层"
        hint="按粉丝数分层，并统计简介里的高频词"
        empty="还没有关注数据。"
        hasContent={followeeTiers.some((tier) => tier.count > 0)}
      >
        <ul className="ui-archive__tiers">
          {followeeTiers.map((tier) => <TierRow key={tier.tier} tier={tier} />)}
        </ul>
        {headlineKeywords.length > 0 && (
          <div className="ui-archive__keywords">
            {headlineKeywords.map((keyword) => (
              <span key={keyword.keyword} title={keyword.sampleNames.join('、')}>
                {keyword.keyword} <small>{keyword.count}</small>
              </span>
            ))}
          </div>
        )}
      </ArchiveBlock>
    </div>
  )
}

function ArchiveNotice({ truncated, persistent, stale, syncedAt, counts }: {
  readonly truncated: PersonalArchive['truncated']
  readonly persistent: boolean
  readonly stale: boolean
  readonly syncedAt: string
  readonly counts: PersonalArchive['counts']
}) {
  const clipped: string[] = []
  if (truncated.creations) clipped.push('创作')
  if (truncated.followees) clipped.push('关注')
  if (truncated.favlistContents) clipped.push('收藏夹内容')
  return (
    <div className="ui-archive__notice">
      <p>
        {stale ? '知乎本次未能返回新数据，以下为上一次同步于 ' : '本次档案同步于 '}
        {formatSyncedAt(syncedAt)} 的档案，共 {counts.creations} 篇创作、{counts.collections} 条近期收藏、
        {counts.followees} 位关注、{counts.favlists} 个收藏夹。
      </p>
      {stale && (
        <p className="ui-archive__warn">展示的是上一次同步结果，可能在知乎侧已有变化。</p>
      )}
      {clipped.length > 0 && (
        <p className="ui-archive__warn">
          {clipped.join('、')}已达本次同步上限，以下内容不是完整列表。
        </p>
      )}
      {!persistent && (
        <p className="ui-archive__warn">本次未能识别稳定身份，档案只在本会话内有效，退出后不会保留。</p>
      )}
      <p className="ui-archive__hint">内容为标题与摘要，判断请回原文核对。</p>
    </div>
  )
}

function ClusterCard({ cluster }: { readonly cluster: ArchiveQuestionCluster }) {
  const parts: string[] = []
  if (cluster.collectionCount > 0) parts.push(`收藏 ${cluster.collectionCount} 条`)
  if (cluster.creationCount > 0) parts.push(`创作 ${cluster.creationCount} 条`)
  return (
    <li className="ui-archive__cluster">
      <a className="ui-archive__cluster-head" href={cluster.questionUrl} target="_blank" rel="noreferrer">
        <span>{parts.join(' · ')}</span>
        <small>共 {cluster.total} 条</small>
      </a>
      <ul>
        {cluster.items.map((item) => (
          <li key={item.url}>
            <a href={item.url} target="_blank" rel="noreferrer">
              <span className={`ui-archive__kind ui-archive__kind--${item.kind}`}>
                {item.kind === 'creation' ? '创作' : '收藏'}
              </span>
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </li>
  )
}

function CreationYearPanel({ year }: { readonly year: PersonalArchive['views']['creationYear'] }) {
  if (year.total === 0) return null
  // 前端补窗口起点前的一周空位，让列按星期对齐；空格不携带数据。
  const lead = year.windowWeekday ?? 0
  const leadSlots = Array.from({ length: lead }, (_, index) => <span key={`lead-${index}`} className="ui-archive__heat-cell ui-archive__heat-cell--void" />)
  return (
    <div className="ui-archive__year">
      <div className="ui-archive__year-stats">
        <span><strong>{year.total}</strong> 篇</span>
        <span><strong>{year.activeDays}</strong> 个创作日</span>
        <span><strong>{year.longestStreak}</strong> 天最长连续</span>
      </div>
      <div className="ui-archive__heat" role="img" aria-label={`创作日历，共 ${year.activeDays} 个创作日`}>
        {leadSlots}
        {year.buckets.map((bucket) => (
          <span
            key={bucket.date}
            className="ui-archive__heat-cell"
            data-level={heatLevel(bucket.count)}
            title={`${bucket.date}：${bucket.count} 篇`}
          />
        ))}
      </div>
      {year.firstDate !== undefined && year.lastDate !== undefined && (
        <p className="ui-archive__year-range">{year.firstDate} 至 {year.lastDate}</p>
      )}
    </div>
  )
}

function TierRow({ tier }: { readonly tier: ArchiveFolloweeTier }) {
  return (
    <li className="ui-archive__tier">
      <span className="ui-archive__tier-name">{tierText(tier.tier)}</span>
      <span className="ui-archive__tier-count">{tier.count} 位</span>
      <span className="ui-archive__tier-samples">
        {tier.items.slice(0, 3).map((item) => item.name).join('、')}
        {tier.count > 3 && ' 等'}
      </span>
    </li>
  )
}

function CollectionEntryLink({ item }: { readonly item: ArchiveCollectionEntry }) {
  return (
    <a href={item.url} target="_blank" rel="noreferrer">
      {item.title}
      {item.favTime !== undefined && <small>{formatDay(item.favTime)}</small>}
    </a>
  )
}

function ArchiveBlock({ icon: Icon, title, hint, empty, hasContent, children }: {
  readonly icon: LucideIcon
  readonly title: string
  readonly hint: string
  readonly empty: string
  readonly hasContent: boolean
  readonly children: ReactNode
}) {
  return (
    <section className="ui-archive__block">
      <header className="ui-archive__block-head">
        <Icon size={15} aria-hidden />
        <h3>{title}</h3>
        <span>{hint}</span>
      </header>
      <div className="ui-archive__block-body">
        {hasContent ? children : <p className="ui-archive__empty">{empty}</p>}
      </div>
    </section>
  )
}

function labelText(label: ArchiveResponseLabel): string {
  if (label === 'discussion') return '评论居多'
  if (label === 'reference') return '收藏居多'
  return '赞同居多'
}

function tierText(tier: ArchiveFolloweeTier['tier']): string {
  if (tier === 'large') return '十万粉以上'
  if (tier === 'peer') return '一万至十万粉'
  return '一万粉以下'
}

/** 热力等级：把当日篇数压到 1–4 档，避免单日高产把整张图拉平。 */
function heatLevel(count: number): number {
  if (count <= 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

function formatSyncedAt(iso: string): string {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return iso
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
}

function formatDay(iso: string): string {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return ''
  return `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`
}
