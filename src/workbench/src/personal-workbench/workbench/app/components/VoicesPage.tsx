import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, CircleAlert, Compass, Globe, Scale, Sparkles } from 'lucide-react'
import { KanshanPerch } from '@ui/components/kanshan-mascot/KanshanPerch'
import type { KanshanMascotHandle } from '@ui/components/kanshan-mascot/KanshanMascot'
import type { VoicesRecency, VoicesScope, VoicesView, VoiceSource } from '../../../../contracts/voices'
import './voices-page.css'

const EXAMPLE_ISSUES = [
  '远程办公三年后，团队协作效率到底是升还是降？',
  'AI 写作工具会让人类写作能力退化吗？',
  '年轻人为什么开始反向消费？',
] as const

/** 检索范围与时间范围都是预置选项，界面不开放自由填写。 */
const SCOPE_OPTIONS: ReadonlyArray<{ value: VoicesScope; label: string }> = [
  { value: 'zhihu', label: '仅知乎站内' },
  { value: 'web', label: '补充全网' },
]

const RECENCY_OPTIONS: ReadonlyArray<{ value: VoicesRecency; label: string }> = [
  { value: 'any', label: '不限时间' },
  { value: '7d', label: '近 7 天' },
  { value: '1m', label: '近 1 月' },
  { value: '3m', label: '近 3 月' },
]

type Stage = 'idle' | 'busy' | 'done' | 'error'

/** 众声：把一个议题下大家的不同说法摆到桌面上 —— 说法必须有来路，看山不替你下结论。
 *  入口是居中的提问版心（与深度研究同一套语言），结果按报告式分节呈现。
 *  请求走本地 API 的 /api/research/voices；落点问题下的回答是主体，别处的相关讨论是补充。 */
export function VoicesPage({ initialQuestion }: { initialQuestion?: string } = {}) {
  const [issue, setIssue] = useState(initialQuestion ?? '')
  const [stage, setStage] = useState<Stage>('idle')
  const [voices, setVoices] = useState<VoicesView | null>(null)
  const [error, setError] = useState('')
  const [scope, setScope] = useState<VoicesScope>('zhihu')
  const [recency, setRecency] = useState<VoicesRecency>('any')
  const startedRef = useRef(false)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const mascotRef = useRef<KanshanMascotHandle>(null)
  const attentionCooldownUntil = useRef(0)
  const triggerAttention = useCallback(() => {
    const now = Date.now()
    if (now < attentionCooldownUntil.current) return
    attentionCooldownUntil.current = now + 8_000
    mascotRef.current?.gesture('attention')
  }, [])

  async function run(nextIssue: string, anchorQuestionId?: string, nextScope: VoicesScope = scope, nextRecency: VoicesRecency = recency) {
    const trimmed = nextIssue.trim()
    if (trimmed.length === 0) {
      fieldRef.current?.focus()
      return
    }
    if (stage === 'busy') return
    setStage('busy')
    setError('')
    try {
      const result = await requestVoices(trimmed, { anchorQuestionId, scope: nextScope, recency: nextRecency })
      setVoices(result)
      setStage('done')
    } catch (cause) {
      // 出错时给看山一次困惑反馈，并把真实原因说给用户。
      mascotRef.current?.gesture('error')
      setError(cause instanceof Error && cause.message !== '' ? cause.message : '知乎那边暂时没有响应，可以再试一次')
      setStage('error')
    }
  }

  /** 切换范围或时间：在提问态直接改，提交时生效。 */
  function applyScope(next: VoicesScope) {
    setScope(next)
  }
  function applyRecency(next: VoicesRecency) {
    setRecency(next)
  }

  /** 从结果回到提问态（保留议题与参数），让用户能改参数或换议题重来。 */
  function reset() {
    setVoices(null)
    setStage('idle')
    setError('')
    requestAnimationFrame(() => fieldRef.current?.focus())
  }

  // 带着议题进入页面时直接开始整理，只触发一次
  useEffect(() => {
    if (startedRef.current) return
    const initial = initialQuestion?.trim() ?? ''
    if (initial === '') return
    startedRef.current = true
    void run(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只对进入页面时的初始议题生效
  }, [])

  const entry = stage === 'idle' && voices === null

  return (
    <div className="ui-view voices-page">
      {entry ? (
        <div className="voices-start">
          <div className="voices-start__content">
            <div className="voices-start__head">
              <span className="voices-start__emblem" aria-hidden><Scale size={54} /></span>
              <h1>听听TA们怎么说？</h1>
            </div>

            <section className="voices-seeds" aria-label="可以试试的议题">
              <div className="voices-seeds__head">
                <Sparkles size={14} aria-hidden />
                <h2>试试这些议题</h2>
                <span className="voices-seeds__role">点一条开始整理</span>
              </div>
              <ol className="voices-seeds__list">
                {EXAMPLE_ISSUES.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      className="voices-seed"
                      onClick={() => {
                        setIssue(item)
                        void run(item)
                      }}
                    >
                      <span className="voices-seed__title">{item}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>

            <form
              className="voices-composer"
              onSubmit={(event) => {
                event.preventDefault()
                void run(issue)
              }}
            >
              <KanshanPerch ref={mascotRef} perchId="composer" className="voices-composer__mascot" />
              <textarea
                ref={fieldRef}
                rows={1}
                aria-label="议题"
                placeholder="输入一个议题。"
                value={issue}
                onChange={(event) => setIssue(event.target.value)}
                onFocus={triggerAttention}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void run(issue)
                  }
                }}
              />
              <div className="voices-composer__bar">
                <div className="voices-preset" role="group" aria-label="检索范围">
                  {SCOPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="voices-preset__item"
                      aria-pressed={scope === option.value}
                      onClick={() => applyScope(option.value)}
                    >
                      {option.value === 'web' ? <Globe size={13} aria-hidden /> : null}
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>

                <div className="voices-preset voices-preset--time" role="group" aria-label="时间范围">
                  {scope === 'web' ? (
                    RECENCY_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="voices-preset__item"
                        aria-pressed={recency === option.value}
                        onClick={() => applyRecency(option.value)}
                      >
                        <span>{option.label}</span>
                      </button>
                    ))
                  ) : (
                    <span className="voices-preset__item is-static" aria-hidden>不限时间</span>
                  )}
                </div>

                <button type="submit" className="voices-primary-button" disabled={issue.trim().length === 0}>
                  <span>整理说法</span>
                  <ArrowUp size={16} aria-hidden />
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        <div className="voices-result">
          {stage === 'busy' && (
            <div className="voices-notice" role="status">
              <Scale size={15} aria-hidden />
              <div>
                <strong>正在整理「{issue.trim()}」</strong>
              </div>
            </div>
          )}

          {stage === 'error' && (
            <div className="voices-notice" role="alert">
              <CircleAlert size={15} aria-hidden />
              <div>
                <strong>没有完成这次整理</strong>
                <span>{error}</span>
              </div>
              <button type="button" className="voices-notice__retry" onClick={() => void run(issue)}>重试</button>
            </div>
          )}

          {stage === 'done' && voices?.empty === true && (
            <div className="voices-notice">
              <CircleAlert size={15} aria-hidden />
              <div>
                <strong>没有查到直接相关的资料</strong>
                <span>试试换个说法，或者换一个更具体的议题。</span>
              </div>
            </div>
          )}

          {stage === 'done' && voices !== null && voices.empty === false && (
            <>
              <div className="voices-report__eyebrow">
                <span>众声整理</span>
                <span>·</span>
                <span>{formatTimestamp(voices.generatedAt)}</span>
                <button type="button" className="voices-reset" onClick={reset}>换个议题</button>
              </div>
              <h1 className="voices-report__title">{voices.issue}</h1>
              <div className="voices-report__meta">
                <span>{voices.sourceCount} 条来源</span>
                {voices.anchor !== undefined && <span>取自 1 个问题下的 {voices.anchor.answerCount} 条回答</span>}
              </div>

              <AnchorBar
                anchor={voices.anchor}
                candidates={voices.anchorCandidates}
                onSwitch={(questionId) => void run(voices.issue, questionId)}
              />

              {(voices.tension !== undefined || voices.consensus !== undefined) && (
                <div className="voices-verdicts">
                  {voices.tension !== undefined && (
                    <div className="voices-verdict">
                      <strong>最主要的分歧</strong>
                      <p>{voices.tension}</p>
                    </div>
                  )}
                  {voices.consensus !== undefined && (
                    <div className="voices-verdict">
                      <strong>共同认可</strong>
                      <p>{voices.consensus}</p>
                    </div>
                  )}
                </div>
              )}

              {voices.clusters.map((cluster, index) => {
                const main = cluster.sources.filter((source) => source.kind === 'question_answers')
                const elsewhere = cluster.sources.filter((source) => source.kind !== 'question_answers')
                let rowNumber = 0
                return (
                  <section className="voices-cluster" key={cluster.id}>
                    <header className="voices-cluster__head">
                      <span className="voices-cluster__index">{String(index + 1).padStart(2, '0')}</span>
                      <h2 className="voices-cluster__label">{cluster.label}</h2>
                      <span className="voices-cluster__tag">看山的归纳</span>
                    </header>
                    <p className="voices-cluster__statement">{cluster.statement}</p>
                    {main.length > 0 && (
                      <ul className="voices-sources">
                        {main.map((source) => {
                          rowNumber += 1
                          return <VoiceSourceRow key={source.id} source={source} number={rowNumber} />
                        })}
                      </ul>
                    )}
                    {elsewhere.length > 0 && (
                      <details className="voices-elsewhere" open={main.length === 0}>
                        <summary>别处还有 {elsewhere.length} 条相关讨论</summary>
                        <ul className="voices-sources">
                          {elsewhere.map((source) => {
                            rowNumber += 1
                            return <VoiceSourceRow key={source.id} source={source} number={rowNumber} />
                          })}
                        </ul>
                      </details>
                    )}
                  </section>
                )
              })}

              {voices.unclustered.length > 0 && (
                <details className="voices-unclustered">
                  <summary>{voices.unclustered.length} 条来源未归入说法</summary>
                  <ul className="voices-sources">
                    {voices.unclustered.map((source, index) => (
                      <VoiceSourceRow key={source.id} source={source} number={index + 1} />
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** 落点条：说清这些说法主要落在这个议题的哪个知乎问题上，并允许改看别处，或在没有落点时如实说明。 */
function AnchorBar({
  anchor,
  candidates,
  onSwitch,
}: {
  anchor: VoicesView['anchor']
  candidates: VoicesView['anchorCandidates']
  onSwitch: (questionId: string) => void
}) {
  if (anchor === undefined) {
    return (
      <div className="voices-anchor is-loose">
        <Compass size={15} aria-hidden />
        <span>没有找到聚焦的单一知乎问题，下面的说法来自多个问题下的相关讨论。</span>
      </div>
    )
  }
  return (
    <div className="voices-anchor">
      <Compass size={15} aria-hidden />
      <span>
        落点：知乎问题《<a href={anchor.url} target="_blank" rel="noreferrer">{anchor.title}</a>》
      </span>
      {candidates.length > 0 && (
        <details className="voices-anchor__switch">
          <summary>换一个落点</summary>
          <div className="voices-anchor__options">
            {candidates.map((candidate) => (
              <button
                key={candidate.questionId}
                type="button"
                onClick={() => onSwitch(candidate.questionId)}
              >
                {candidate.title}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

async function requestVoices(
  issue: string,
  options: { anchorQuestionId?: string; scope: VoicesScope; recency: VoicesRecency },
): Promise<VoicesView> {
  const payload: Record<string, unknown> = { issue, scope: options.scope, recency: options.recency }
  if (options.anchorQuestionId !== undefined) payload.anchorQuestionId = options.anchorQuestionId
  const response = await fetch('/api/research/voices', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = readErrorMessage(body)
    throw new Error(message ?? '知乎那边接口暂时没有响应，不是你的操作有问题，可以再试一次')
  }
  if (!isVoices(body)) throw new Error('整理结果的结构不符合预期，可以再试一次')
  return body
}

/** 服务端错误体是扁平的 { code, message, detail }，这里读 message。 */
function readErrorMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined
  const message = (body as Record<string, unknown>).message
  return typeof message === 'string' && message !== '' ? message : undefined
}

function isVoices(body: unknown): body is VoicesView {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false
  const record = body as Record<string, unknown>
  return typeof record.issue === 'string' && Array.isArray(record.clusters)
}

const CONTENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  answer: '回答',
  article: '文章',
  pin: '想法',
  question: '问题',
  zvideo: '视频',
}

function VoiceSourceRow({ source, number }: { source: VoiceSource; number: number }) {
  const meta = [
    source.authorName,
    source.contentType === undefined ? undefined : CONTENT_TYPE_LABELS[source.contentType.toLowerCase()],
    source.voteCount !== undefined ? `赞同 ${formatCount(source.voteCount)}` : undefined,
    source.commentCount !== undefined ? `评论 ${formatCount(source.commentCount)}` : undefined,
  ].filter((part) => part !== undefined && part !== '').join(' · ')
  // 回答没有标题，摘要是识别这条说法的内容；摘要较长时按行数截断，原文入口保留完整内容。
  const body = (
    <>
      <span className="voices-source__number">{String(number).padStart(2, '0')}</span>
      <span className="voices-source__body">
        <span className="voices-source__summary">{source.summary}</span>
        {meta !== '' && <span className="voices-source__meta">{meta}</span>}
      </span>
    </>
  )
  return (
    <li>
      {source.url === ''
        ? <div className="voices-source">{body}</div>
        : <a className="voices-source" href={source.url} target="_blank" rel="noreferrer">{body}</a>}
    </li>
  )
}

function formatCount(count: number): string {
  if (count >= 10000) {
    const value = (count / 10000).toFixed(1)
    return `${value.endsWith('.0') ? value.slice(0, -2) : value} 万`
  }
  return String(count)
}

function formatTimestamp(iso: string): string {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return ''
  return `${time.getMonth() + 1}月${time.getDate()}日 ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
}
