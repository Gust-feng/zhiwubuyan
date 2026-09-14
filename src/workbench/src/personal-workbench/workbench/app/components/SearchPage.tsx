import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { FeedTime, HomeAskBar, SCOPE_OPTIONS, SearchFeedList } from './home-feed-view'
import { useHomeFeed, type HomeFeedScope, type HomeFeedType } from './use-home-feed'
import type { WorkbenchSearchRequest } from '../../../../workbench/navigation-state'
import './search-page.css'
import './workbench-views.css'

const TYPE_FILTERS: ReadonlyArray<{ key: HomeFeedType; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'answer', label: '回答' },
  { key: 'article', label: '文章' },
]

/**
 * 检索结果独立视图：检索词是页面主体，修订检索词、换范围、筛选与阅读结果都在本页完成，
 * 不再作为一块临时内容插回首页内容流。
 */
export function SearchPage({ request, onBack }: {
  readonly request: WorkbenchSearchRequest
  /** 检索只从首页发起：返回即回首页。 */
  readonly onBack: () => void
}) {
  const [topic, setTopic] = useState(request.query)
  const [draft, setDraft] = useState(request.query)
  const [scope, setScope] = useState<HomeFeedScope>(request.scope)
  const [type, setType] = useState<HomeFeedType>('all')
  const [refreshKey, setRefreshKey] = useState(0)
  const feed = useHomeFeed({ topic, scope, type, refreshKey })

  const submit = (): void => {
    const next = draft.trim()
    if (next === '') return
    // 同一检索词再次提交视为显式重试：跳过短时缓存重新取数。
    if (next === topic) setRefreshKey((current) => current + 1)
    else setTopic(next)
  }

  return (
    <div className="ui-view ui-search">
      <div className="ui-view__frame ui-search__frame">
        <header className="ui-search__header">
          <button type="button" className="ui-search__back" onClick={onBack} aria-label="返回首页">
            <ArrowLeft size={17} aria-hidden />
          </button>
          <div className="ui-search__heading">
            <h1 className="ui-search__title">{topic}</h1>
            <div className="ui-search__context">
              <span>{SCOPE_OPTIONS.find((option) => option.key === scope)?.label}</span>
              <FeedTime feed={feed} />
            </div>
          </div>
        </header>

        <HomeAskBar
          draft={draft}
          onDraftChange={setDraft}
          scope={scope}
          onScopeChange={setScope}
          onSubmit={submit}
        />

        <div className="ui-search__toolbar">
          <div className="uhf__filters" role="group" aria-label="内容类型">
            {TYPE_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className={type === filter.key ? 'uhf__filter is-active' : 'uhf__filter'}
                aria-pressed={type === filter.key}
                onClick={() => setType(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <SearchFeedList feed={feed} onRetry={() => setRefreshKey((current) => current + 1)} />
      </div>
    </div>
  )
}
