import { useRef, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import type { WorkbenchView } from '../../../../workbench/navigation-state'
import { MOTION_EASING, MOTION_TIMING, useMotionEnabled } from '../../../../shell/motion-system'
import { isEntryView } from '../../../../components/entry-surface/entry-surface'

/** 侧栏自上而下的阅读顺序，决定切换的位移方向。 */
const VIEW_ORDER: readonly WorkbenchView[] = ['home', 'explore', 'ask', 'voices', 'mine']
/** 切换时两层一起平移的距离。两层同速同向，读起来才是「同一列内容被推过一格」。 */
const VIEW_SHIFT = 28

const SURFACE_VARIANTS = {
  enter: (direction: number) => ({ opacity: 0, x: direction * VIEW_SHIFT }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -VIEW_SHIFT }),
}

/** 阅读表面的整页切换：两层绝对定位铺满同一个容器，切换期间新旧重叠、不产生布局跳动。
 *  深度研究与众声的入口同版式，共用同一个常驻层——两层之间切换时不重挂载，
 *  改由入口外壳逐格换掉对象，所以这里按「入口组」而不是按单个视图分组。 */
export function WorkbenchViewTransition(props: {
  readonly view: WorkbenchView
  readonly children: ReactNode
}) {
  const motionEnabled = useMotionEnabled()
  const group: WorkbenchView | 'entry-group' = isEntryView(props.view) ? 'entry-group' : props.view
  // 方向只在分组真正变化时更新；写入 ref 是为了让退出层也用上本次的方向。
  const lastViewRef = useRef(props.view)
  const directionRef = useRef(1)
  if (lastViewRef.current !== props.view) {
    directionRef.current = viewOrderIndex(props.view) >= viewOrderIndex(lastViewRef.current) ? 1 : -1
    lastViewRef.current = props.view
  }
  const direction = directionRef.current
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <AnimatePresence initial={false} custom={direction}>
        <Layer key={group} direction={direction} motionEnabled={motionEnabled}>
          {props.children}
        </Layer>
      </AnimatePresence>
    </div>
  )
}

function Layer(props: {
  readonly direction: number
  readonly motionEnabled: boolean
  readonly children: ReactNode
}) {
  const isPresent = useIsPresent()
  return (
    <motion.div
      className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
      aria-hidden={!isPresent}
      inert={!isPresent}
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
      custom={props.direction}
      variants={SURFACE_VARIANTS}
      initial={props.motionEnabled ? 'enter' : false}
      animate="center"
      exit={props.motionEnabled ? 'exit' : undefined}
      transition={{ duration: MOTION_TIMING.panel, ease: MOTION_EASING.premium }}
    >
      {props.children}
    </motion.div>
  )
}

function viewOrderIndex(view: WorkbenchView): number {
  const index = VIEW_ORDER.indexOf(view)
  return index === -1 ? VIEW_ORDER.length : index
}
