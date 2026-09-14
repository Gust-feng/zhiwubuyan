import {
  Compass,
  Home,
  Scale,
  Sparkles,
} from 'lucide-react'
import { SidebarAccount } from './SidebarAccount'
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

const SIDEBAR_W           = 208
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
      className="ui-sidebar relative h-full shrink-0 select-none overflow-hidden"
      aria-label="主导航"
      style={{
        width:    collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_W,
        minWidth: collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_W,
        borderRight: collapsed ? 'none' : '1px solid var(--ui-border)',
        transition: 'width 260ms cubic-bezier(0.4,0,0.2,1), min-width 260ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <style>{`
        .ui-conversation-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .ui-conversation-scroll::-webkit-scrollbar { display: none; }
      `}</style>
      <div
        className="ui-sidebar__inner relative flex flex-col h-full"
        style={{ width: SIDEBAR_W, minWidth: SIDEBAR_W }}
      >
      <header className="ui-sidebar__brand">
        <span className="ui-sidebar__brand-name">知无不言</span>
        <span className="ui-sidebar__brand-line">更大的问题 · 更清晰的世界</span>
      </header>

      <nav
        className="ui-sidebar__nav flex-1 overflow-y-auto"
        style={{
          scrollbarWidth: 'none',
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          transition: collapsed
            ? 'opacity 120ms ease'
            : 'opacity 260ms ease 160ms',
        }}
      >
        <div className="ui-sidebar__nav-list">
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

      <p className="ui-sidebar__credo"><span />让问题成为一种习惯</p>
      <SidebarAccount active={view === 'mine'} onOpenMine={() => onNavigate('mine')} />
      <SidebarFooter />
      </div>

    </aside>
  )
}
