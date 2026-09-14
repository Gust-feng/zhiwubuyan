import {
  Compass,
  Home,
  Scale,
  Sparkles,
} from 'lucide-react'
import { SidebarAccount } from './SidebarAccount'
import { SidebarResearchPrompt } from './SidebarResearchPrompt'
import { SidebarFooter } from './SidebarFooter'
import {
  SidebarNavRow,
} from './SidebarRows'
import type { WorkbenchView } from '../../../../workbench/navigation-state'

/** 全局导航选择功能板块；对话历史由右侧面板管理。 */
export type View = WorkbenchView

interface SidebarProps {
  view: View
  onNavigate: (v: View) => void
  collapsed: boolean
}

const SIDEBAR_W           = 236
const SIDEBAR_COLLAPSED_W = 0

// ── Sidebar ──────────────────────────────────────────────────────────────────
export function Sidebar({
  view,
  onNavigate,
  collapsed,
}: SidebarProps) {
  // Structural state changes are intentionally atomic. The previous staged
  // label/width timers left the sidebar in a visible in-between geometry, which
  // read as horizontal drift. Only the contained mist mark retains motion.
  const labelsVisible = !collapsed

  return (
    <aside
      className="relative h-full shrink-0 select-none overflow-hidden"
      style={{
        width:    collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_W,
        minWidth: collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_W,
        background:  'var(--ui-surface)',
        // 收起后连边框都不留,做到真正意义上的「消失」。
        borderRight: collapsed ? 'none' : '1px solid var(--ui-border)',
        // Only the outer rail width animates. The inner column stays a fixed
        // width and is simply clipped, so no descendant ever reflows / drifts
        // while the rail glides between states.
        transition: 'width 260ms cubic-bezier(0.4,0,0.2,1), min-width 260ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <style>{`
        .ui-conversation-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .ui-conversation-scroll::-webkit-scrollbar { display: none; }
      `}</style>
      {/* 侧边栏常驻显示，不再提供收起开关。 */}

      {/* Fixed-width inner column — never resizes, so nothing inside can be
          compressed or pushed around during the collapse animation. Sits above
          the line-art backdrop. */}
      <div
        className="relative flex flex-col h-full"
        style={{ width: SIDEBAR_W, minWidth: SIDEBAR_W }}
      >
      <SidebarAccount onOpenMine={() => onNavigate('mine')} />

      {/* ── Navigation ── */}
      {/* Collapsed: the whole nav column is hidden (fade out). Kept mounted so
          it can be restored instantly if we decide to bring it back. */}
      <nav
        className="flex-1 overflow-y-auto py-2 px-2"
        style={{
          scrollbarWidth: 'none',
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          transition: collapsed
            ? 'opacity 120ms ease'
            : 'opacity 260ms ease 160ms',
        }}
      >
        {/* 核心动作入口 */}
        <div className="space-y-0.5">
          <SidebarNavRow
            active={view === 'home'}
            onClick={() => onNavigate('home')}
            labelsVisible={labelsVisible}
            collapsed={collapsed}
            icon={<Home size={14}/>}
            label="首页"
          />
          <SidebarNavRow
            active={view === 'explore'}
            onClick={() => onNavigate('explore')}
            labelsVisible={labelsVisible}
            collapsed={collapsed}
            icon={<Compass size={14}/>}
            label="探索"
          />
          <SidebarNavRow
            active={view === 'ask'}
            onClick={() => onNavigate('ask')}
            labelsVisible={labelsVisible}
            collapsed={collapsed}
            icon={<Sparkles size={14}/>}
            label="深度研究"
          />
          <SidebarNavRow
            active={view === 'voices'}
            onClick={() => onNavigate('voices')}
            labelsVisible={labelsVisible}
            collapsed={collapsed}
            icon={<Scale size={14}/>}
            label="众声"
          />
        </div>
      </nav>

      <SidebarResearchPrompt collapsed={collapsed} onStartResearch={() => onNavigate('ask')} />
      <SidebarFooter />
      </div>

    </aside>
  )
}
