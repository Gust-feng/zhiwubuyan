import type { RefObject } from 'react'
import { ArrowUp, Globe, Sparkles } from 'lucide-react'
import { EntrySeedsList } from '@ui/components/entry-surface/entry-seeds'
import type { VoicesRecency, VoicesScope } from '../../../../contracts/voices'

/** 众声的内置示例议题：还没生成出当前热榜议题时的兜底，任何状态下都有内容可点。
 *  它不参与取数，也不代表此刻大家在争什么；条数与深度研究入口一致，切换时卡片高度不变。 */
const EXAMPLE_ISSUES = [
  '远程办公三年后，团队协作效率到底是升还是降？',
  'AI 写作工具会让人类写作能力退化吗？',
  '年轻人为什么开始反向消费？',
  '短视频把人的注意力变短了吗？',
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

/** 众声入口的建议议题卡：点一条直接用该议题开始整理。
 *  议题由此刻的知乎热榜提炼而来，所以标题说的是「大家在争什么」而不是「为你推荐」——
 *  它不是按你的口味挑的，是你进来时大家正好在争的。没有提炼结果就用内置示例。
 *  条目右侧不给「+」：研究侧那个是把问题填进输入框，这里点一下就直接开始消耗额度。 */
export function VoicesSeeds({ onPick }: { onPick: (issue: string) => void }) {
  return (
    <EntrySeedsList
      kind="voices"
      fallback={EXAMPLE_ISSUES}
      icon={<Sparkles size={14} aria-hidden />}
      heading="此刻大家在争"
      headingFallback="试试这些议题"
      label="此刻大家在争的议题"
      onPick={onPick}
    />
  );
}

/** 众声入口的输入卡内容：议题输入 + 检索范围/时间范围预置项。
 *  卡片外框由调用方持有，这里只渲染卡内对象。 */
export function VoicesEntryComposer({
  issue,
  scope,
  recency,
  fieldRef,
  onIssueChange,
  onScopeChange,
  onRecencyChange,
  onSubmit,
  onInputFocus,
}: {
  issue: string
  scope: VoicesScope
  recency: VoicesRecency
  fieldRef: RefObject<HTMLTextAreaElement | null>
  onIssueChange: (value: string) => void
  onScopeChange: (value: VoicesScope) => void
  onRecencyChange: (value: VoicesRecency) => void
  onSubmit: () => void
  onInputFocus: () => void
}) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
      <textarea
        ref={fieldRef}
        rows={1}
        aria-label="议题"
        placeholder="输入一个议题，或粘贴知乎问题链接。"
        value={issue}
        onChange={(event) => onIssueChange(event.target.value)}
        onFocus={onInputFocus}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSubmit()
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
              onClick={() => onScopeChange(option.value)}
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
                onClick={() => onRecencyChange(option.value)}
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
  )
}
