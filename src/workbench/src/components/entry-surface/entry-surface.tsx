import type { ReactNode } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import type { WorkbenchView } from '../../workbench/navigation-state'
import { MOTION_EASING, useMotionEnabled } from '../../shell/motion-system'
import './entry-surface.css'

/** 使用入口外壳的视图：深度研究、众声、成象。
 *  三者共用同一个常驻外壳，切换时外壳不重建，图标在同一中心交替、各格内容就地换掉。 */
export type EntryView = 'ask' | 'voices' | 'imagery'

/** 入口同版式的视图：深度研究、众声、成象。 */
export function isEntryView(view: WorkbenchView): view is EntryView {
  return view === 'ask' || view === 'voices' || view === 'imagery'
}

/** 图标一格的换法：位置与尺寸基本锁定（同中心、极轻微收放），主体是旧的淡出、新的淡入。
 *  两个图标在同一格中心交替，读起来是这一格里的图标被换掉。 */
const EMBLEM_VARIANTS: Variants = {
  enter: { opacity: 0, scale: 0.9 },
  center: { opacity: 1, scale: 1, transition: { duration: 0.18, ease: MOTION_EASING.standard } },
  exit: { opacity: 0, scale: 1.06, transition: { duration: 0.12, ease: MOTION_EASING.exit } },
}

/** 文字格的换法：**先退后进，两段不重叠**。
 *  两个入口的标题与建议条目一个字都不一样，若同时淡换，两张字会在同一位置叠成一团、
 *  谁也读不清——这就是「看着像一坨」的来源。所以旧字先退干净（exit 结束即 delay 结束），
 *  新字才进场，全程没有一张字在重叠。
 *  两段都用同一个网格单元挂载（谁都不脱离文档流），中间那一格不会塌，下面的输入卡也不跳。 */
const SWAP_VARIANTS: Variants = {
  enter: { opacity: 0, y: 5 },
  center: { opacity: 1, y: 0, transition: { duration: 0.15, ease: MOTION_EASING.standard, delay: 0.08 } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.08, ease: MOTION_EASING.exit } },
}

/** 深度研究、众声与成象共用的常驻入口外壳。
 *  外壳（版心、图标位、标题位、卡片外框）由这一个组件持有，跨视图不重建。
 *  图标、标题与建议卡这三格都是「同一处内容被换掉」：图标在自己中心交替，标题与建议卡原地淡换。
 *  seeds 可选：没有建议内容的格子（成象）直接不渲染这一格。
 *  看山不在这里：它常驻侧栏，属于全局结构，见 KanshanPerch。 */
export function EntrySurface(props: {
  readonly view: EntryView
  readonly emblem: ReactNode
  readonly title: string
  readonly seeds?: ReactNode
  readonly composer: ReactNode
}) {
  const motionEnabled = useMotionEnabled()
  return (
    <div className="entry-live">
      <div className="entry-start">
        <div className="entry-start__content">
          <div className="entry-start__head">
            <EmblemSlot view={props.view} motionEnabled={motionEnabled}>{props.emblem}</EmblemSlot>
            <SwapSlot view={props.view} motionEnabled={motionEnabled} className="entry-title-swap">
              <h1 className="entry-title">{props.title}</h1>
            </SwapSlot>
          </div>
          {props.seeds != null && (
            <div className="entry-slot entry-seeds" role="group" aria-label="可以试试的议题">
              <SwapSlot view={props.view} motionEnabled={motionEnabled}>{props.seeds}</SwapSlot>
            </div>
          )}
          <div className={`entry-slot entry-composer ${composerClass(props.view)}`}>
            {props.composer}
          </div>
        </div>
      </div>
    </div>
  )
}

function composerClass(view: EntryView): string {
  if (view === 'ask') return 'dr-composer'
  if (view === 'imagery') return 'imagery-composer-slot'
  return 'voices-composer'
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

/** 静内容格：两个入口共用同一处位置，切换时旧字先退干净、新字再进场，位置与高度都不动。
 *  做法是把两侧内容叠在同一个网格单元里（都不脱离文档流、默认 sync 模式同时挂载），
 *  所以中间不会出现一格是空的、外框不重画，也没有重排引起的跳动。 */
function SwapSlot(props: {
  readonly view: EntryView
  readonly motionEnabled: boolean
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <div className={`entry-swap ${props.className ?? ''}`}>
      {/* initial={false}：首次进入不做淡入，只有跨视图切换才换场。 */}
      <AnimatePresence initial={false}>
        <motion.div
          key={props.view}
          className="entry-swap__pane"
          variants={props.motionEnabled ? SWAP_VARIANTS : undefined}
          initial={props.motionEnabled ? 'enter' : false}
          animate={props.motionEnabled ? 'center' : undefined}
          exit={props.motionEnabled ? 'exit' : undefined}
        >
          {props.children}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
