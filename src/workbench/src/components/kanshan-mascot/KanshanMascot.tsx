import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { useMotionEnabled } from '@ui/shell/motion-system'
import {
  KANSHAN_CROSSFADE_MS,
  KANSHAN_DURATION,
  KANSHAN_GESTURES,
  KANSHAN_ONESHOT_IDS,
  KANSHAN_REST_FRAME,
  KANSHAN_SOURCES,
  type KanshanClipId,
  type KanshanGesture,
} from './kanshan-clips'
import './kanshan-mascot.css'

/** 命令式控制句柄：调用方按真实交互时机驱动，组件内部保证片段在 anchor 处无缝交接。 */
export interface KanshanMascotHandle {
  /** 从「只露耳尖」试探着探出到 anchor，随后进入待机；已在场时无操作。 */
  enter: () => void
  /** 以 anchor 姿态直接落地进入待机（跨位置迁移到达时用，避免倒退成耳朵态）。 */
  appear: () => void
  /** 从 anchor 缩回隐藏，返回在缩回完成时 resolve 的 Promise。 */
  leave: () => Promise<void>
  /** 播放一次手势（attention/success/error/startle），结束无缝回到待机。 */
  gesture: (gesture: KanshanGesture) => void
  /** 点击时的趣味反应：随机挑一个不重复的手势。 */
  curious: () => void
}

export interface KanshanMascotProps {
  /** 外层盒子类名：负责定位与尺寸（角色在盒内底边居中对齐）。 */
  readonly className?: string
  /** 挂载且启用动效时是否自动入场；交给外部编排时设为 false。默认 true。 */
  readonly autoEnter?: boolean
  /** 是否响应鼠标点击播放趣味反应，默认 true。 */
  readonly interactive?: boolean
}

type OneShotId = Exclude<KanshanClipId, 'idle'>
type Phase = 'hidden' | 'entering' | 'idle' | 'gesturing' | 'leaving' | 'rest'
type Layer =
  | { readonly kind: 'none' }
  | { readonly kind: 'oneshot'; readonly clip: OneShotId }
  | { readonly kind: 'cross'; readonly clip: OneShotId }
  | { readonly kind: 'idle' }

const MEDIA_BASE_CLASS = 'kanshan-mascot__media'
const CURIOUS_POOL: readonly KanshanGesture[] = KANSHAN_GESTURES

/**
 * 页面不可见（切标签、最小化）或系统省电时，浏览器会瞬时中断纯视频媒体的
 * play()，抛 AbortError。这类中断重试即可恢复，不能当成永久失败把角色藏起来，
 * 否则用户切一次标签回来，看山就再也不会出现。重试到上限仍失败才放弃。
 */
const PLAY_MAX_ATTEMPTS = 4
const PLAY_RETRY_DELAY_MS = 350
const isRecoverablePlayFailure = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'

/**
 * 刘看山趴伏动画播放器。idle 是常驻底层，只做安静的呼吸/眨眼无缝循环，不会自行
 * 打断自己；appear / retract / 各手势都是一次性上层，只在真实交互（入场、离开、
 * 聚焦反馈、提交结果、点击）时由外部驱动一次。所有交接点都落在同一 anchor 帧，
 * 并用极短交叉淡化消除亚像素跳变。
 */
export const KanshanMascot = forwardRef<KanshanMascotHandle, KanshanMascotProps>(
  function KanshanMascot({ className, autoEnter = true, interactive = true }, ref) {
    const motionEnabled = useMotionEnabled()
    const [layer, setLayer] = useState<Layer>({ kind: 'none' })

    const phaseRef = useRef<Phase>('hidden')
    const runIdRef = useRef(0)
    const activeOneShotRef = useRef<OneShotId | null>(null)
    const lastCuriousRef = useRef<KanshanGesture | null>(null)
    const idleVideoRef = useRef<HTMLVideoElement | null>(null)
    const oneShotVideoRefs = useRef<Partial<Record<OneShotId, HTMLVideoElement>>>({})

    const isStale = useCallback((token: number) => token !== runIdRef.current, [])
    const nextToken = useCallback(() => {
      runIdRef.current += 1
      return runIdRef.current
    }, [])

    const pauseVideo = useCallback((video: HTMLVideoElement | null | undefined, rewind: boolean) => {
      if (!video) return
      video.pause()
      if (rewind) video.currentTime = 0
    }, [])

    // 首次挂载就被要求入场时，视频可能还没加载出首帧；等到有当前帧再 seek/播放，
    // 避免在 readyState=0 时设置 currentTime / play 失效导致冷启动不出现。
    const waitForVideoReady = useCallback((video: HTMLVideoElement): Promise<void> => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve()
      return new Promise((resolve) => {
        const done = () => {
          video.removeEventListener('loadeddata', done)
          video.removeEventListener('canplay', done)
          resolve()
        }
        video.addEventListener('loadeddata', done)
        video.addEventListener('canplay', done)
      })
    }, [])

    /** 一次性片段从头播到其整段时长（首尾都是 anchor），到达后执行 onSettle。 */
    const playOneShot = useCallback(
      (token: number, clip: OneShotId, onSettle: () => void) => {
        const video = oneShotVideoRefs.current[clip]
        if (!video) return
        activeOneShotRef.current = clip
        setLayer({ kind: 'oneshot', clip })

        const until = KANSHAN_DURATION[clip]
        const settle = () => {
          video.removeEventListener('timeupdate', onTimeUpdate)
          video.removeEventListener('ended', onEnded)
          if (isStale(token)) return
          onSettle()
        }
        const onTimeUpdate = () => {
          if (video.currentTime >= until) settle()
        }
        const onEnded = () => settle()

        void (async () => {
          await waitForVideoReady(video)
          if (isStale(token)) return
          video.addEventListener('timeupdate', onTimeUpdate)
          video.addEventListener('ended', onEnded)
          video.playbackRate = 1
          video.currentTime = 0
          for (let attempt = 1; ; attempt += 1) {
            try {
              await video.play()
              return
            } catch (error) {
              if (isStale(token)) return
              if (attempt < PLAY_MAX_ATTEMPTS && isRecoverablePlayFailure(error)) {
                await new Promise((resolve) => window.setTimeout(resolve, PLAY_RETRY_DELAY_MS))
                continue
              }
              // 放不出来也要收束：leave() 的 Promise 依赖这里 resolve，否则导演会永久
              // 卡在 busy，之后任何栖位都不会再出现角色。
              settle()
              return
            }
          }
        })()
      },
      [isStale, waitForVideoReady],
    )

    /** 进入待机：一次性片段收束后交还给常驻 idle 底层。 */
    const settleIntoIdle = useCallback(
      (token: number) => {
        const idle = idleVideoRef.current
        const leavingClip = activeOneShotRef.current
        // 待机是常驻底层且可无缝循环：手势只是盖在它上面，它本身持续在播，只有被显式
        // 停下（入场 / 降级）时才需要重新起播；这样交接处不会抖动。
        if (idle && idle.paused) {
          void (async () => {
            await waitForVideoReady(idle)
            if (isStale(token)) return
            idle.currentTime = 0
            await idle.play().catch(() => undefined)
          })()
        }
        setLayer(leavingClip ? { kind: 'cross', clip: leavingClip } : { kind: 'idle' })
        window.setTimeout(() => {
          if (isStale(token)) return
          if (leavingClip) pauseVideo(oneShotVideoRefs.current[leavingClip], true)
          activeOneShotRef.current = null
          setLayer({ kind: 'idle' })
          phaseRef.current = 'idle'
        }, KANSHAN_CROSSFADE_MS)
      },
      [isStale, pauseVideo, waitForVideoReady],
    )

    const enter = useCallback(() => {
      if (!motionEnabled) return
      if (phaseRef.current === 'entering' || phaseRef.current === 'idle' || phaseRef.current === 'gesturing') return
      const token = nextToken()
      phaseRef.current = 'entering'
      pauseVideo(idleVideoRef.current, true)
      playOneShot(token, 'appear', () => settleIntoIdle(token))
    }, [motionEnabled, nextToken, pauseVideo, playOneShot, settleIntoIdle])

    const appear = useCallback(() => {
      if (!motionEnabled) return
      if (phaseRef.current === 'idle' || phaseRef.current === 'gesturing' || phaseRef.current === 'entering') return
      const token = nextToken()
      KANSHAN_ONESHOT_IDS.forEach((clip) => pauseVideo(oneShotVideoRefs.current[clip], true))
      activeOneShotRef.current = null
      settleIntoIdle(token)
    }, [motionEnabled, nextToken, pauseVideo, settleIntoIdle])

    const gesture = useCallback(
      (target: KanshanGesture) => {
        if (!motionEnabled) return
        // idle 可起手势；gesturing 时允许被新点击直接打断切换，连点更跟手灵动。
        const phase = phaseRef.current
        if (phase !== 'idle' && phase !== 'gesturing') return
        const token = nextToken()
        phaseRef.current = 'gesturing'
        pauseVideo(idleVideoRef.current, true)
        KANSHAN_ONESHOT_IDS.forEach((clip) => {
          if (clip !== target) pauseVideo(oneShotVideoRefs.current[clip], true)
        })
        playOneShot(token, target, () => settleIntoIdle(token))
      },
      [motionEnabled, nextToken, pauseVideo, playOneShot, settleIntoIdle],
    )

    const curious = useCallback(() => {
      const candidates = CURIOUS_POOL.filter((item) => item !== lastCuriousRef.current)
      const pick = candidates[Math.floor(Math.random() * candidates.length)]
      lastCuriousRef.current = pick
      gesture(pick)
    }, [gesture])

    const leave = useCallback((): Promise<void> => {
      if (!motionEnabled) return Promise.resolve()
      const token = nextToken()
      phaseRef.current = 'leaving'
      pauseVideo(idleVideoRef.current, true)
      KANSHAN_ONESHOT_IDS.forEach((clip) => {
        if (clip !== 'retract') pauseVideo(oneShotVideoRefs.current[clip], true)
      })
      return new Promise<void>((resolve) => {
        playOneShot(token, 'retract', () => {
          pauseVideo(oneShotVideoRefs.current['retract'], true)
          activeOneShotRef.current = null
          if (isStale(token)) {
            resolve()
            return
          }
          setLayer({ kind: 'none' })
          phaseRef.current = 'hidden'
          resolve()
        })
      })
    }, [motionEnabled, nextToken, pauseVideo, playOneShot, isStale])

    useImperativeHandle(ref, () => ({ enter, appear, leave, gesture, curious }), [
      enter,
      appear,
      leave,
      gesture,
      curious,
    ])

    // 启用 / 降级与自动入场；页面不可见时延后到可见再入场，避免后台空放。
    useEffect(() => {
      if (!motionEnabled) {
        const token = nextToken()
        phaseRef.current = 'rest'
        pauseVideo(idleVideoRef.current, false)
        KANSHAN_ONESHOT_IDS.forEach((clip) => pauseVideo(oneShotVideoRefs.current[clip], false))
        setLayer({ kind: 'none' })
        return () => undefined
      }
      if (!autoEnter) return undefined
      if (phaseRef.current !== 'hidden' && phaseRef.current !== 'rest') return undefined
      if (document.visibilityState === 'visible') {
        enter()
        return undefined
      }
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return
        document.removeEventListener('visibilitychange', onVisible)
        enter()
      }
      document.addEventListener('visibilitychange', onVisible)
      return () => document.removeEventListener('visibilitychange', onVisible)
    }, [motionEnabled, autoEnter, enter, nextToken, pauseVideo])

    // 页面重新可见时把待机接回来：切走标签或系统省电会暂停纯视频媒体，回来后若
    // 继续停在原帧不动，角色看起来就是死的。
    useEffect(() => {
      if (!motionEnabled) return undefined
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return
        if (phaseRef.current !== 'idle') return
        const idle = idleVideoRef.current
        if (idle && idle.paused) {
          idle.currentTime = 0
          void idle.play().catch(() => undefined)
        }
      }
      document.addEventListener('visibilitychange', onVisible)
      return () => document.removeEventListener('visibilitychange', onVisible)
    }, [motionEnabled])

    // 卸载时作废播放序列。
    useEffect(
      () => () => {
        runIdRef.current += 1
      },
      [],
    )

    const setOneShotRef = useCallback((clip: OneShotId, node: HTMLVideoElement | null) => {
      if (node === null) delete oneShotVideoRefs.current[clip]
      else oneShotVideoRefs.current[clip] = node
    }, [])

    return (
      <span
        className={`kanshan-mascot${interactive ? ' is-interactive' : ''}${className ? ` ${className}` : ''}`}
        aria-hidden="true"
        onClick={
          interactive
            ? (event) => {
                event.stopPropagation()
                curious()
              }
            : undefined
        }
      >
        {motionEnabled ? (
          <>
            <video
              ref={idleVideoRef}
              className={`${MEDIA_BASE_CLASS}${layer.kind === 'idle' || layer.kind === 'cross' ? ' is-on' : ''}`}
              src={KANSHAN_SOURCES.idle}
              muted
              playsInline
              preload="auto"
              loop
            />
            {KANSHAN_ONESHOT_IDS.map((clip) => {
              const isActive = layer.kind === 'oneshot' && layer.clip === clip
              const isLeaving = layer.kind === 'cross' && layer.clip === clip
              const stateClass = isActive ? ' is-on' : isLeaving ? ' is-on is-leaving' : ''
              return (
                <video
                  key={clip}
                  ref={(node) => setOneShotRef(clip, node)}
                  className={`${MEDIA_BASE_CLASS}${stateClass}`}
                  src={KANSHAN_SOURCES[clip]}
                  data-clip={clip}
                  muted
                  playsInline
                  preload="auto"
                />
              )
            })}
          </>
        ) : (
          <img className={`${MEDIA_BASE_CLASS} kanshan-mascot__media--rest is-on`} src={KANSHAN_REST_FRAME} alt="" />
        )}
      </span>
    )
  },
)
