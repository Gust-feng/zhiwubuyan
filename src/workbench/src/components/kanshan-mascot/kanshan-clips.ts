import clipEntryIn from '../../assets/brand/kanshan-entry-in.webm'
import clipEntryOut from '../../assets/brand/kanshan-entry-out.webm'
import clipIdle from '../../assets/brand/kanshan-idle.webm'
import clipAttention from '../../assets/brand/kanshan-attention.webm'
import clipSuccess from '../../assets/brand/kanshan-success.webm'
import clipError from '../../assets/brand/kanshan-error.webm'
import restFrame from '../../assets/brand/kanshan-rest.png'

/**
 * 刘看山趴伏动画的六个独立状态。所有 rest 类片段（idle / attention /
 * success / error）首尾都是同一帧 anchor（标准趴伏），entry-in 落在 anchor、
 * entry-out 从 anchor 倒着缩回，因此任意片段都能在 anchor 处无缝交接。
 */
export type KanshanGesture = 'attention' | 'success' | 'error'
export type KanshanClipId = 'entry-in' | 'entry-out' | 'idle' | KanshanGesture

/** 一次性手势：播放一次后在 anchor 处回到 idle 循环。 */
export const KANSHAN_GESTURES: readonly KanshanGesture[] = ['attention', 'success', 'error']

/** 需要在挂载时预载的一次性片段（idle 作为常驻底层单独渲染）。 */
export const KANSHAN_ONESHOT_IDS: readonly Exclude<KanshanClipId, 'idle'>[] = [
  'entry-in',
  'entry-out',
  'attention',
  'success',
  'error',
]

export const KANSHAN_SOURCES: Readonly<Record<KanshanClipId, string>> = {
  'entry-in': clipEntryIn,
  'entry-out': clipEntryOut,
  idle: clipIdle,
  attention: clipAttention,
  success: clipSuccess,
  error: clipError,
}

/** 关闭动效时显示的静止 anchor 帧。 */
export const KANSHAN_REST_FRAME = restFrame

/**
 * 母片为保证闭环把动作后的 anchor 定格拉长了，交互播放时只取「有动作」的窗口，
 * 落点都在 anchor，交还给 idle 循环时不跳变。时间单位：秒。
 */
export const KANSHAN_TIMING = {
  // entry-in：0–2.0s 只露耳朵，2.0–3.2s 探出并落定到 anchor。
  enterFrom: 2.0,
  enterSettle: 3.2,
  // entry-out（entry-in 倒放）：2.3s 仍在 anchor，2.3–3.15s 缩回只剩耳朵。
  leaveFrom: 2.3,
  leaveHidden: 3.15,
  // 各手势从 anchor 出发、做完动作回到 anchor 的时刻。
  gestureEnd: {
    attention: 2.4,
    success: 2.8,
    error: 3.2,
  } satisfies Record<KanshanGesture, number>,
  // 一次性片段尾帧与 idle 首帧（严格 anchor）之间的交叉淡化，掩盖亚像素差。
  crossfadeMs: 130,
  // 待机节奏：一轮呼吸结束后在 anchor 安静一段随机时长再动，避免一直循环，
  // 也不会长期僵住；少量概率把下一轮换成「探头张望」手势。
  idleRestMinMs: 13_000,
  idleRestMaxMs: 28_000,
  idleVariationChance: 0.28,
} as const
