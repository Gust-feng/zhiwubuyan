import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { handleComposerEnter } from '@ui/components/entry-surface/entry-composer-keys'

/** 成象输入卡：概念输入 + 提交。
 *  卡片外框由共享入口外壳持有，这里只渲染卡内对象，外壳不重建、只有卡内被替换。
 *  生成期间不渲染本组件（由 ImageryGenerating 接管版面），所以这里没有提交中状态。 */
export function ImageryComposer({ draft, disabled, unavailableMessage, error, focusSignal, onDraftChange, onStart }: {
  draft: string
  disabled: boolean
  /** 服务端未承接时的说明；非空时不发请求，先如实说明。 */
  unavailableMessage?: string | null
  error?: string | null
  focusSignal: number
  onDraftChange: (value: string) => void
  onStart: () => void
}) {
  const topicRef = useRef<HTMLTextAreaElement>(null)
  const unavailable = typeof unavailableMessage === 'string' && unavailableMessage !== ''

  useEffect(() => {
    if (focusSignal > 0) requestAnimationFrame(() => topicRef.current?.focus())
  }, [focusSignal])

  return (
    <form className="imagery-composer" onSubmit={(event) => {
      event.preventDefault()
      if (!draft.trim()) {
        topicRef.current?.focus()
        return
      }
      if (unavailable || disabled) return
      onStart()
    }}>
      <textarea
        ref={topicRef}
        id="imagery-topic"
        aria-label="想讲解的概念"
        placeholder="写下一个概念或一句话。"
        rows={1}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          // 回车即开始成象（与主按钮同一条路）；Ctrl/⌘+回车才是换行，输入法组词中不触发。
          handleComposerEnter(event, { value: draft, onValueChange: onDraftChange, onSubmit: onStart })
        }}
      />
      <div className="imagery-composer__bar">
        <button type="submit" className="entry-primary-button" disabled={unavailable || disabled}>
          <span>开始成象</span>
          <Sparkles size={16} aria-hidden />
        </button>
      </div>
      {unavailable ? (
        <p className="imagery-composer__notice" role="alert">{unavailableMessage}</p>
      ) : error ? (
        <p className="imagery-composer__notice" role="alert">{error}</p>
      ) : (
        <p className="imagery-composer__hint">生成一份可离线打开、分步讲解的动画，需要几十秒。</p>
      )}
    </form>
  )
}
