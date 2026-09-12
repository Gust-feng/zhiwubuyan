import { motion } from 'motion/react'
import { KANSHAN_SOURCES } from './kanshan-clips'
import { kanshanDirector, useKanshanDirector } from './kanshan-director'
import './kanshan-flight.css'

const FLIGHT_DURATION = 0.52
const FLIGHT_EASE = [0.22, 1, 0.36, 1] as const

/**
 * 跨栖位迁移时的唯一可见角色：fixed 飞行层从来源矩形移动到目标矩形，
 * 途中带轻微蹦跳与朝移动方向的倾斜；落地后由导演交给目标栖位。飞行层
 * 不拦截指针，且只在迁移间隙出现，因此任意时刻屏幕上至多一只刘看山。
 */
export function KanshanFlightLayer() {
  const { flight } = useKanshanDirector()
  if (!flight) return null

  const { id, from, to } = flight
  const dx = to.x - from.x
  const dy = to.y - from.y
  const scaleX = to.width / from.width
  const scaleY = to.height / from.height
  const tilt = dx >= 0 ? [0, 6, -4, 0] : [0, -6, 4, 0]

  return (
    <motion.div
      className="kanshan-flight"
      style={{ left: from.x, top: from.y, width: from.width, height: from.height }}
      initial={{ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }}
      animate={{ x: dx, y: dy, scaleX, scaleY }}
      transition={{ duration: FLIGHT_DURATION, ease: FLIGHT_EASE }}
      onAnimationComplete={() => kanshanDirector.finishFlight(id)}
    >
      <motion.div
        className="kanshan-flight__bob"
        animate={{ y: [0, -8, 3, -6, 0], rotate: tilt }}
        transition={{ duration: FLIGHT_DURATION, ease: 'easeInOut' }}
      >
        <video
          key={id}
          className="kanshan-flight__video"
          src={KANSHAN_SOURCES.idle}
          muted
          playsInline
          autoPlay
        />
      </motion.div>
    </motion.div>
  )
}
