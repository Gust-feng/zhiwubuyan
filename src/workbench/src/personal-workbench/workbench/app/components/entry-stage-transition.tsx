import type { ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { MOTION_EASING, MOTION_TIMING, useMotionEnabled } from '../../../../shell/motion-system'

/** 同一入口内的提交与结果过渡；跨板块的入口仍共用一个常驻层。 */
export function EntryStageTransition({ stage, children }: {
  readonly stage: 'entry' | 'busy' | 'done' | 'error'
  readonly children: ReactNode
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <AnimatePresence initial={false}>
        <StageLayer key={stage}>{children}</StageLayer>
      </AnimatePresence>
    </div>
  )
}

function StageLayer({ children }: { readonly children: ReactNode }) {
  const present = useIsPresent()
  const motionEnabled = useMotionEnabled()

  return (
    <motion.div
      className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
      aria-hidden={!present}
      inert={!present}
      initial={motionEnabled ? { opacity: 0, y: 8, scale: .99 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={motionEnabled ? {
        opacity: 0,
        y: -4,
        transition: { duration: MOTION_TIMING.quick, ease: MOTION_EASING.exit },
      } : undefined}
      transition={{ duration: motionEnabled ? MOTION_TIMING.panel : 0, ease: MOTION_EASING.premium }}
    >
      {children}
    </motion.div>
  )
}
