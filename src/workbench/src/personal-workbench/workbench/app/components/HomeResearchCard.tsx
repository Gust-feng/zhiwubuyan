import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, FileText, ScanSearch } from 'lucide-react'
import type { TaskSummary } from '@contracts/research'
import { fetchResearchTasks, isTerminalStatus } from '../../../../features/deep-research/research-client'
import { taskDayLabel, taskStageText } from '../../../../features/deep-research/research-projection'
import type { WorkbenchView } from '../../../../workbench/navigation-state'
import './home-research-card.css'

interface HomeResearchCardProps {
  onNavigate?: (view: WorkbenchView) => void
  onOpenTask?: (taskId: string) => void
}

const RECENT_TASK_LIMIT = 20

/** 只投影最近任务；查询缓存与后台刷新交给既有 QueryClient。 */
export function HomeResearchCard({ onNavigate, onOpenTask }: HomeResearchCardProps) {
  const query = useQuery({
    queryKey: ['research-tasks', 'recent', RECENT_TASK_LIMIT],
    queryFn: ({ signal }) => fetchResearchTasks(RECENT_TASK_LIMIT, 0, signal),
    refetchInterval: (state) => state.state.data?.some((task) => !isTerminalStatus(task.status)) ? 3_000 : 15_000,
    retry: false,
  })
  const tasks = query.data ?? []
  const running = tasks.filter((task) => !isTerminalStatus(task.status))
  const completed = tasks.filter((task) => task.status === 'completed')
  const latest = tasks[0]
  const hasResearch = running.length > 0 || completed.length > 0
  const showEmpty = query.isSuccess && tasks.length === 0

  return (
    <section className="ui-research-card" aria-label="深度研究" aria-busy={query.isPending}>
      <header className="ui-research-card__head">
        <ScanSearch size={17} className="ui-research-card__glyph" aria-hidden />
        <h2>深度研究</h2>
        {onNavigate && !showEmpty && (
          <button className="ui-research-card__link" type="button" onClick={() => onNavigate('ask')}>
            进入研究 <ArrowUpRight size={13} aria-hidden />
          </button>
        )}
      </header>

      {query.isPending && <p className="ui-research-card__notice" role="status">正在读取研究…</p>}
      {query.isError && (
        <div className="ui-research-card__error" role="alert">
          <span>{query.data ? '研究状态更新失败，当前显示上次读取的内容。' : '暂时无法读取研究。'}{query.error.message}</span>
          <button className="ui-research-card__link" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {query.isFetching ? '重试中…' : '重试'}
          </button>
        </div>
      )}
      {showEmpty && (
        <div className="ui-research-card__empty">
          <div className="ui-research-card__empty-mark" aria-hidden><ScanSearch size={28} strokeWidth={1.4} /></div>
          <div className="ui-research-card__empty-copy">
            <h3>还没有深度研究</h3>
            <p>从一个值得追问的问题开始，研究进展和报告会留在这里。</p>
          </div>
          {onNavigate && (
            <button className="ui-research-card__start" type="button" onClick={() => onNavigate('ask')}>
              开始研究 <ArrowUpRight size={14} aria-hidden />
            </button>
          )}
        </div>
      )}
      {hasResearch && (
        <div className={`ui-research-card__body${running.length > 0 && completed.length > 0 ? ' is-split' : ''}`}>
          {running.length > 0 && <ResearchDeck tasks={running} label="进行中" onOpenTask={onOpenTask} />}
          {completed.length > 0 && (
            <ResearchDeck
              tasks={completed}
              label="最近完成"
              onOpenTask={onOpenTask}
            />
          )}
        </div>
      )}
      {!hasResearch && latest && (
        <div className="ui-research-card__body">
          <ResearchDeck tasks={[latest]} label="最近研究" onOpenTask={onOpenTask} />
        </div>
      )}
      {hasResearch && latest && isTerminalStatus(latest.status) && latest.status !== 'completed' && (
        <div className="ui-research-card__outcome">
          <span>最近一次研究{taskStageText(latest.status, latest.stage)}，已保留研究记录。</span>
          {onOpenTask && <button className="ui-research-card__link" type="button" onClick={() => onOpenTask(latest.id)}>查看记录</button>}
        </div>
      )}
    </section>
  )
}

interface ResearchDeckProps {
  tasks: readonly TaskSummary[]
  label: string
  onOpenTask?: (taskId: string) => void
}

/** 用任务 ID 保留翻阅位置，轮询插入新报告时不切走正在看的卡片。 */
function ResearchDeck({ tasks, label, onOpenTask }: ResearchDeckProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const index = Math.max(0, tasks.findIndex((task) => task.id === selectedId))
  const task = tasks[index]
  const active = !isTerminalStatus(task.status)
  const completed = task.status === 'completed'
  const action = active ? '查看进展' : completed && task.reportId ? '阅读报告' : '查看研究'

  return (
    <section className="ui-research-deck" aria-label={label}>
      <div className="ui-research-deck__head">
        <h3><span className={`ui-research-deck__dot${active ? ' is-active' : completed ? ' is-completed' : ''}`} aria-hidden />{label}</h3>
      </div>
      <div className="ui-research-deck__stack" data-depth={Math.min(tasks.length - 1, 2)}>
        <button
          className={`ui-research-deck__sheet${active ? ' is-active' : ''}`}
          type="button"
          disabled={!onOpenTask}
          onClick={() => onOpenTask?.(task.id)}
          aria-label={`${action}：${task.question}`}
        >
          <span className="ui-research-deck__meta">
            <span className={`ui-research-deck__status${active ? ' is-active' : completed ? ' is-completed' : ''}`}>
              {completed ? <Check size={13} aria-hidden /> : <FileText size={13} aria-hidden />}
              {taskStageText(task.status, task.stage)}
            </span>
            <span>{taskDayLabel(active ? task.createdAt : task.endedAt)}{active ? ' 开始' : ''}</span>
          </span>
          <span className="ui-research-deck__question" title={task.question}>{task.question}</span>
          <span className="ui-research-deck__foot">
            <span>{task.sourceCount} 个来源</span>
            <span className="ui-research-deck__action">{action}<ArrowUpRight size={14} aria-hidden /></span>
          </span>
        </button>
      </div>
      {tasks.length > 1 && (
        <nav className="ui-research-deck__pager" aria-label={`${label}卡片切换`}>
          <span className="ui-research-deck__count">{active ? '进行中' : '最近'} {tasks.length} 项研究</span>
          <button type="button" aria-label={`上一项${label}研究`} disabled={index === 0} onClick={() => setSelectedId(tasks[index - 1].id)}><ChevronLeft size={15} aria-hidden /></button>
          <span className="ui-research-deck__position" aria-live="polite" aria-atomic="true">{index + 1} / {tasks.length}</span>
          <button type="button" aria-label={`下一项${label}研究`} disabled={index === tasks.length - 1} onClick={() => setSelectedId(tasks[index + 1].id)}><ChevronRight size={15} aria-hidden /></button>
        </nav>
      )}
    </section>
  )
}
