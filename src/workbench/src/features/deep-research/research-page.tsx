import { useState } from 'react';
import { ResearchWorkspace } from './research-workspace';
import { ResearchSeeds } from './research-seeds';
import { EMPTY_RESEARCH, projectResearch } from './research-projection';
import { researchReportMarkdownUrl } from './research-client';
import { getDefaultResearchTier, getDefaultResearchWebSupplement } from './research-preference';
import { useDeepResearch } from './use-deep-research';
import type { ResearchViewModel } from './research-view-model';

/** 深度研究真实容器：提交问题、轮询进度、查看来源与报告，全部走本地研究后端。 */
export function ResearchPage({ taskId }: { taskId?: string | null }) {
  const [draft, setDraft] = useState('');
  // 初始值取用户的研究偏好；单次研究仍可在入口覆盖。
  const [allowWeb, setAllowWeb] = useState(getDefaultResearchWebSupplement);
  const [tier, setTier] = useState<'pro' | 'ultra'>(getDefaultResearchTier);
  const task = useDeepResearch(taskId);

  const research = task.detail
    ? projectResearch({ detail: task.detail, sources: task.sources, report: task.report, now: task.now })
    : task.submitting
      ? pendingResearch(draft)
      : EMPTY_RESEARCH;

  return (
    <div className="dr-live">
      {task.error && task.errorCode !== "ULTRA_DESKTOP_ONLY" ? (
        <p className="dr-live__error" role="alert">
          研究服务未响应：{task.error}
        </p>
      ) : null}
      <ResearchWorkspace
        research={research}
        draft={draft}
        allowWeb={allowWeb}
        tier={tier}
        ultraLocked={task.errorCode === 'ULTRA_DESKTOP_ONLY'}
        onTierChange={setTier}
        submitting={task.submitting}
        onDraftChange={setDraft}
        onWebChange={setAllowWeb}
        onStart={() => void task.submit(draft, allowWeb, tier, crypto.randomUUID())}
        onStop={() => void task.cancel()}
        onNew={(keepQuestion) => {
          task.reset();
          if (!keepQuestion) setDraft('');
        }}
        reportMarkdownUrl={task.detail?.reportId ? researchReportMarkdownUrl(task.detail.id) : undefined}
        seedPanel={(pick) => <ResearchSeeds onPick={pick} />}
        startError={task.error ?? null}
      />
    </div>
  );
}

/** 提交后首个计划生成前的占位视图：问题先行，计划标注为生成中。 */
function pendingResearch(question: string): ResearchViewModel {
  const trimmed = question.trim();
  return {
    ...EMPTY_RESEARCH,
    scene: 'researching',
    question: trimmed,
    title: trimmed,
    activityLabel: '正在建立研究任务',
    elapsedLabel: '0 秒',
  };
}
