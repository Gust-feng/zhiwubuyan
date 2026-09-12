import { useSyncExternalStore } from 'react'
import type { KanshanMascotHandle } from './KanshanMascot'
import type { WorkbenchView } from '@ui/workbench/navigation-state'

/** 刘看山的两个栖位：侧栏引导卡片、深度研究输入框。 */
export type KanshanPerchId = 'sidebar' | 'composer'

interface DirectorSnapshot {
  /**
   * 当前允许可见的栖位。来源缩回完成到目标探出之前为 null（空档），
   * 因此任意时刻屏幕上至多一只刘看山，切换表现为「这里缩起、别处探出」，
   * 而不是同一个对象在屏幕上平移。
   */
  readonly activePerch: KanshanPerchId | null
}

export interface KanshanPerchApi {
  readonly handle: KanshanMascotHandle
}

// 来源完全缩起后、目标探出头之前的空档，强化「在另一个地方冒出来」的节奏。
const SWITCH_GAP_MS = 170
const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

function isMotionReduced(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset.motionEffective === 'reduced'
}

/**
 * 刘看山全局编排：两个栖位各有一个角色实例，但同一时刻只允许一个在场。
 * 视图决定目标栖位；切换时来源先播放缩起动画并隐藏，经过一个短暂空档，
 * 再让目标从栖位里探出头来。状态机与 React 解耦，组件订阅 activePerch
 * 控制自身显隐，不做任何跨位置位移。
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

  /** 由顶层视图状态驱动：深度研究与众声落在输入框栖位，其余视图落在侧栏栖位。 */
  setView(view: WorkbenchView): void {
    this.desired = view === 'ask' || view === 'voices' ? 'composer' : 'sidebar'
    void this.reconcile()
  }

  register(id: KanshanPerchId, api: KanshanPerchApi): void {
    this.perches.set(id, api)
    void this.reconcile()
  }

  unregister(id: KanshanPerchId): void {
    this.perches.delete(id)
    // 栖位随视图卸载即视为不在场；状态机会让目标栖位自行探出，不做位移补间。
    if (this.current === id) this.current = null
    void this.reconcile()
  }

  /** 让指定栖位播放缩起动画；栖位已经卸载则直接结束。 */
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

        // 1) 当前在场者先缩起消失（保持可见以播完缩起动画）。
        if (this.current !== null) {
          const from = this.current
          this.current = null
          await this.retract(from)
          // 2) 进入空档：来源隐藏，目标尚未出现，屏幕上一只都没有。
          this.setActive(null)
          if (!isMotionReduced()) await delay(SWITCH_GAP_MS)
        }

        // 3) 目标栖位挂载后在新位置探出头；未挂载则等其 register 再收敛。
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
