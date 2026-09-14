import { ArrowRight, Bookmark, FileText, Network, RefreshCw, UsersRound, type LucideIcon } from 'lucide-react'
import { formatCount } from './home-feeds'
import type {
  ArchiveCollectionEntry,
  ArchiveFolloweeTier,
  ArchiveQuestionCluster,
  ArchiveResponseItem,
  PersonalArchive,
} from './use-personal-archive'
import './personal-archive.css'

/** 个人档案只重排既有 DTO；同步、聚合和统计规则仍由应用层拥有。 */
export function PersonalArchiveView({ archive, onRefresh }: {
  readonly archive: PersonalArchive
  readonly onRefresh: () => void
}) {
  const { views, counts } = archive
  return (
    <div className="ui-archive">
      <ProfileHero archive={archive} />
      <FootprintSection archive={archive} />
      <div className="ui-archive__panels" aria-label="个人档案摘要">
        <CreationPanel count={counts.creations} items={views.responseStructure} />
        <CollectionPanel count={counts.collections} timeline={views.collectionTimeline} />
        <FollowPanel count={counts.followees} tiers={views.followeeTiers} keywords={views.headlineKeywords} />
        <KnowledgePanel clusters={views.questionClusters} />
      </div>
      <ArchiveStatus archive={archive} onRefresh={onRefresh} />
    </div>
  )
}

function ProfileHero({ archive }: {
  readonly archive: PersonalArchive
}) {
  const profile = archive.profile
  const name = profile?.fullname ?? '我的知乎'
  return (
    <header className="ui-archive__hero">
      <div className="ui-archive__portrait" aria-hidden="true">
        {profile?.avatarUrl !== undefined && profile.avatarUrl !== ''
          ? <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" />
          : <span>{name.slice(0, 1)}</span>}
        <i className="ui-archive__presence" />
      </div>
      <h1>{name}</h1>
      <p>{profile?.headline ?? '保持好奇，长期阅读，慢慢变好。'}</p>
      <blockquote>「在别人的问题里，看到更大的世界。」<cite>知无不言</cite></blockquote>
    </header>
  )
}

function FootprintSection({ archive }: { readonly archive: PersonalArchive }) {
  const year = archive.views.creationYear
  const months = monthLabels(year.buckets.map((bucket) => bucket.date))
  const lead = year.windowWeekday ?? 0
  return (
    <section className="ui-archive__footprint" aria-labelledby="archive-footprint-title">
      <div className="ui-archive__footprint-head">
        <div>
          <h2 id="archive-footprint-title">知识足迹</h2>
          <p>这一年，你在知乎有 <strong>{year.activeDays}</strong> 个创作日</p>
        </div>
        <span>{formatYearRange(year.firstDate, year.lastDate)}</span>
      </div>

      {year.total === 0 ? (
        <p className="ui-archive__empty">还没有可统计的创作时间。</p>
      ) : (
        <div className="ui-archive__heatmap-scroll">
          <div className="ui-archive__heatmap-layout">
            <div className="ui-archive__weekdays" aria-hidden>
              <span>周一</span><span>周三</span><span>周五</span><span>周日</span>
            </div>
            <div className="ui-archive__heatmap-track">
              <div className="ui-archive__months" aria-hidden>
                {months.map((month) => <span key={month}>{month}</span>)}
              </div>
              <div className="ui-archive__heat" role="img" aria-label={`创作日历，共 ${year.activeDays} 个创作日`}>
                {Array.from({ length: lead }, (_, index) => (
                  <span key={`lead-${index}`} className="ui-archive__heat-cell ui-archive__heat-cell--void" />
                ))}
                {year.buckets.map((bucket) => (
                  <span
                    key={bucket.date}
                    className="ui-archive__heat-cell"
                    data-level={heatLevel(bucket.count)}
                    title={`${bucket.date}：${bucket.count} 篇`}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="ui-archive__heatmap-foot">
            <div className="ui-archive__legend" aria-label="创作频率图例">
              <span><i data-level="1" />较少</span>
              <span><i data-level="2" />一般</span>
              <span><i data-level="4" />活跃</span>
            </div>
            <p>共 {year.total} 篇创作，最长连续创作 {year.longestStreak} 天。</p>
          </div>
        </div>
      )}
    </section>
  )
}

function CreationPanel({ count, items }: {
  readonly count: number
  readonly items: readonly ArchiveResponseItem[]
}) {
  const featured = items[0]
  return (
    <ArchivePanel icon={FileText} title="创作" subtitle="记录思考，分享见解" count={`${count} 篇`}>
      {featured === undefined ? <PanelEmpty>暂无公开创作。</PanelEmpty> : (
        <a className="ui-archive__creation" href={featured.url} target="_blank" rel="noreferrer">
          <strong>{featured.title}</strong>
          <p>赞同 {formatCount(featured.likeCount)} · 评论 {formatCount(featured.commentCount)} · 收藏 {formatCount(featured.favoriteCount)}</p>
          <span>打开这篇创作 <ArrowRight size={13} aria-hidden /></span>
        </a>
      )}
    </ArchivePanel>
  )
}

function CollectionPanel({ count, timeline }: {
  readonly count: number
  readonly timeline: PersonalArchive['views']['collectionTimeline']
}) {
  const items = collectionHighlights(timeline)
  return (
    <ArchivePanel icon={Bookmark} title="收藏" subtitle="好的想法，值得反复阅读" count={`${count} 条`}>
      {items.length === 0 ? <PanelEmpty>暂无近期收藏。</PanelEmpty> : (
        <ul className="ui-archive__compact-list">
          {items.map((item) => (
            <li key={item.id}>
              <a href={item.url} target="_blank" rel="noreferrer">
                <span>{item.title}</span>
                {item.favTime !== undefined && <small>{formatDay(item.favTime)}</small>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </ArchivePanel>
  )
}

function FollowPanel({ count, tiers, keywords }: {
  readonly count: number
  readonly tiers: readonly ArchiveFolloweeTier[]
  readonly keywords: PersonalArchive['views']['headlineKeywords']
}) {
  const people = tiers.flatMap((tier) => tier.items).slice(0, 5)
  return (
    <ArchivePanel icon={UsersRound} title="关注" subtitle="与有趣的人，一起看更大的世界" count={`${count} 人`}>
      {people.length === 0 ? <PanelEmpty>暂无关注数据。</PanelEmpty> : (
        <>
          <div className="ui-archive__people" aria-label="关注的人">
            {people.map((person) => (
              <a key={person.url} href={person.url} target="_blank" rel="noreferrer" title={person.name}>
                {person.avatarUrl !== undefined
                  ? <img src={person.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  : <span>{person.name.slice(0, 1)}</span>}
              </a>
            ))}
          </div>
          <p className="ui-archive__people-names">{people.slice(0, 3).map((person) => person.name).join('、')}</p>
          {keywords.length > 0 && (
            <div className="ui-archive__keywords">
              {keywords.slice(0, 5).map((keyword) => <span key={keyword.keyword}>{keyword.keyword}</span>)}
            </div>
          )}
        </>
      )}
    </ArchivePanel>
  )
}

function KnowledgePanel({ clusters }: { readonly clusters: readonly ArchiveQuestionCluster[] }) {
  const visible = clusters.slice(0, 5)
  return (
    <ArchivePanel icon={Network} title="知识脉络" subtitle="从同题内容，看见自己的知识连接" count={`${clusters.length} 组`}>
      {visible.length === 0 ? <PanelEmpty>还没有可串联的同题内容。</PanelEmpty> : (
        <div className="ui-archive__network" aria-label="同题聚合">
          <svg className="ui-archive__network-lines" viewBox="0 0 260 182" preserveAspectRatio="none" aria-hidden="true">
            <line x1="130" y1="91" x2="45" y2="24" />
            <line x1="130" y1="91" x2="214" y2="26" />
            <line x1="130" y1="91" x2="28" y2="153" />
            <line x1="130" y1="91" x2="220" y2="151" />
            <line x1="130" y1="91" x2="12" y2="91" />
          </svg>
          <span className="ui-archive__network-center">我</span>
          {visible.map((cluster, index) => (
            <a
              key={cluster.questionId}
              className={`ui-archive__network-node is-${index + 1}`}
              href={cluster.questionUrl}
              target="_blank"
              rel="noreferrer"
              title={cluster.items[0]?.title ?? `同题内容 ${index + 1}`}
            >
              {clusterLabel(cluster, index)}
            </a>
          ))}
        </div>
      )}
    </ArchivePanel>
  )
}

/** 节点展示真实同题内容的短标题，不用虚构的知识分类填充。 */
function clusterLabel(cluster: ArchiveQuestionCluster, index: number): string {
  const title = cluster.items[0]?.title.trim()
  if (title === undefined || title === '') return `同题 ${index + 1}`
  return title.length > 6 ? `${title.slice(0, 6)}…` : title
}

function ArchivePanel({ icon: Icon, title, subtitle, count, children }: {
  readonly icon: LucideIcon
  readonly title: string
  readonly subtitle: string
  readonly count: string
  readonly children: React.ReactNode
}) {
  return (
    <section className="ui-archive__panel">
      <header>
        <div><Icon size={18} aria-hidden /><h2>{title}</h2></div>
        <span>{count}</span>
        <p>{subtitle}</p>
      </header>
      <div className="ui-archive__panel-body">{children}</div>
    </section>
  )
}

function PanelEmpty({ children }: { readonly children: React.ReactNode }) {
  return <p className="ui-archive__panel-empty">{children}</p>
}

function ArchiveStatus({ archive, onRefresh }: {
  readonly archive: PersonalArchive
  readonly onRefresh: () => void
}) {
  const clipped: string[] = []
  if (archive.truncated.creations) clipped.push('创作')
  if (archive.truncated.followees) clipped.push('关注')
  if (archive.truncated.favlistContents) clipped.push('收藏夹内容')
  return (
    <footer className="ui-archive__status">
      {/* 只保留「是否复用旧数据」这个状态；不再显示同步时刻。 */}
      {archive.stale && <span>当前展示上次同步结果</span>}
      {clipped.length > 0 && <span>{clipped.join('、')}已达本次同步上限</span>}
      {!archive.persistent && <span>档案仅在本次会话内有效</span>}
      <button type="button" onClick={onRefresh}>
        <RefreshCw size={12} aria-hidden />
        重新同步
      </button>
    </footer>
  )
}

function collectionHighlights(timeline: PersonalArchive['views']['collectionTimeline']): ArchiveCollectionEntry[] {
  const recent = timeline.buckets.flatMap((bucket) => bucket.items)
  const unique = new Map<string, ArchiveCollectionEntry>()
  for (const item of [...recent, ...timeline.dormant]) unique.set(item.id, item)
  return [...unique.values()].slice(0, 3)
}

function monthLabels(dates: readonly string[]): string[] {
  const months: string[] = []
  for (const date of dates) {
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) continue
    const label = `${parsed.getMonth() + 1}月`
    if (months[months.length - 1] !== label) months.push(label)
  }
  return months
}

function heatLevel(count: number): number {
  if (count <= 0) return 0
  if (count <= 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

function formatYearRange(firstDate: string | undefined, lastDate: string | undefined): string {
  if (firstDate === undefined || lastDate === undefined) return '过去一年'
  const first = new Date(firstDate)
  const last = new Date(lastDate)
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return '过去一年'
  return `${first.getFullYear()} 年 ${first.getMonth() + 1} 月 – ${last.getMonth() + 1} 月`
}

function formatDay(iso: string): string {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return ''
  return `${time.getMonth() + 1}.${String(time.getDate()).padStart(2, '0')}`
}
