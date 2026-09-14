import { useSyncExternalStore } from 'react'
import type { KanshanMascotHandle } from './KanshanMascot'
import type { KanshanGesture } from './kanshan-clips'

/** 刘看山只有一个栖位：侧栏引导卡片。深度研究与众声不再把它挂到输入框上，
 *  因此它在这些页面的提问、运行、结果三个阶段都在同一处常驻，不会中途消失。 */
export type KanshanPerchId = 'sidebar'

interface DirectorSnapshot {
  /**
   * 当前允许可见的栖位。栖位尚未注册、或正在缩回时是 null，
   * 组件据此把角色藏起来；它只在侧栏存在，不会在屏幕上跨位置移动。
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
 * 刘看山全局编排：只有一个栖位，组件订阅 activePerch 控制自身显隐。
 * 状态机与 React 解耦；栖位挂载 / 卸载时自行演出入场与缩回。
 */
class KanshanDirector {
  private readonly perches = new Map<KanshanPerchId, KanshanPerchApi>()
  private desired: KanshanPerchId = 'sidebar'
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
    this.perches.get(this.current ?? this.desired)?.handle.gesture(gesture)
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
        const target = this.desired

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
