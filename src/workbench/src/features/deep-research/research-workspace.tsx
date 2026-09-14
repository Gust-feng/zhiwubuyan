import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, BookOpen, Check, ChevronDown, ListChecks, Lock, PanelRight, Plus, Search, SlidersHorizontal, Sparkles, Square } from 'lucide-react';
import { kanshanDirector } from '@ui/components/kanshan-mascot/kanshan-director';
import { handleComposerEnter } from '@ui/components/entry-surface/entry-composer-keys';
import { StreamingRichText } from '@ui/components/rich-text';
import { ResearchInspector, type ResearchInspectorTab } from './research-inspector';
import { ResearchReport } from './research-report';
import type { ResearchViewModel } from './research-view-model';
import './research-workspace.css';

/** 深度研究结果态：进行中的计划、报告、快答与详情面板。
 *  提问入口不在这里——它由共享入口外壳的输入卡格承载，见 ResearchEntryComposer。 */
export function ResearchWorkspace({ research, submitting, onStop, onNew, reportMarkdownUrl }: {
  research: ResearchViewModel;
  submitting: boolean;
  onStop: () => void;
  onNew: (keepQuestion?: boolean) => void;
  reportMarkdownUrl?: string;
}) {
  const [inspector, setInspector] = useState<'auto' | 'open' | 'closed'>('auto');
  const [tab, setTab] = useState<ResearchInspectorTab>('activity');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const detailsButtonRef = useRef<HTMLButtonElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const active = research.scene === 'researching' || research.scene === 'writing';

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

  return (
    <section className="dr-workspace" aria-label="深度研究工作区">
      <header className="dr-toolbar">
        <div className="dr-toolbar__actions">
          <button type="button" className="dr-button" onClick={() => onNew()}><Plus size={14} /><span>新研究</span></button>
          {research.tier !== 'pro' && <button type="button" className="dr-icon-button" ref={detailsButtonRef} onClick={() => openInspector(tab, selectedSourceId)} aria-label="查看研究活动与来源" title="研究活动与来源"><PanelRight size={18} /></button>}
        </div>
      </header>
      <div className="dr-layout" data-inspector={research.tier === 'pro' ? 'closed' : inspector}>
        <div className="dr-main">
          <div className="dr-main__content">
            <div className="dr-question"><span className="dr-kicker">研究问题</span><p>{research.question}</p></div>
            {research.tier === 'pro' ? (
              <QuickAnswerBlock research={research} active={active} onStop={onStop} onRetry={() => onNew(true)} />
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
            {research.tier !== 'pro' && <p className="dr-main__note"><BookOpen size={13} />研究不止于一种观点，也保留结论成立的条件。</p>}
          </div>
          {research.tier !== 'pro' && <div className="dr-main__footer"><span>每个判断，都有来路。</span><button type="button" className="dr-text-button" onClick={() => openInspector('sources')}>查看 {research.sources.length} 个来源<ArrowUp size={12} /></button></div>}
        </div>
        {research.tier !== 'pro' && <div className="dr-inspector-slot" ref={inspectorRef} tabIndex={-1} aria-label="研究详情面板" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeInspector(); } }}>
          <button type="button" className="dr-mobile-back dr-text-button" onClick={closeInspector}><ArrowLeft size={15} />返回研究</button>
          <ResearchInspector activities={research.activities} sources={research.sources} tab={tab} selectedSourceId={selectedSourceId} running={active} onTabChange={(nextTab) => { setTab(nextTab); setSelectedSourceId(null); }} onSelectSource={(id) => { setTab('sources'); setSelectedSourceId(id); }} onClose={closeInspector} />
        </div>}
      </div>
    </section>
  );
}

/** 深度研究的入口输入卡内容：输入区 + 参数条 + 不可用说明。
 *  卡片外框由共享入口外壳持有，这里只渲染卡内对象，所以外壳不重建、只有卡内被替换。
 *  聚焦与报错反馈交给常驻侧栏的看山，通过全局导演转发。 */
export function ResearchEntryComposer({ draft, tier, tiers, unavailableMessage, submitting, startError, focusSignal, onDraftChange, onTierChange, onStart }: {
  draft: string;
  tier: 'pro' | 'ultra';
  /** 本运行面可选的档位；网页端只有 Pro，本机面为 Pro 与 Ultra。 */
  tiers: readonly ('pro' | 'ultra')[];
  /** 研究服务端未就绪时的说明；为空表示可用。不可用时不发请求，先如实说明。 */
  unavailableMessage?: string | null;
  submitting: boolean;
  /** 提交 / 服务错误信号：非空时刘看山播放一次困惑反馈。 */
  startError?: string | null;
  /** 从建议卡填入问题后，请求把焦点交回输入框。 */
  focusSignal: number;
  onDraftChange: (value: string) => void;
  onTierChange: (value: 'pro' | 'ultra') => void;
  onStart: () => void;
}) {
  const [tierMenuOpen, setTierMenuOpen] = useState(false);
  const topicRef = useRef<HTMLTextAreaElement>(null);
  const tierSelectRef = useRef<HTMLDivElement>(null);
  const attentionCooldownUntil = useRef(0);
  const unavailable = typeof unavailableMessage === 'string' && unavailableMessage !== '';
  const triggerAttention = useCallback(() => {
    const now = Date.now();
    if (now < attentionCooldownUntil.current) return;
    attentionCooldownUntil.current = now + 8_000;
    kanshanDirector.gesture('attention');
  }, []);

  // 档位菜单：点外部或按 Esc 关闭，选择即生效并收起。
  useEffect(() => {
    if (!tierMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!tierSelectRef.current?.contains(event.target as Node)) setTierMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTierMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [tierMenuOpen]);

  // 提交或服务报错时给一次困惑反馈。
  useEffect(() => {
    if (startError) kanshanDirector.gesture('error');
  }, [startError]);
  useEffect(() => {
    if (focusSignal > 0) requestAnimationFrame(() => topicRef.current?.focus());
  }, [focusSignal]);

  /** 回车与主按钮共用同一条提交路：空输入把焦点交还输入框，服务未就绪时不发请求。 */
  function submitDraft() {
    // 输入为空时主按钮仍可点：把焦点交还输入框，比让主操作沉默更清楚。
    if (!draft.trim()) {
      topicRef.current?.focus();
      return;
    }
    // 研究服务端未就绪时不发请求：说明已经可见，再打一次只会换回同样的结论。
    if (unavailable) return;
    onStart();
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); submitDraft(); }}>
      <textarea ref={topicRef} id="dr-topic" aria-label="深度研究主题" placeholder="写下一个问题，或补充你在意的背景与范围。" rows={1} value={draft} onChange={(event) => onDraftChange(event.target.value)} onFocus={triggerAttention} onKeyDown={(event) => {
        // 回车即开始研究（与主按钮同一条路）；Ctrl/⌘+回车才是换行，输入法组词中不触发。
        handleComposerEnter(event, { value: draft, onValueChange: onDraftChange, onSubmit: submitDraft });
      }} />
      <div className="dr-composer__bar">
        <div className="dr-tier-select" ref={tierSelectRef}>
          <button type="button" className="dr-mode-select" aria-haspopup="listbox" aria-expanded={tierMenuOpen} aria-label="研究深度" onClick={() => setTierMenuOpen((open) => !open)}>
            <Sparkles size={14} aria-hidden />
            <span>研究深度</span>
            <span className="dr-mode-select__value">{tier === 'pro' ? 'Pro' : 'Ultra'}</span>
            <ChevronDown size={13} aria-hidden />
          </button>
          {tierMenuOpen && (
            <ul className="dr-tier-menu" role="listbox" aria-label="研究深度">
              {tiers.map((value) => (
                <li key={value} role="option" aria-selected={tier === value}>
                  <button type="button" onClick={() => { onTierChange(value); setTierMenuOpen(false); }}>
                    <span>{value === 'pro' ? 'Pro' : 'Ultra'}</span>
                    {tier === value && <Check size={14} aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" className="entry-primary-button" disabled={submitting || unavailable}><span>{submitting ? (tier === 'pro' ? '正在研究…' : '提交中…') : '开始研究'}</span><ArrowUp size={16} aria-hidden /></button>
      </div>
      {unavailable ? (
        <p className="dr-tier__lock" role="alert">
          <Lock size={12} aria-hidden />
          <span>{unavailableMessage}</span>
        </p>
      ) : null}
    </form>
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

function QuickAnswerBlock({ research, active, onStop, onRetry }: {
  research: ResearchViewModel;
  active: boolean;
  onStop: () => void;
  onRetry: () => void;
}) {
  const content = research.answer?.content ?? '';
  const label = active ? research.activityLabel : research.scene === 'completed' ? '研究已完成' : research.scene === 'cancelled' ? '已停止' : '研究未完成';
  return (
    <section className="dr-answer" aria-label="Pro 研究回答" aria-busy={active}>
      <div className="dr-answer__status" role="status"><Sparkles size={15} /><span>{label}</span></div>
      <p className="dr-answer__strip">知乎直答生成内容 · 未附原始来源</p>
      {content && <div className="dr-answer__body"><StreamingRichText text={content} live={active} /></div>}
      {active
        ? <button type="button" className="dr-text-button" onClick={onStop}><Square size={13} />停止生成</button>
        : research.scene !== 'completed' && <button type="button" className="dr-text-button" onClick={onRetry}><ArrowLeft size={13} />返回问题</button>}
    </section>
  );
}
