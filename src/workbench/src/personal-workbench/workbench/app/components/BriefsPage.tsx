import { FileText } from 'lucide-react'
import type { TaskSummary } from '@contracts/research'
import { fetchResearchTasks } from '../../../../features/deep-research/research-client'
import { taskDayLabel } from '../../../../features/deep-research/research-projection'
import { useCoreFeedLoader, type CoreFeedPage } from './use-core-feed'
import './workbench-views.css'

interface BriefsPageProps {
  onOpenResearchTask?: (taskId: string) => void
}

const TASK_PAGE_LIMIT = 50

/** 简报库：已完成并保存了报告的研究，点开回到报告、引用与来源。
 *  列表来自本地研究后端的任务接口；没有已完成研究时如实显示空态。 */
export function BriefsPage({ onOpenResearchTask }: BriefsPageProps) {
  const tasks = useCoreFeedLoader<TaskSummary>(loadCompletedTasks)
  const briefs = tasks.items.filter((task) => task.status === 'completed' && task.reportId !== null)

  return (
    <div className="ui-view">
      <div className="ui-view__frame">
        <div className="ui-view__head">
          <div>
            <h1 className="ui-view__lede">简报库</h1>
            <p className="ui-view__sub">
              {tasks.status === 'loading'
                ? '正在读取研究报告…'
                : tasks.status === 'error'
                  ? tasks.error ?? '研究报告读取失败。'
                  : `${briefs.length} 份研究报告 · 每一处结论都可追溯到具体来路。`}
            </p>
          </div>
          {tasks.status === 'error' && (
            <button className="ui-ask__submit" type="button" onClick={tasks.retry}>重试</button>
          )}
        </div>

        {tasks.status === 'ready' && briefs.length === 0 && (
          <p className="ui-view__sub">
            还没有已完成的研究。去「深度研究」开一个题，完成后报告会出现在这里。
          </p>
        )}

        <div className="ui-briefs__grid">
          {briefs.map((task) => (
            <button key={task.id} className="ui-brief" type="button" onClick={() => onOpenResearchTask?.(task.id)}>
              <div className="ui-brief__top">
                <FileText size={13} style={{ color: 'var(--ui-text-3)' }} aria-hidden />
                <span className="ui-brief__date">{taskDayLabel(task.endedAt)}</span>
              </div>
              <h2 className="ui-brief__title">{task.question}</h2>
              <div className="ui-brief__foot">
                <span className="ui-brief__foot-meta">{task.sourceCount} 个来源 · 打开报告与引用</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

async function loadCompletedTasks(signal: AbortSignal): Promise<CoreFeedPage<TaskSummary>> {
  return { items: await fetchResearchTasks(TASK_PAGE_LIMIT, 0, signal) }
}
