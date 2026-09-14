import { requestJson } from '../api'
import type { EntrySeedKind, EntrySeedsView } from '../contracts/entry-seeds'

/** 取数路径：素材由服务端按入口各取各的，前端只说明自己是哪个入口。 */
function seedPath(kind: EntrySeedKind): string {
  return `/api/research/seeds?kind=${kind}`
}

/** 素材来自本人数据的入口：只有它跟着登录走，登出时也要清掉。
 *  众声用公开热榜，与身份无关，换身份照样成立。 */
const PERSONAL_KIND: EntrySeedKind = 'research'

/**
 * 重新生成的门槛。素材是热榜，一天里会变，但已经摆出来的几条不该跟着跳：
 * 只有明显过期才在后台重取，新结果留给下次进入入口时用。
 */
const REFRESH_AFTER_MS = 30 * 60 * 1000

type EntrySeeds = {
  readonly items: readonly string[]
  /** 本地写入时刻：判断新不新鲜用本地时钟，不受服务端时间偏差影响。 */
  readonly at: number
}

/**
 * 入口种子：一次页面生命周期内有效。
 *
 * 生成在**登录确认或应用打开时**就开始了，不等用户打开入口。反过来（打开入口才发请求）
 * 会有一个绕不开的窗口：结果最快也要几秒才回来，这几秒里入口只能先摆内置内容，
 * 等结果到了再换一次——两种来源的条数与文案都不同，看起来就是列表凭空跳了一下。
 *
 * 这里只存**拿到的结果**（可能是空列表，代表素材里确实没有可提炼的内容）；没拿到就不写，
 * 入口退回内置内容。入口只读这里，自己不判断登录、也不等结果。
 */
const seeds = new Map<EntrySeedKind, EntrySeeds>()
const inFlight = new Map<EntrySeedKind, Promise<void>>()
/** 每个入口各自的登出轮次：登出后旧请求可能才回来，靠它挡住那一份。 */
const rounds = new Map<EntrySeedKind, number>()

function roundOf(kind: EntrySeedKind): number {
  return rounds.get(kind) ?? 0
}

/** 当前已就绪的一份；没有（还没生成完、生成失败）时返回 undefined。 */
export function readEntrySeeds(kind: EntrySeedKind): EntrySeeds | undefined {
  return seeds.get(kind)
}

/** 生成某一个入口的种子。还没过期、或已经在生成中时直接返回，不重复消耗额度。 */
export function primeEntrySeeds(kind: EntrySeedKind): void {
  const current = seeds.get(kind)
  if (current !== undefined && Date.now() - current.at < REFRESH_AFTER_MS) return
  if (inFlight.has(kind)) return
  void generate(kind)
}

/** 登出时清掉本人素材那类：种子来自本人收藏，不能留给下一个身份。 */
export function forgetEntrySeeds(): void {
  rounds.set(PERSONAL_KIND, roundOf(PERSONAL_KIND) + 1)
  seeds.delete(PERSONAL_KIND)
  inFlight.delete(PERSONAL_KIND)
}

function generate(kind: EntrySeedKind): Promise<void> {
  const round = roundOf(kind)
  const task = requestJson<EntrySeedsView>(seedPath(kind))
    .then((view) => {
      if (round !== roundOf(kind)) return
      seeds.set(kind, { items: view.items, at: Date.now() })
    })
    .catch(() => {
      // 失败不写：入口这次用内置内容，下次重新生成。
    })
    .finally(() => {
      if (round === roundOf(kind)) inFlight.delete(kind)
    })
  inFlight.set(kind, task)
  return task
}
