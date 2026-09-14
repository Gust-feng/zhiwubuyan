import { useEffect, useRef, useState } from 'react'
import { LogOut, User as UserIcon } from 'lucide-react'
import { BrandMark } from '@ui/components/brand-mark'
import { isZhihuUserSession, logoutZhihuAccount, useZhihuSession } from '@ui/workbench/zhihu-account'
import { useZhihuLogin } from '@ui/features/auth/login-request'
import type { ZhihuSessionState } from '@ui/workbench/zhihu-account'

interface SidebarAccountProps {
  readonly active: boolean
  readonly onOpenMine: () => void
}

/**
 * 侧栏底部头像入口：登录与「我的知乎」门禁共用一次跳转；产品品牌文案由侧栏刊头统一承载。
 */
export function SidebarAccount({ active, onOpenMine }: SidebarAccountProps) {
  const { state } = useZhihuSession()
  const { openLogin } = useZhihuLogin()
  const [menuOpen, setMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    const closeOnViewportChange = (): void => setMenuOpen(false)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', closeOnViewportChange)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', closeOnViewportChange)
    }
  }, [menuOpen])

  function beginLogin(): void {
    openLogin('mine')
  }

  function openLogout(): void {
    setMenuOpen(false)
    setLoggingOut(true)
    setActionError(undefined)
    logoutZhihuAccount()
      .then(() => window.location.reload())
      .catch(() => {
        setLoggingOut(false)
        setActionError('退出登录失败，请稍后重试。')
      })
  }

  const view = accountView(state)
  // 账号行始终可点：未登录时打开登录弹窗（即使登录尚未接通，弹窗也会说明缺什么），
  // 已登录时进入账号菜单或「我的知乎」。只有退出登录进行中才临时禁用。
  const interactive = !loggingOut
  // 有可执行的账号动作才展开菜单；没有动作时点整行直接进入「我的知乎」。
  const menuAvailable = view.canLogout
  return (
    <div
      ref={rootRef}
      className="ui-sidebar-account"
      data-active={active || undefined}
      data-authenticated={view.authenticated ? 'true' : 'false'}
    >
      <button
        type="button"
        className="ui-sidebar-account__trigger"
        aria-label={menuAvailable ? `${view.name}，账号菜单` : view.authenticated ? `${view.name}，进入我的知乎` : '登录知乎账号'}
        title={menuAvailable ? '账号菜单' : view.authenticated ? '我的知乎' : '使用知乎登录'}
        aria-haspopup={menuAvailable ? 'menu' : undefined}
        aria-expanded={menuAvailable ? menuOpen : undefined}
        disabled={!interactive}
        onClick={() => {
          setActionError(undefined)
          if (menuAvailable) setMenuOpen((open) => !open)
          else if (view.authenticated) onOpenMine()
          else beginLogin()
        }}
      >
        <AccountAvatar authenticated={view.authenticated} />
      </button>

      {actionError !== undefined && (
        <div className="ui-sidebar-account__error" role="status">{actionError}</div>
      )}

      {menuOpen && (
        <div className="ui-sidebar-account__menu" role="menu" aria-label="账号菜单">
          <button
            type="button"
            role="menuitem"
            className="ui-sidebar-account__menu-item"
            onClick={() => {
              setMenuOpen(false)
              onOpenMine()
            }}
          >
            <UserIcon size={14} aria-hidden="true" />
            <span>我的知乎</span>
          </button>
          {view.canLogout && (
            <button
              type="button"
              role="menuitem"
              className="ui-sidebar-account__menu-item ui-sidebar-account__menu-item--danger"
              onClick={openLogout}
            >
              <LogOut size={14} aria-hidden="true" />
              <span>退出登录</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 账号头像位始终占位：未登录显示中性的人形图标，已登录显示产品标志；
 * 用户头像与昵称属于个人档案内容，不和产品账号入口混在一起。
 */
function AccountAvatar({ authenticated }: {
  readonly authenticated: boolean
}) {
  if (authenticated) {
    return (
      <span className="ui-sidebar-account__avatar ui-sidebar-account__avatar--brand" aria-hidden="true">
        <BrandMark size={24} />
      </span>
    )
  }
  return (
    <span className="ui-sidebar-account__avatar ui-sidebar-account__avatar--icon" aria-hidden="true">
      <UserIcon size={18} />
    </span>
  )
}

type AccountView = {
  readonly name: string
  readonly authenticated: boolean
  readonly canLogout: boolean
}

/**
 * 侧栏账号行的唯一投影，只给出一行身份。
 * 没有真实知乎会话时一律是「登录知乎」；明确登录后才显示产品身份。
 */
function accountView(state: ZhihuSessionState): AccountView {
  const session = state.status === 'ready' ? state.session : undefined
  const hasSession = isZhihuUserSession(session)
  if (!hasSession) {
    return {
      name: '登录知乎',
      authenticated: false,
      canLogout: false,
    }
  }
  // 账号入口固定使用产品身份，个人昵称与头像在首页和个人档案中展示。
  return {
    name: '知无不言',
    authenticated: true,
    canLogout: true,
  }
}
