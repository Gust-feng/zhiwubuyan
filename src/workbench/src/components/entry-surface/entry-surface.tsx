import type { ReactNode } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import type { WorkbenchView } from '../../workbench/navigation-state'
import { MOTION_EASING, useMotionEnabled } from '../../shell/motion-system'
import './entry-surface.css'

export type EntryView = 'ask' | 'voices'

/** 入口同版式的视图：深度研究与众声。 */
export function isEntryView(view: WorkbenchView): view is EntryView {
  return view === 'ask' || view === 'voices'
}

/** 图标一格的换法：位置与尺寸基本锁定（同中心、极轻微收放），主体是旧的淡出、新的淡入。
 *  两个图标在同一格中心交替，读起来是这一格里的图标被换掉。 */
const EMBLEM_VARIANTS: Variants = {
  enter: { opacity: 0, scale: 0.9 },
  center: { opacity: 1, scale: 1, transition: { duration: 0.18, ease: MOTION_EASING.standard } },
  exit: { opacity: 0, scale: 1.06, transition: { duration: 0.12, ease: MOTION_EASING.exit } },
}

/** 深度研究与众声共用的常驻入口外壳。
 *  外壳（版心、图标位、标题位、卡片外框）由这一个组件持有，跨视图不重建。
 *  只有图标一格做换场动画；标题、建议卡、输入卡按视图直接换内容，不加过渡，
 *  这样除图标外不会有任何东西在过场里位移或叠影。
 *  看山不在这里：它常驻侧栏，属于全局结构，见 KanshanPerch。 */
export function EntrySurface(props: {
  readonly view: EntryView
  readonly emblem: ReactNode
  readonly title: string
  readonly seeds: ReactNode
  readonly composer: ReactNode
}) {
  const motionEnabled = useMotionEnabled()
  return (
    <div className="entry-live">
      <div className="entry-start">
        <div className="entry-start__content">
          <div className="entry-start__head">
            <EmblemSlot view={props.view} motionEnabled={motionEnabled}>{props.emblem}</EmblemSlot>
            <h1 className="entry-title">{props.title}</h1>
          </div>
          <div className="entry-slot entry-seeds" role="group" aria-label="可以试试的议题">{props.seeds}</div>
          <div className={`entry-slot entry-composer ${props.view === 'ask' ? 'dr-composer' : 'voices-composer'}`}>
            {props.composer}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 图标位：容器常驻，图标盒本身不参与动画（尺寸位置锁定），只有图标内容淡换。
 *  换出期间让出交互与无障碍树，过场那一瞬不会留下旧图标被读到或点到。 */
function EmblemSlot(props: {
  readonly view: EntryView
  readonly motionEnabled: boolean
  readonly children: ReactNode
}) {
  return (
    <div className="entry-slot entry-emblem">
      {/* initial={false}：首次进入不做淡入，避免启动时图标先空一下。 */}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={props.view}
          className="entry-emblem__glyph"
          aria-hidden
          variants={props.motionEnabled ? EMBLEM_VARIANTS : undefined}
          initial={props.motionEnabled ? 'enter' : false}
          animate={props.motionEnabled ? 'center' : undefined}
          exit={props.motionEnabled ? 'exit' : undefined}
        >
          {props.children}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
