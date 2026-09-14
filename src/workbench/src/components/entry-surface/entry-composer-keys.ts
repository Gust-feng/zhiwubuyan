import type { KeyboardEvent } from 'react'

/** 入口输入框的回车规则，三个入口共用：**回车即提交，Ctrl/⌘+回车才是换行**。
 *  以前三处各写一套（研究用 Shift+Enter 换行、众声反过来用 Ctrl+Enter 提交、成象又是 Shift+Enter），
 *  同一个软件里两种习惯；现在只留一种，且回车与点主按钮走同一条路。
 *  输入法组词中的回车不算：那是在选字，不是在提交。 */
export function handleComposerEnter(
  event: KeyboardEvent<HTMLTextAreaElement>,
  options: {
    /** 受控值，换行时以它为基准在光标处插入换行符。 */
    readonly value: string
    readonly onValueChange: (next: string) => void
    /** 回车触发的提交；应与主按钮走同一个函数，保证空输入等守卫一致。 */
    readonly onSubmit: () => void
  },
): void {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
  event.preventDefault()
  if (!(event.ctrlKey || event.metaKey)) {
    options.onSubmit()
    return
  }
  const textarea = event.currentTarget
  const start = textarea.selectionStart ?? options.value.length
  const end = textarea.selectionEnd ?? start
  options.onValueChange(`${options.value.slice(0, start)}\n${options.value.slice(end)}`)
  // 受控值更新后再把光标放回新行，手感才像普通输入。
  requestAnimationFrame(() => {
    textarea.selectionStart = textarea.selectionEnd = start + 1
  })
}
