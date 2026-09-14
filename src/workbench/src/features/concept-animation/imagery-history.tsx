import { Trash2 } from 'lucide-react'
import type { AnimationSummary } from '@contracts/concept-animation'

/** 成象历史：最近生成的一批动画，点击打开、可删除。
 *  列表项不含 html，打开时才按 id 取回完整记录。 */
export function ImageryHistory({ items, activeId, onOpen, onRemove }: {
  items: readonly AnimationSummary[]
  activeId: string | null
  onOpen: (id: string) => void
  onRemove: (id: string) => void
}) {
  if (items.length === 0) {
    return <p className="imagery-history__empty">还没有生成过动画。写下第一个概念试试。</p>
  }
  return (
    <ul className="imagery-history">
      {items.map((item) => (
        <li key={item.id} className="imagery-history__row" data-active={item.id === activeId || undefined}>
          <button type="button" className="imagery-history__open" onClick={() => onOpen(item.id)}>
            <span className="imagery-history__title">{item.title || item.topic}</span>
            <span className="imagery-history__meta">{item.topic}</span>
          </button>
          <button
            type="button"
            className="imagery-history__remove"
            aria-label={`删除「${item.title || item.topic}」`}
            title="删除"
            onClick={() => onRemove(item.id)}
          >
            <Trash2 size={14} />
          </button>
        </li>
      ))}
    </ul>
  )
}
