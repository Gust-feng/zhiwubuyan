import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowUp, BookOpen, Check, ChevronDown, ListChecks, Lock, PanelRight, Plus, Search, SlidersHorizontal, Sparkles, Square, Telescope } from 'lucide-react';
import { KanshanPerch } from '@ui/components/kanshan-mascot/KanshanPerch';
import type { KanshanMascotHandle } from '@ui/components/kanshan-mascot/KanshanMascot';
import { ResearchInspector, type ResearchInspectorTab } from './research-inspector';
import { ResearchReport } from './research-report';
import type { ResearchViewModel } from './research-view-model';
import './research-workspace.css';

export function ResearchWorkspace({ research, draft, allowWeb, tier, ultraLocked, onTierChange, submitting, onDraftChange, onWebChange, onStart, onStop, onNew, reportMarkdownUrl, seedPanel, startError = null }: {
  research: ResearchViewModel;
  draft: string;
  allowWeb: boolean;
  tier: 'pro' | 'ultra';
  ultraLocked: boolean;
  onTierChange: (value: 'pro' | 'ultra') => void;
  submitting: boolean;
  onDraftChange: (value: string) => void;
  onWebChange: (value: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  onNew: (keepQuestion?: boolean) => void;
  reportMarkdownUrl?: string;
  /** 提问入口上方的种子内容：由页面层注入，工作区只负责排在标题与提问卡片之间。
   *  用函数形式注入，是因为「填入之后把焦点交给输入框」只有工作区知道怎么做。 */
  seedPanel?: (pick: (question: string) => void) => ReactNode;
  /** 提交 / 服务错误信号：非空时刘看山播放一次困惑反馈。 */
  startError?: string | null;
}) {
  const [inspector, setInspector] = useState<'auto' | 'open' | 'closed'>('auto');
  const [tab, setTab] = useState<ResearchInspectorTab>('activity');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const detailsButtonRef = useRef<HTMLButtonElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const topicRef = useRef<HTMLTextAreaElement>(null);
  const active = research.scene === 'researching' || research.scene === 'writing';
  const idle = research.scene === 'idle';

  const mascotRef = useRef<KanshanMascotHandle>(null);
  const attentionCooldownUntil = useRef(0);
  const triggerAttention = useCallback(() => {
    const now = Date.now();
    if (now < attentionCooldownUntil.current) return;
    attentionCooldownUntil.current = now + 8_000;
    mascotRef.current?.gesture('attention');
  }, []);
  // 提交或服务报错时给一次困惑反馈（仅在起始输入区仍显示时可见）。
  useEffect(() => {
    if (startError) mascotRef.current?.gesture('error');
  }, [startError]);

  function openInspector(nextTab: ResearchInspectorTab = 'activity', sourceId: string | null = null) {
    setTab(nextTab);
    setSelectedSourceId(sourceId);
    setInspector('open');
    // The inspector replaces the main column on narrow layouts; keep keyboard focus with it.
    requestAnimationFrame(() => inspectorRef.current?.focus());
  }

  function closeInspector() {
    setInspector('closed');
    requestAnimationFrame(() => detailsButtonRef.current?.focus());
  }

  /** 从种子内容里挑一条：填入提问框，并把焦点交给它——下一步是补充或直接提交，不该再点一次。 */
  function pickSeed(question: string) {
    onDraftChange(question);
    requestAnimationFrame(() => topicRef.current?.focus());
  }

  return (
    <section className="dr-workspace" aria-label="深度研究工作区">
      {!idle && (
        <header className="dr-toolbar">
          <div className="dr-toolbar__actions">
            <button type="button" className="dr-button" onClick={() => onNew()}><Plus size={14} /><span>新研究</span></button>
            <button type="button" className="dr-icon-button" ref={detailsButtonRef} onClick={() => openInspector(tab, selectedSourceId)} aria-label="查看研究活动与来源" title="研究活动与来源"><PanelRight size={18} /></button>
          </div>
        </header>
      )}
      {idle ? (
        <div className="dr-start">
          <div className="dr-start__content">
            <div className="dr-start__head">
              <span className="dr-start__emblem" aria-hidden><Telescope size={54} /></span>
              <h1>你想深入了解什么？</h1>
            </div>
            {seedPanel?.(pickSeed)}
            <form className="dr-composer" onSubmit={(event) => {
              event.preventDefault();
              // 输入为空时主按钮仍可点：把焦点交还输入框，比让主操作沉默更清楚。
              if (!draft.trim()) {
                topicRef.current?.focus();
                return;
              }
              onStart();
            }}>
              <KanshanPerch ref={mascotRef} perchId="composer" className="dr-composer__mascot" />
              <textarea ref={topicRef} id="dr-topic" aria-label="深度研究主题" placeholder="写下一个问题，或补充你在意的背景与范围。" rows={1} value={draft} onChange={(event) => onDraftChange(event.target.value)} onFocus={triggerAttention} onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  onStart();
                }
              }} />
              <div className="dr-composer__bar">
                <label className="dr-mode-select" title="Ultra 档仅在桌面版可用">
                  <Sparkles size={14} aria-hidden />
                  <span>研究深度</span>
                  <select value={tier} onChange={(event) => onTierChange(event.target.value as 'pro' | 'ultra')} aria-label="研究深度">
                    <option value="pro">Pro</option>
                    <option value="ultra">Ultra</option>
                  </select>
                  <ChevronDown size={13} aria-hidden />
                </label>
                <button type="button" className="dr-options-toggle" aria-pressed={allowWeb} aria-label="全网补证" title="全网补证：在知乎公开讨论之外补充可核查的全网来源" onClick={() => onWebChange(!allowWeb)}><SlidersHorizontal size={22} aria-hidden /></button>
                <button type="submit" className="dr-primary-button" disabled={submitting}><span>{submitting ? (tier === 'pro' ? '正在研究…' : '提交中…') : '开始研究'}</span><ArrowUp size={16} aria-hidden /></button>
              </div>
              {ultraLocked && tier === 'ultra' ? (
                <p className="dr-tier__lock" role="alert"><Lock size={12} />深度研究 Ultra 仅在桌面版可用；请下载桌面版，或先使用 Pro。</p>
              ) : null}
            </form>
          </div>
        </div>
      ) : (
        <div className="dr-layout" data-inspector={inspector}>
          <div className="dr-main">
            <div className="dr-main__content">
              <div className="dr-question"><span className="dr-kicker">研究问题</span><p>{research.question}</p></div>
              {research.scene === 'completed' && research.answer ? (
                <QuickAnswerBlock answer={research.answer} />
              ) : research.scene === 'completed' ? (
                reportMarkdownUrl ? (
                  <>
                    <ResearchReport research={research} markdownUrl={reportMarkdownUrl} onSelectSource={(id) => openInspector('sources', id)} />
                    <details className="dr-completed-plan"><summary><ListChecks size={15} />查看研究计划<ChevronDown size={14} /></summary><PlanItems research={research} /></details>
                  </>
                ) : <p className="dr-plan__outcome">{research.outcomeNote ?? '报告尚未保存。'}</p>
              ) : (
                <ResearchPlan research={research} active={active} submitting={submitting} onStop={onStop} onOpenActivity={() => openInspector('activity')} onOpenSources={() => openInspector('sources')} onNew={() => onNew(true)} />
              )}
              <p className="dr-main__note"><BookOpen size={13} />研究不止于一种观点，也保留结论成立的条件。</p>
            </div>
            <div className="dr-main__footer"><span>每个判断，都有来路。</span><button type="button" className="dr-text-button" onClick={() => openInspector('sources')}>查看 {research.sources.length} 个来源<ArrowUp size={12} /></button></div>
          </div>
          <div className="dr-inspector-slot" ref={inspectorRef} tabIndex={-1} aria-label="研究详情面板" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeInspector(); } }}>
            <button type="button" className="dr-mobile-back dr-text-button" onClick={closeInspector}><ArrowLeft size={15} />返回研究</button>
            <ResearchInspector activities={research.activities} sources={research.sources} tab={tab} selectedSourceId={selectedSourceId} running={active} onTabChange={(nextTab) => { setTab(nextTab); setSelectedSourceId(null); }} onSelectSource={(id) => { setTab('sources'); setSelectedSourceId(id); }} onClose={closeInspector} />
          </div>
        </div>
      )}
    </section>
  );
}

function ResearchPlan({ research, active, submitting, onStop, onOpenActivity, onOpenSources, onNew }: {
  research: ResearchViewModel;
  active: boolean;
  submitting: boolean;
  onStop: () => void;
  onOpenActivity: () => void;
  onOpenSources: () => void;
  onNew: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const stopped = research.scene === 'cancelled';
  const failed = research.scene === 'failed';
  const stopping = research.stopping === true;
  const planPending = active && research.plan.length === 0;
  const label = stopping ? '正在停止' : stopped ? '已停止' : failed ? '未完成' : research.scene === 'writing' ? '整理报告' : '研究中';

  return (
    <section className="dr-plan" aria-label="研究计划">
      <div className="dr-plan__header"><span className="dr-plan__symbol"><ListChecks size={18} /></span><span>研究计划{research.planVersion !== null ? <span className="dr-plan__version">v{research.planVersion}</span> : null}</span><span className="dr-state" data-scene={research.scene}>{active && <span className="dr-live-dot" />}{label}</span></div>
      <h1>{research.title}</h1>
      {planPending ? (
        <p className="dr-plan__pending"><span className="dr-live-dot" />正在拆解问题，生成研究计划…</p>
      ) : (
        <>
          <button className="dr-plan__disclosure" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><span>{expanded ? '收起计划' : `展开 ${research.plan.length} 项研究目标`}</span><ChevronDown size={13} data-expanded={expanded} /></button>
          {expanded && <PlanItems research={research} />}
        </>
      )}
      <div className="dr-plan__progress">
        <div className="dr-plan__current" role="status"><span>{research.activityLabel}</span><span>{research.elapsedLabel}</span></div>
        {research.usage && <UsageBlock usage={research.usage} />}
        {active && <div className="dr-indeterminate" role="progressbar" aria-label={label}><span /></div>}
        {(stopped || failed) && <p className="dr-plan__outcome">{research.outcomeNote ?? (stopped ? '研究已停止。下方仍可查看停止前收集的来源与活动。' : '研究未完成。已取得的材料仍可查看。')}</p>}
        <div className="dr-plan__actions">
          <button type="button" className="dr-text-button" onClick={onOpenActivity}><Search size={14} />{research.searchCount} 次搜索</button>
          <button type="button" className="dr-text-button" onClick={onOpenSources}><BookOpen size={14} />{research.sources.length} 个来源</button>
          {active ? <button type="button" className="dr-stop" disabled={stopping || submitting} onClick={onStop}><Square size={10} fill="currentColor" />{stopping ? '正在停止' : '停止研究'}</button> : <button type="button" className="dr-button dr-plan__restart" onClick={onNew}><Plus size={13} />以同一问题新建</button>}
        </div>
      </div>
    </section>
  );
}

function PlanItems({ research }: { research: ResearchViewModel }) {
  const stateNames = { complete: '已完成', active: '当前', pending: '待处理' };
  return <ol className="dr-plan__items">{research.plan.map((item) => <li key={item.id} data-state={item.state} data-closed={item.closed || undefined}><span className="dr-plan__check" role="img" aria-label={stateNames[item.state]}>{item.state === 'complete' ? <Check size={12} /> : item.state === 'active' ? <span /> : null}</span><span className="dr-plan__text">{item.title}</span>{item.priority === 'high' && !item.closed && <span className="dr-plan__priority">重点</span>}{item.tag && <span className="dr-plan__tag">{item.tag}</span>}</li>)}</ol>;
}

function UsageBlock({ usage }: { usage: NonNullable<ResearchViewModel['usage']> }) {
  const items = [
    { label: '检索', value: usage.search },
    { label: '推理', value: usage.model },
    { label: '来源', value: usage.sources },
  ];
  return <div className="dr-usage">{items.map((item) => <span key={item.label} className="dr-usage__item">{item.label} {item.value.used}/{item.value.max}</span>)}</div>;
}

function QuickAnswerBlock({ answer }: { answer: NonNullable<ResearchViewModel['answer']> }) {
  return (
    <section className="dr-answer" aria-label="研究快答">
      <p className="dr-answer__strip">知乎直答生成内容 · 未附原始来源</p>
      <div className="dr-answer__body">{answer.content}</div>
      <p className="dr-answer__meta">模型 {answer.model} · 快答不替代 Ultra 的来源核验报告</p>
    </section>
  );
}
