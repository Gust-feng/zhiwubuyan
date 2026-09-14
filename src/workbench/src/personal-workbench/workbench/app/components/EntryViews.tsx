import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Scale, Telescope } from 'lucide-react'
import { kanshanDirector } from '@ui/components/kanshan-mascot/kanshan-director'
import { EntrySurface, type EntryView } from '@ui/components/entry-surface/entry-surface'
import { EMPTY_RESEARCH, projectProProgress, projectResearch } from '@ui/features/deep-research/research-projection'
import { ResearchEntryComposer, ResearchWorkspace } from '@ui/features/deep-research/research-workspace'
import { researchReportMarkdownUrl } from '@ui/features/deep-research/research-client'
import { getDefaultResearchTier, getDefaultResearchWebSupplement } from '@ui/features/deep-research/research-preference'
import { ResearchSeeds } from '@ui/features/deep-research/research-seeds'
import { useDeepResearch } from '@ui/features/deep-research/use-deep-research'
import type { ResearchViewModel } from '@ui/features/deep-research/research-view-model'
import { ImageryComposer } from '@ui/features/concept-animation/imagery-composer'
import { ImageryGenerating } from '@ui/features/concept-animation/imagery-generating'
import { ImageryResult } from '@ui/features/concept-animation/imagery-result'
import { useImagery } from '@ui/features/concept-animation/use-imagery'
import { useWorkbenchSurface } from '../../../../workbench/surface'
import { useZhihuSession } from '@ui/workbench/zhihu-account'
import { useZhihuLogin } from '@ui/features/auth/login-request'
import type { VoicesRecency, VoicesScope, VoicesView } from '../../../../contracts/voices'
import { requestVoices } from './voices-client'
import { VoicesEntryComposer, VoicesSeeds } from './voices-slots'
import { VoicesResult, type VoicesStage } from './voices-result'
import { EntryStageTransition } from './entry-stage-transition'

/** 深度研究、众声与成象的入口编排。
 *  三页入口是同一套版式，所以由这一个常驻组件持有：三侧状态同时挂着，
 *  切换时外壳（EntrySurface）不重建，只有每一格里的对象就地交替。
 *  各自的结果态仍按原来的页面呈现；切到另一页时研究继续轮询、成象结果保留，回来不用重来。 */
export function EntryViews({ view, researchTaskId, voicesIssue }: {
  view: EntryView
  researchTaskId: string | null
  voicesIssue: string | null
}) {
  const { researchAvailable, researchUltraAvailable, conceptAnimationAvailable } = useWorkbenchSurface()
  // 查看不需要登录：页面结构、输入框与入口都照常渲染。
  // 只在真正消耗额度时（发起研究 / 整理众声）拉起登录弹窗，而不是把整页换成一堵登录墙。
  // 入口里的种子内容不看这里：它由会话层的预取结果决定，与前台在哪一页无关。
  const { state: sessionState } = useZhihuSession()
  const { openLogin } = useZhihuLogin()
  const needsLogin = sessionState.status === 'ready' && !sessionState.session.authenticated
  // 深度研究由服务端承接：服务端未声明研究能力时，这里不发研究请求，
  // 只如实说明这一步还在接通。众声与它共用入口外壳，外壳常驻时不能顺带打一轮研究接口。
  const researchEnabled = researchAvailable
  const researchUnavailableMessage = researchAvailable
    ? null
    : '深度研究将运行在服务端，当前这一步还没有接通；接通后可直接在这里发起研究。'
  // 档位由运行面决定：网页端只承接 Pro（单次知乎直答），自研 Ultra 引擎只在本机运行面。
  const researchTiers = researchUltraAvailable ? (['pro', 'ultra'] as const) : (['pro'] as const)
  // ── 深度研究状态（常驻） ──
  const [draft, setDraft] = useState('')
  const [tier, setTier] = useState<'pro' | 'ultra'>(() => getDefaultResearchTier(researchUltraAvailable))
  const [researchFocusSignal, setResearchFocusSignal] = useState(0)
  const researchTask = useDeepResearch(researchTaskId, researchEnabled)
  const research = researchTask.proProgress
    ? projectProProgress(researchTask.proProgress)
    : researchTask.detail
    ? projectResearch({ detail: researchTask.detail, sources: researchTask.sources, report: researchTask.report, now: researchTask.now })
    : researchTask.submitting
      ? pendingResearch(draft)
      : EMPTY_RESEARCH

  // ── 众声状态（常驻） ──
  const [issue, setIssue] = useState(voicesIssue ?? '')
  const [stage, setStage] = useState<VoicesStage | 'idle'>('idle')
  const [voices, setVoices] = useState<VoicesView | null>(null)
  const [voiceError, setVoiceError] = useState('')
  const [scope, setScope] = useState<VoicesScope>('zhihu')
  const [recency, setRecency] = useState<VoicesRecency>('any')
  const voicesFieldRef = useRef<HTMLTextAreaElement>(null)
  const attentionCooldownUntil = useRef(0)
  const startedIssueRef = useRef<string | null>(null)
  // ── 成象状态（常驻） ──
  const imagery = useImagery(conceptAnimationAvailable)
  const [imageryDraft, setImageryDraft] = useState('')
  const [imageryFocusSignal, setImageryFocusSignal] = useState(0)
  const imageryUnavailableMessage = conceptAnimationAvailable
    ? null
    : '成象由服务端承接，当前这一步还没有接通；接通后可直接在这里生成动画。'
  const startImagery = useCallback(() => {
    // 生成同时消耗知乎搜索与模型两类额度：未登录先拉起登录，草稿不丢。
    if (needsLogin) {
      openLogin('imagery')
      return
    }
    const topic = imageryDraft.trim()
    if (!topic) return
    void imagery.generate({ topic, useMaterial: true })
  }, [needsLogin, openLogin, imageryDraft, imagery])
  // 看山常驻侧栏，反馈手势统一交给全局导演，这里不持有角色手柄。
  const triggerAttention = useCallback(() => {
    const now = Date.now()
    if (now < attentionCooldownUntil.current) return
    attentionCooldownUntil.current = now + 8_000
    kanshanDirector.gesture('attention')
  }, [])

  const runVoices = useCallback(async (nextIssue: string, anchorQuestionId?: string) => {
    const trimmed = nextIssue.trim()
    if (trimmed.length === 0) {
      voicesFieldRef.current?.focus()
      return
    }
    // 整理会消耗调用方额度：未登录时先拉起登录，输入内容保留在输入框里。
    if (needsLogin) {
      openLogin('voices')
      return
    }
    setStage('busy')
    setVoiceError('')
    try {
      const result = await requestVoices(trimmed, { anchorQuestionId, scope, recency })
      setVoices(result)
      setStage('done')
    } catch (cause) {
      // 出错时给看山一次困惑反馈，并把真实原因说给用户。
      kanshanDirector.gesture('error')
      setVoiceError(cause instanceof Error && cause.message !== '' ? cause.message : '知乎那边暂时没有响应，可以再试一次')
      setStage('error')
    }
  }, [scope, recency, needsLogin, openLogin])

  // 从首页带着议题进来时直接开始整理。离开众声就清掉记录，下次带同一议题进来会重新整理
  // （与旧的整页重挂载语义一致）；停留在众声期间不会因为状态变化重复触发。
  useEffect(() => {
    if (view !== 'voices') {
      startedIssueRef.current = null
      return
    }
    const initial = voicesIssue?.trim() ?? ''
    if (initial === '' || startedIssueRef.current === initial) return
    startedIssueRef.current = initial
    setIssue(initial)
    void runVoices(initial)
  }, [view, voicesIssue, runVoices])

  /** 从结果回到提问态（保留议题与参数），让用户能改参数或换议题重来。 */
  function resetVoices() {
    setVoices(null)
    setStage('idle')
    setVoiceError('')
    requestAnimationFrame(() => voicesFieldRef.current?.focus())
  }

  // 结果态各自独占版面，与入口不同构，按原页面呈现。
  if (view === 'ask' && research.scene !== 'idle') {
    return (
      <div className="dr-live">
        {researchTask.error && research.tier !== 'pro' ? (
          <p className="dr-live__error" role="alert">研究服务未响应：{researchTask.error}</p>
        ) : null}
        <ResearchWorkspace
          research={research}
          error={researchTask.error}
          submitting={researchTask.submitting}
          onStop={() => void researchTask.cancel()}
          onNew={(keepQuestion) => {
            researchTask.reset()
            if (!keepQuestion) setDraft('')
          }}
          reportMarkdownUrl={researchTask.detail?.reportId ? researchReportMarkdownUrl(researchTask.detail.id) : undefined}
        />
      </div>
    )
  }
  const voicesEntry = stage === 'idle' && voices === null
  // 成象出结果后独占版面：播放器 + 历史，与入口不同构。
  if (view === 'imagery' && imagery.result !== null) {
    return <ImageryResult imagery={imagery} onReset={() => { imagery.reset(); setImageryDraft('') }} />
  }
  // 生成要几十秒：换成专门的等待版面，而不是停在输入卡上像卡住。
  if (view === 'imagery' && imagery.generating) {
    return <ImageryGenerating topic={imageryDraft.trim()} />
  }

  // 入口态：三页共用同一个外壳，切换只发生在每一格内部。
  // 成象没有建议格，也不挂底部题款——它的题款就是标题本身。
  const entry = (
    <EntrySurface
      view={view}
      emblem={view === 'ask' ? <Telescope size={54} /> : view === 'voices' ? <Scale size={54} /> : <Clapperboard size={54} />}
      title={view === 'ask' ? '你想深入了解什么？' : view === 'voices' ? '听听TA们怎么说？' : '概念成型，可见为象'}
      seeds={view === 'ask'
        ? <ResearchSeeds onPick={(question) => { setDraft(question); setResearchFocusSignal((value) => value + 1) }} />
        : view === 'voices'
          ? <VoicesSeeds onPick={(nextIssue) => { setIssue(nextIssue); void runVoices(nextIssue) }} />
          : undefined}
      composer={view === 'ask'
        ? (
          <ResearchEntryComposer
            draft={draft}
            tier={tier}
            tiers={researchTiers}
            unavailableMessage={researchUnavailableMessage}
            submitting={researchTask.submitting}
            startError={researchTask.error}
            focusSignal={researchFocusSignal}
            onDraftChange={setDraft}
            onTierChange={setTier}
            onStart={() => {
              // 研究与 Pro 都消耗调用方额度：未登录先拉起登录，草稿不丢。
              if (needsLogin) {
                openLogin('ask')
                return
              }
              void researchTask.submit(draft, getDefaultResearchWebSupplement(), tier, crypto.randomUUID())
            }}
          />
        )
        : view === 'voices'
          ? (
            <VoicesEntryComposer
              issue={issue}
              scope={scope}
              recency={recency}
              fieldRef={voicesFieldRef}
              onIssueChange={setIssue}
              onScopeChange={setScope}
              onRecencyChange={setRecency}
              onSubmit={() => void runVoices(issue)}
              onInputFocus={triggerAttention}
            />
          )
          : (
            <ImageryComposer
              draft={imageryDraft}
              disabled={false}
              unavailableMessage={imageryUnavailableMessage}
              error={imagery.error}
              focusSignal={imageryFocusSignal}
              onDraftChange={setImageryDraft}
              onStart={startImagery}
            />
          )}
    />
  )

  const voicesStage = view === 'voices' && !voicesEntry ? (stage === 'idle' ? 'done' : stage) : 'entry'
  return (
    <EntryStageTransition stage={voicesStage}>
      {voicesStage === 'entry' ? entry : (
        <VoicesResult
          stage={voicesStage}
          issue={issue}
          voices={voices}
          error={voiceError}
          onRetry={(anchorQuestionId) => void runVoices(issue, anchorQuestionId)}
          onReset={resetVoices}
        />
      )}
    </EntryStageTransition>
  )
}

/** 提交后首个计划生成前的占位视图：问题先行，计划标注为生成中。 */
function pendingResearch(question: string): ResearchViewModel {
  const trimmed = question.trim()
  return {
    ...EMPTY_RESEARCH,
    scene: 'researching',
    question: trimmed,
    title: trimmed,
    activityLabel: '正在建立研究任务',
    elapsedLabel: '0 秒',
  }
}
