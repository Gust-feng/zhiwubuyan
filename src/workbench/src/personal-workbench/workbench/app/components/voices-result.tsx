import { useState } from 'react'
import { ArrowUpRight, ChevronDown, CircleAlert, Compass, Scale } from 'lucide-react'
import type { VoicesView, VoiceSource } from '../../../../contracts/voices'
import './voices-page.css'

export type VoicesStage = 'busy' | 'done' | 'error'

/** 众声结果态：把说法按分节摆开，来源保留来路，落点条说明取自哪个知乎问题。
 *  入口不在里面——它由共享入口外壳承载，见 EntryViews。 */
export function VoicesResult({ stage, issue, voices, error, onRetry, onReset }: {
  stage: VoicesStage
  issue: string
  voices: VoicesView | null
  error: string
  /** 重试当前议题；带 anchorQuestionId 表示改看另一个落点问题。 */
  onRetry: (anchorQuestionId?: string) => void
  onReset: () => void
}) {
  return (
    <div className="ui-view voices-page">
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
            <button type="button" className="voices-notice__retry" onClick={() => onRetry()}>重试</button>
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
              <button type="button" className="voices-reset" onClick={onReset}>换个议题</button>
            </div>
            <h1 className="voices-report__title">{voices.issue}</h1>
            <div className="voices-report__meta">
              <span>{voices.sourceCount} 条来源</span>
              {voices.anchor !== undefined && <span>取自 1 个问题下的 {voices.anchor.answerCount} 条回答</span>}
            </div>

            <AnchorBar
              anchor={voices.anchor}
              candidates={voices.anchorCandidates}
              onSwitch={(questionId) => onRetry(questionId)}
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
    </div>
  )
}

/** 落点条：说清这些说法落在哪个知乎问题上，可展开改看别的候选问题；没有落点时如实说明。 */
function AnchorBar({
  anchor,
  candidates,
  onSwitch,
}: {
  anchor: VoicesView['anchor']
  candidates: VoicesView['anchorCandidates']
  onSwitch: (questionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (anchor === undefined) {
    return (
      <div className="voices-anchor is-loose">
        <Compass size={15} aria-hidden />
        <span>没有找到聚焦的单一知乎问题，下面的说法来自多个问题下的相关讨论。</span>
      </div>
    )
  }
  const titled = anchor.title !== undefined && anchor.title !== ''
  return (
    <div className="voices-anchor">
      <div className="voices-anchor__head">
        <Compass size={15} aria-hidden />
        <span className="voices-anchor__where">
          落点：知乎问题
          <a href={anchor.url} target="_blank" rel="noreferrer">{titled ? `《${anchor.title}》` : '（打开原问题）'}</a>
        </span>
        {candidates.length > 0 && (
          <button
            type="button"
            className="voices-anchor__toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span>换一个观点</span>
            <ChevronDown size={13} aria-hidden />
          </button>
        )}
      </div>
      {open && candidates.length > 0 && (
        <div className="voices-anchor__alternatives">
          <span className="voices-anchor__alternatives-label">也可以看这些问题</span>
          <ul>
            {candidates.map((candidate) => (
              <li key={candidate.questionId}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onSwitch(candidate.questionId)
                  }}
                >
                  <span>{candidate.title}</span>
                  <ArrowUpRight size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
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
