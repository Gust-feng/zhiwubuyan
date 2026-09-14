import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Check, FileText, Globe, ListChecks, Search, Waypoints, X } from 'lucide-react';
import { ResearchPlanItems } from '@ui/components/research-plan-items';
import type { ResearchActivityView, ResearchPlanItemView, ResearchSourceView } from './research-view-model';

export type ResearchInspectorTab = 'activity' | 'sources' | 'plan';

const ACTIVITY_ICONS = { planning: ListChecks, searching: Search, reading: BookOpen, analyzing: Waypoints, writing: FileText };
const SOURCE_KINDS = { answer: '知乎回答', article: '知乎文章', web: '全网来源' };

export function ResearchInspector({ activities, sources, plan, tab, selectedSourceId, running, onTabChange, onSelectSource, onClose }: {
  activities: readonly ResearchActivityView[];
  sources: readonly ResearchSourceView[];
  /** 有子问题时提供：面板多一个「研究要点」页，展示编排拆出的子问题与取证状态。 */
  plan?: readonly ResearchPlanItemView[];
  tab: ResearchInspectorTab;
  selectedSourceId: string | null;
  running: boolean;
  onTabChange: (tab: ResearchInspectorTab) => void;
  onSelectSource: (id: string | null) => void;
  onClose: () => void;
}) {
  const selectedSource = sources.find((source) => source.id === selectedSourceId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sourceListRef = useRef<HTMLDivElement>(null);
  const lastSourceId = useRef<string | null>(null);
  const showPlan = plan !== undefined && plan.length > 0;

  useEffect(() => {
    if (selectedSourceId) headingRef.current?.focus();
    else if (lastSourceId.current) {
      const buttons = sourceListRef.current?.querySelectorAll<HTMLButtonElement>('[data-source-id]');
      Array.from(buttons ?? []).find((button) => button.dataset.sourceId === lastSourceId.current)?.focus();
    }
    lastSourceId.current = selectedSourceId;
  }, [selectedSourceId]);

  // 当前活动优先落在仍有查询在进行的活动上；都没有时退到最后一行。
  const currentActivityId = running ? findCurrentActivityId(activities) : null;

  return (
    <aside className="dr-inspector" aria-label="研究详情">
      <div className="dr-inspector__header">
        <div className="dr-inspector__heading"><span className="dr-kicker">RESEARCH NOTES</span><h2>沿着来路，展开研究</h2></div>
        <button className="dr-icon-button" type="button" onClick={onClose} aria-label="关闭研究详情，返回研究" title="关闭研究详情"><X size={17} /></button>
      </div>
      <div className="dr-inspector__tabs" role="group" aria-label="研究详情分类">
        {showPlan && <button type="button" aria-pressed={tab === 'plan'} onClick={() => onTabChange('plan')}>研究要点 <span>{plan.length}</span></button>}
        <button type="button" aria-pressed={tab === 'activity'} onClick={() => onTabChange('activity')}>研究活动</button>
        <button type="button" aria-pressed={tab === 'sources'} onClick={() => onTabChange('sources')}>来源 <span>{sources.length}</span></button>
      </div>
      <div className="dr-inspector__scroll" ref={sourceListRef}>
        {tab === 'plan' && showPlan ? (
          <ResearchPlanItems items={plan} className="dr-inspector__plan" />
        ) : tab === 'activity' ? (
          <ol className="dr-timeline">
            {activities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} sources={sources} current={activity.id === currentActivityId} onSelectSource={onSelectSource} />
            ))}
          </ol>
        ) : selectedSource ? (
          <section className="dr-source-detail">
            <button type="button" className="dr-text-button" onClick={() => onSelectSource(null)}><ArrowLeft size={14} />全部来源</button>
            <div className="dr-source-detail__kind"><SourceMark kind={selectedSource.kind} />{SOURCE_KINDS[selectedSource.kind]}</div>
            <h3 ref={headingRef} tabIndex={-1}>{selectedSource.title}</h3>
            <div className="dr-source-detail__byline">{selectedSource.author}<br />{selectedSource.dateLabel}</div>
            <p className="dr-source-detail__context">{selectedSource.context}</p>
            <div className="dr-source-detail__excerpt"><span className="dr-kicker">资料摘要</span><p>{selectedSource.excerpt}</p></div>
            {selectedSource.url ? (
              <a className="dr-button" href={selectedSource.url} target="_blank" rel="noreferrer">查看原文<ArrowUpRight size={14} /></a>
            ) : <div className="dr-source-detail__unavailable">上游未返回可打开的原文链接</div>}
          </section>
        ) : (
          <ol className="dr-source-list">
            {sources.map((source, index) => (
              <li key={source.id}>
                <button type="button" data-source-id={source.id} onClick={() => onSelectSource(source.id)}>
                  <span className="dr-source-list__number">{index + 1}</span>
                  <span className="dr-source-list__content"><span className="dr-source-list__title">{source.title}</span><span className="dr-source-list__meta">{SOURCE_KINDS[source.kind]} · {source.author}</span><span className="dr-source-list__context">{source.context}</span></span>
                  <ArrowUpRight size={14} className="dr-source-list__arrow" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="dr-inspector__footer"><BookOpen size={13} /> {sources.length} 个来源</div>
    </aside>
  );
}

function ActivityRow({ activity, sources, current, onSelectSource }: {
  activity: ResearchActivityView;
  sources: readonly ResearchSourceView[];
  current: boolean;
  onSelectSource: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const linkedSources = activity.sourceIds.flatMap((id) => sources.find((source) => source.id === id) ?? []);
  const visibleSources = expanded ? linkedSources : linkedSources.slice(0, 2);
  const Icon = ACTIVITY_ICONS[activity.kind];

  return (
    <li className="dr-activity" data-current={current}>
      <span className="dr-activity__icon" aria-hidden><Icon size={15} /></span>
      <div className="dr-activity__body">
        <div className="dr-activity__title"><h3>{activity.title}</h3><time>{activity.time}</time></div>
        {activity.summary && <p>{activity.summary}</p>}
        {activity.queries && activity.queries.length > 0 && (
          <ul className="dr-queries">
            {activity.queries.map((query) => (
              <li key={query.id} data-status={query.status}>
                <QueryGlyph status={query.status} />
                <span>{query.text}</span>
                <span className="dr-query__meta">{query.channel === 'web' ? '全网' : '知乎'} · {query.status === 'pending' ? '检索中' : query.status === 'failed' ? '检索失败' : `命中 ${query.resultCount ?? 0} 个来源`}</span>
              </li>
            ))}
          </ul>
        )}
        {linkedSources.length > 0 && <div className="dr-source-chips">
          {visibleSources.map((source) => (
            <button className="dr-source-chip" type="button" key={source.id} onClick={() => onSelectSource(source.id)} title={source.title + ' · ' + source.author}>
              <SourceMark kind={source.kind} /><span>{source.title}</span>
            </button>
          ))}
          {linkedSources.length > 2 && <button className="dr-source-more" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? '收起来源' : `再显示 ${linkedSources.length - 2} 个`}</button>}
        </div>}
        {current && <span className="dr-activity__current"><span className="dr-live-dot" />当前活动</span>}
      </div>
    </li>
  );
}

function findCurrentActivityId(activities: readonly ResearchActivityView[]): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity.queries?.some((query) => query.status === 'pending')) return activity.id;
  }
  return activities[activities.length - 1]?.id ?? null;
}

function QueryGlyph({ status }: { status: 'pending' | 'succeeded' | 'failed' }) {
  if (status === 'succeeded') return <Check size={11} aria-label="检索成功" />;
  if (status === 'failed') return <X size={11} aria-label="检索失败" />;
  return <span className="dr-live-dot" aria-label="检索中" />;
}

function SourceMark({ kind }: { kind: ResearchSourceView['kind'] }) {
  return <span className="dr-source-mark" aria-hidden>{kind === 'web' ? <Globe size={10} /> : '知'}</span>;
}
