import clipAppear from '../../assets/brand/kanshan-appear.webm'
import clipRetract from '../../assets/brand/kanshan-retract.webm'
import clipIdle from '../../assets/brand/kanshan-idle.webm'
import clipAttention from '../../assets/brand/kanshan-attention.webm'
import clipSuccess from '../../assets/brand/kanshan-success.webm'
import clipError from '../../assets/brand/kanshan-error.webm'
import clipStartle from '../../assets/brand/kanshan-startle.webm'
import restFrame from '../../assets/brand/kanshan-rest.png'

/**
 * 刘看山趴伏动画的状态。所有片段都从同一条长镜头切出：appear / retract 与各手势
 * 的首尾都落在同一帧 anchor（标准趴伏），appear 是 retract 的严格倒序，因此任意
 * 片段都能在 anchor 处无缝交接。每条片段在后期就裁成了「anchor 起、anchor 收」的
 * 净动作窗口，整段播完即回到 anchor，交互层不再做二次截窗。
 */
export type KanshanGesture = 'attention' | 'success' | 'error' | 'startle'
export type KanshanClipId = 'appear' | 'retract' | 'idle' | KanshanGesture

/** 一次性手势：播放一次后在 anchor 处回到 idle 循环，不会自行重复触发。 */
export const KANSHAN_GESTURES: readonly KanshanGesture[] = ['attention', 'success', 'error', 'startle']

/** 需要在挂载时预载的一次性片段（idle 作为常驻底层单独渲染）。 */
export const KANSHAN_ONESHOT_IDS: readonly Exclude<KanshanClipId, 'idle'>[] = [
  'appear',
  'retract',
  'attention',
  'success',
  'error',
  'startle',
]

export const KANSHAN_SOURCES: Readonly<Record<KanshanClipId, string>> = {
  appear: clipAppear,
  retract: clipRetract,
  idle: clipIdle,
  attention: clipAttention,
  success: clipSuccess,
  error: clipError,
  startle: clipStartle,
}

/** 关闭动效时显示的静止 anchor 帧。 */
export const KANSHAN_REST_FRAME = restFrame

/**
 * 每条一次性片段的整段时长（秒）。片段首尾都在 anchor，播放器从 0 播到此时长恰好
 * 落回 anchor；idle 自身首尾同姿态，作为常驻底层无缝循环，不在此表内。
 */
export const KANSHAN_DURATION = {
  appear: 3.25,
  retract: 3.25,
  attention: 3.125,
  success: 4.125,
  error: 3.333,
  startle: 2.75,
} as const satisfies Record<Exclude<KanshanClipId, 'idle'>, number>

/** 一次性片段尾帧与 idle 首帧（严格 anchor）之间的交叉淡化，掩盖亚像素差。 */
export const KANSHAN_CROSSFADE_MS = 130
