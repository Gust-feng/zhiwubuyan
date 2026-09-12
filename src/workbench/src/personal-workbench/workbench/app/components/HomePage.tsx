import { Flame } from 'lucide-react'
import type { WorkbenchView } from '../../../../workbench/navigation-state'
import { CoreCard, HomeMasthead, HomeSearchBar, HotRow, readHotItems, useAmbientGreeting } from './home-feeds'
import { HomeResearchCard } from './HomeResearchCard'
import { useCoreFeed } from './use-core-feed'
import './home-page.css'
import './workbench-views.css'

interface HomePageProps {
  onOpenSearch?: () => void
  onNavigate?: (view: WorkbenchView) => void
  onOpenResearchTask?: (taskId: string) => void
}

/** 首页通过一张动态卡片承接研究，再展示知乎热榜。
 *  数据全部来自本地研究后端与知乎上游；读不到就显示空态或失败原因，不填充占位内容。 */
export function HomePage({ onOpenSearch, onNavigate, onOpenResearchTask }: HomePageProps) {
  const greeting = useAmbientGreeting()
  const hot = useCoreFeed('/api/hot', readHotItems)

  return (
    <div className="ui-view">
      <div className="ui-view__frame">
        <div className="ui-home__masthead-wrap">
          <HomeMasthead lead={greeting.lead} tail={greeting.tail} />
        </div>
        <HomeSearchBar onOpenSearch={onOpenSearch} />

        <div className="ui-home__content">
          <HomeResearchCard onNavigate={onNavigate} onOpenTask={onOpenResearchTask} />

          <CoreCard
            icon={Flame}
            name="知乎热榜"
            role="正在讨论"
            accent
            feed={hot}
            limit={6}
            renderItem={(item, index) => <HotRow item={item} rank={index + 1} />}
          />
        </div>
      </div>
    </div>
  )
}
