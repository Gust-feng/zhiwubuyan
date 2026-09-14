import {
  Clapperboard,
  Compass,
  Home,
  Scale,
  Sparkles,
} from 'lucide-react'
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

// 侧栏保持窄幅，让阅读面始终是视觉重心，同时为桌面端四个导航标签留出完整宽度。
const SIDEBAR_W           = 176
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
      <header className="ui-sidebar__brand" aria-label="知无不言">
        <span className="ui-sidebar__brand-name">知无不言</span>
        <span className="ui-sidebar__brand-line">好奇心，带我们去更大的世界</span>
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
            icon={<Home size={17}/>}
            label="首页"
          />
          <SidebarNavRow
            active={view === 'explore'}
            onClick={() => onNavigate('explore')}
            labelsVisible={labelsVisible}
            collapsed={collapsed}
            icon={<Compass size={17}/>}
            label="探索"
          />
          <SidebarNavRow
            active={view === 'ask'}
            onClick={() => onNavigate('ask')}
            labelsVisible={labelsVisible}
            collapsed={collapsed}
            icon={<Sparkles size={17}/>}
            label="深度研究"
          />
          <SidebarNavRow
            active={view === 'voices'}
            onClick={() => onNavigate('voices')}
            labelsVisible={labelsVisible}
            collapsed={collapsed}
            icon={<Scale size={17}/>}
            label="众声"
          />
          <SidebarNavRow
            active={view === 'imagery'}
            onClick={() => onNavigate('imagery')}
            labelsVisible={labelsVisible}
            collapsed={collapsed}
            icon={<Clapperboard size={17}/>}
            label="成象"
          />
        </div>
      </nav>

      <div className="ui-sidebar__bottom">
        <p className="ui-sidebar__credo">
          <span />
          <em>问题之上</em>
          <em>自有天地</em>
        </p>
      </div>
      </div>

    </aside>
  )
}
