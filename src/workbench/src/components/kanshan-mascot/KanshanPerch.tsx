import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { KanshanMascot, type KanshanMascotHandle } from './KanshanMascot'
import { kanshanDirector, useKanshanDirector, type KanshanPerchApi, type KanshanPerchId } from './kanshan-director'
import './kanshan-perch.css'

export interface KanshanPerchProps {
  /** 栖位身份，全局唯一。 */
  readonly perchId: KanshanPerchId
  /** 定位与尺寸类名（栖位根容器），由所在界面决定趴伏位置。 */
  readonly className?: string
}

/**
 * 受控栖位：自身不决定何时出现，统一由全局导演编排。未激活时用
 * visibility:hidden 保留布局占位，激活时才显示并播放探出 / 缩起动画。
 */
export const KanshanPerch = forwardRef<KanshanMascotHandle, KanshanPerchProps>(
  function KanshanPerch({ perchId, className }, forwardedRef) {
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
      return () => kanshanDirector.unregister(perchId)
    }, [perchId])

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
