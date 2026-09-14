import { useEffect, useState } from 'react'
import { primeEntrySeeds, readEntrySeeds } from './entry-seeds'
import type { EntrySeedKind } from '../contracts/entry-seeds'

/** 入口种子在这个入口里实际显示的样子。 */
export type EntrySeedContent = {
  /** 是否拿到了种子；为假时 items 是调用方给的内置内容。 */
  readonly own: boolean
  readonly items: readonly string[]
  /** 「更新于 HH:MM」；用内置内容时为空。 */
  readonly updatedLabel: string
}

/**
 * 入口要显示的内容：**只在挂载这一刻读一次**，之后不再变。
 * 两种来源的条数与文案都不同，结果晚到就替换的话，用户看到的是列表凭空跳了一下；
 * 所以这里不做后续更新——晚到的结果留给下次进入入口时用。
 * 入口因此不判断登录状态、也不等结果：没拿到种子就说明还没生成出来，先给内置内容。
 */
export function useEntrySeeds(kind: EntrySeedKind, fallback: readonly string[]): EntrySeedContent {
  const [seeds] = useState(() => readEntrySeeds(kind))
  // 再确认一次新鲜度：生成本应在打开应用或登录时就开始了，这里只兜住长期挂着不重开的情况。
  // 重取的结果同样不会替换上面已经定下的内容，只留给下次进入时用。
  useEffect(() => {
    primeEntrySeeds(kind)
  }, [kind])
  // 空列表代表素材里确实没有可提炼的内容，与没拿到结果一样，都退回内置内容。
  const own = seeds !== undefined && seeds.items.length > 0 ? seeds : undefined
  return {
    own: own !== undefined,
    items: own?.items ?? fallback,
    updatedLabel: own === undefined ? '' : updatedAt(own.generatedAt),
  }
}

function updatedAt(generatedAt: string): string {
  const time = new Date(generatedAt)
  if (Number.isNaN(time.getTime())) return ''
  return `更新于 ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
}
