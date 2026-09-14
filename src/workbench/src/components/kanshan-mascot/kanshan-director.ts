import { useSyncExternalStore } from 'react'
import type { KanshanMascotHandle } from './KanshanMascot'
import type { KanshanGesture } from './kanshan-clips'

/** 刘看山同一时刻只待在一个栖位：输入框上沿或侧栏引导卡片。
 *  输入框挂载时优先趴在输入框上沿，卸载后由侧栏承接，全程不会同时出现两只。 */
export type KanshanPerchId = 'sidebar' | 'composer'

/** 没有输入框栖位时的默认栖位。 */
const DEFAULT_PERCH: KanshanPerchId = 'sidebar'

interface DirectorSnapshot {
  /**
   * 当前允许可见的栖位。栖位尚未注册、或正在缩回时是 null，
   * 组件据此把角色藏起来；输入框栖位与侧栏栖位之间切换时，旧栖位先缩回、
   * 空档后新栖位再入场，因此同一时刻屏幕上只有一只，不会跨位置瞬移。
   */
  readonly activePerch: KanshanPerchId | null
}

export interface KanshanPerchApi {
  readonly handle: KanshanMascotHandle
}

// 角色缩回完成后、重新出现之前的空档，让「收起再冒出来」有节奏。
const SWITCH_GAP_MS = 170
const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

function isMotionReduced(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset.motionEffective === 'reduced'
}

/**
 * 刘看山全局编排：输入框与侧栏两个栖位同一时刻只激活一个，组件订阅 activePerch 控制显隐。
 * 状态机与 React 解耦；栖位挂载 / 卸载时自行演出入场与缩回。
 */
class KanshanDirector {
  private readonly perches = new Map<KanshanPerchId, KanshanPerchApi>()
  private preference: KanshanPerchId | null = null
  private current: KanshanPerchId | null = null
  private busy = false
  private rerunQueued = false
  private snapshot: DirectorSnapshot = { activePerch: null }
  private readonly listeners = new Set<() => void>()

  readonly subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  readonly getSnapshot = (): DirectorSnapshot => this.snapshot

  private publish(): void {
    this.listeners.forEach((listener) => listener())
  }

  private setActive(perch: KanshanPerchId | null): void {
    if (this.snapshot.activePerch === perch) return
    this.snapshot = { activePerch: perch }
    this.publish()
  }

  /**
   * 把一次手势交给当前在场的角色。业务侧（研究 / 众声的聚焦与失败反馈）不持有
   * 角色手柄，统一从这里转发，避免多处各自攥着一个 ref 却指向看不见的实例。
   */
  gesture(gesture: KanshanGesture): void {
    this.perches.get(this.current ?? this.target())?.handle.gesture(gesture)
  }

  /** 当前应收敛到的栖位：输入框认领时优先，否则回落到侧栏。 */
  private target(): KanshanPerchId {
    return this.preference ?? DEFAULT_PERCH
  }

  /** 栖位挂载时认领角色（输入框上沿优先于侧栏）。 */
  prefer(id: KanshanPerchId): void {
    if (this.preference === id) return
    this.preference = id
    void this.reconcile()
  }

  /** 栖位卸载时放弃认领；若正是它在认领，回落到默认栖位。 */
  unprefer(id: KanshanPerchId): void {
    if (this.preference !== id) return
    this.preference = null
    void this.reconcile()
  }

  register(id: KanshanPerchId, api: KanshanPerchApi): void {
    this.perches.set(id, api)
    void this.reconcile()
  }

  unregister(id: KanshanPerchId): void {
    this.perches.delete(id)
    // 栖位卸载（例如侧栏收起）即视为不在场；重新挂载后会再次入场。
    if (this.current === id) this.current = null
    void this.reconcile()
  }

  /** 让栖位播放缩回动画；栖位已经卸载则直接结束。 */
  private async retract(id: KanshanPerchId): Promise<void> {
    await this.perches.get(id)?.handle.leave()
  }

  private async reconcile(): Promise<void> {
    if (this.busy) {
      this.rerunQueued = true
      return
    }
    this.busy = true
    try {
      do {
        this.rerunQueued = false
        const target = this.target()

        if (target === this.current) break

        // 1) 当前在场者先缩回（保持可见以播完缩回动画）。
        if (this.current !== null) {
          const from = this.current
          this.current = null
          await this.retract(from)
          // 2) 缩回后进入空档：屏幕上短暂一只都没有。
          this.setActive(null)
          if (!isMotionReduced()) await delay(SWITCH_GAP_MS)
        }

        // 3) 栖位已挂载则让它入场；未挂载（侧栏收起等）则停在这里，
        //    等它 register 时再收敛。
        const targetApi = this.perches.get(target)
        if (!targetApi) break
        this.current = target
        this.setActive(target)
        targetApi.handle.enter()
      } while (this.rerunQueued)
    } finally {
      this.busy = false
      if (this.rerunQueued) void this.reconcile()
    }
  }
}

export const kanshanDirector = new KanshanDirector()

export function useKanshanDirector(): DirectorSnapshot {
  return useSyncExternalStore(kanshanDirector.subscribe, kanshanDirector.getSnapshot, kanshanDirector.getSnapshot)
}
