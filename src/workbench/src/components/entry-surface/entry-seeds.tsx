import type { ReactNode } from 'react'
import { useEntrySeeds } from '../../workbench/use-entry-seeds'
import type { EntrySeedKind } from '../../contracts/entry-seeds'

/** 入口建议卡的条目数上限：两个入口取同一条数。
 *  条数一致、行高一致，卡片高度就一致——在入口之间切换时下面那张输入卡不会被顶动。 */
const SEED_LIMIT = 4

/** 入口建议卡的条目列表：图标、标题与点击行为由各入口给，排法只有这一份。
 *  以前两个入口各写一套：众声那份没压过 `.entry-live button { color: inherit }` 的权重，
 *  条目一直是正文色、行高也松一档，同一个列表看起来却是两种字。 */
export function EntrySeedsList(props: {
  readonly kind: EntrySeedKind
  /** 拿不到种子时显示的内置内容。 */
  readonly fallback: readonly string[]
  readonly icon: ReactNode
  /** 拿到种子时的标题，例如「为你推荐」。 */
  readonly heading: string
  /** 用内置内容时的标题。 */
  readonly headingFallback: string
  readonly label: string
  readonly onPick: (item: string) => void
  /** 条目右侧的动作图标；点击不落到输入框的入口不传。 */
  readonly action?: ReactNode
}) {
  const seeds = useEntrySeeds(props.kind, props.fallback)
  const own = seeds.own
  return (
    <>
      <div className="entry-seeds__head">
        {props.icon}
        <h2>{own ? props.heading : props.headingFallback}</h2>
        {/* 拿到种子才谈得上「更新于」；内置内容要如实标明它不是当前生成的那一份。 */}
        <span className="entry-seeds__meta">{own ? seeds.updatedLabel : '内置示例'}</span>
      </div>
      <ol className="entry-seeds__list">
        {seeds.items.slice(0, SEED_LIMIT).map((item) => (
          <li key={item}>
            {/* 条目在窄容器里会换行，悬停标题保证被截断的那一截还能读到。 */}
            <button type="button" className="entry-seeds__item" title={item} onClick={() => props.onPick(item)}>
              <span className="entry-seeds__item-title">{item}</span>
              {props.action}
            </button>
          </li>
        ))}
      </ol>
    </>
  )
}
