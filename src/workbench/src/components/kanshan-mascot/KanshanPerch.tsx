import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { KanshanMascot, type KanshanMascotHandle } from './KanshanMascot'
import { kanshanDirector, useKanshanDirector, type KanshanPerchApi, type KanshanPerchId } from './kanshan-director'
import './kanshan-perch.css'

export interface KanshanPerchProps {
  /** 栖位身份。 */
  readonly perchId: KanshanPerchId
  /** 定位与尺寸类名（栖位根容器），由所在界面决定角色所在位置。 */
  readonly className?: string
  /** 挂载时是否优先认领角色（输入框栖位用），卸载时归还给默认栖位。 */
  readonly claimActive?: boolean
}

/**
 * 受控栖位：自身不决定何时出现，统一由全局导演编排。未激活时用
 * visibility:hidden 保留布局占位，激活时才显示并播放入场 / 缩回动画。
 */
export const KanshanPerch = forwardRef<KanshanMascotHandle, KanshanPerchProps>(
  function KanshanPerch({ perchId, className, claimActive = false }, forwardedRef) {
    const mascotRef = useRef<KanshanMascotHandle>(null)
    const snapshot = useKanshanDirector()

    useEffect(() => {
      const api: KanshanPerchApi = {
        handle: {
          enter: () => mascotRef.current?.enter(),
          appear: () => mascotRef.current?.appear(),
          leave: () => (mascotRef.current ? mascotRef.current.leave() : Promise.resolve()),
          gesture: (gesture) => mascotRef.current?.gesture(gesture),
          curious: () => mascotRef.current?.curious(),
        },
      }
      kanshanDirector.register(perchId, api)
      if (claimActive) kanshanDirector.prefer(perchId)
      return () => {
        if (claimActive) kanshanDirector.unprefer(perchId)
        kanshanDirector.unregister(perchId)
      }
    }, [perchId, claimActive])

    useImperativeHandle(
      forwardedRef,
      () => ({
        enter: () => mascotRef.current?.enter(),
        appear: () => mascotRef.current?.appear(),
        leave: () => (mascotRef.current ? mascotRef.current.leave() : Promise.resolve()),
        gesture: (gesture) => mascotRef.current?.gesture(gesture),
        curious: () => mascotRef.current?.curious(),
      }),
      [],
    )

    const active = snapshot.activePerch === perchId
    return (
      <span
        className={`kanshan-perch${className ? ` ${className}` : ''}`}
        data-active={active}
        style={{ visibility: active ? 'visible' : 'hidden' }}
        aria-hidden="true"
      >
        <KanshanMascot ref={mascotRef} autoEnter={false} className="kanshan-perch__body" />
      </span>
    )
  },
)
