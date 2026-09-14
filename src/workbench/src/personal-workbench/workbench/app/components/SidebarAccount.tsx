import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { LogOut, User as UserIcon } from 'lucide-react'
import { logoutZhihuAccount, useZhihuSession } from '@ui/workbench/zhihu-account'
import { useZhihuLogin } from '@ui/features/auth/login-request'
import type { ZhihuAccountProfile, ZhihuSessionState } from '@ui/workbench/zhihu-account'

interface SidebarAccountProps {
  readonly active: boolean
  readonly onOpenMine: () => void
}

/**
 * 侧栏底部账号区：只呈现当前知乎账号，不重复产品标志与品牌文案。
 * 登录后显示头像与昵称，其余状态如实呈现登录入口；登录与「我的知乎」门禁共用一次跳转。
 */
export function SidebarAccount({ active, onOpenMine }: SidebarAccountProps) {
  const { state } = useZhihuSession()
  const { openLogin } = useZhihuLogin()
  const reducedMotion = useReducedMotion()
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
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
  const nameChars = Array.from(view.name)
  // 身份动效的唯一状态源。每个字各自持有 variants 并直接接收这个标签：
  // 动效按字符索引错开，且不依赖父级 variants 向 motion 子树透传。
  const identityState = menuOpen || active ? 'active' : hovered ? 'hover' : 'rest'

  return (
    <div
      ref={rootRef}
      className="ui-sidebar-account"
      data-active={active || undefined}
      // 悬停从整块账号区采集：行内还包含头像与留白，外层容器能覆盖整块区域，
      // 动效也因此在任何登录状态下都一致生效。
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="ui-sidebar-account__trigger"
        aria-label={menuAvailable ? `${view.name}，账号菜单` : view.authenticated ? `${view.name}，进入我的知乎` : '登录知乎账号'}
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
        <AccountAvatar profile={view.profile} authenticated={view.authenticated} />
        <span className="ui-sidebar-account__identity">
          <span className="ui-sidebar-account__name">
            {nameChars.map((char, index) => (
              <motion.span
                key={`${char}-${index}`}
                className="ui-sidebar-account__char"
                initial="rest"
                animate={identityState}
                variants={{
                  rest: { y: 0, color: 'var(--ui-text-1)' },
                  hover: { y: reducedMotion ? 0 : -2, color: 'var(--ui-accent)' },
                  active: { y: 0, color: 'var(--ui-accent)' },
                }}
                transition={reducedMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 320, damping: 15, delay: index * 0.05 }}
              >
                {char}
              </motion.span>
            ))}
          </span>
          <motion.span
            className="ui-sidebar-account__underline"
            aria-hidden="true"
            initial="rest"
            animate={identityState}
            variants={{
              rest: { scaleX: 0, opacity: 0 },
              hover: { scaleX: 1, opacity: 1 },
              active: { scaleX: 1, opacity: 1 },
            }}
            transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 26 }}
          />
        </span>
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
 * 账号头像位始终占位：已登录优先显示真实头像，取不到时用昵称首字；
 * 未登录显示中性的人形图标，让这一行在不看文案时也读得出是账号入口。
 */
function AccountAvatar({ profile, authenticated }: {
  readonly profile: ZhihuAccountProfile | undefined
  readonly authenticated: boolean
}) {
  const [broken, setBroken] = useState(false)
  const avatarUrl = authenticated ? profile?.avatarUrl : undefined
  if (avatarUrl !== undefined && avatarUrl !== '' && !broken) {
    return (
      <img
        className="ui-sidebar-account__avatar"
        src={avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setBroken(true)}
      />
    )
  }
  const initial = authenticated ? profile?.fullname?.trim().slice(0, 1) : undefined
  if (initial !== undefined && initial !== '') {
    return <span className="ui-sidebar-account__avatar ui-sidebar-account__avatar--initial" aria-hidden="true">{initial}</span>
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
  readonly profile: ZhihuAccountProfile | undefined
}

/**
 * 侧栏账号行的唯一投影，只给出一行身份。
 * 没有真实知乎会话时一律是「登录知乎」；只有拿到明确已登录的会话才显示昵称。
 */
function accountView(state: ZhihuSessionState): AccountView {
  const session = state.status === 'ready' ? state.session : undefined
  const hasSession = session?.authenticated === true && session.developerMode !== true
  if (!hasSession) {
    return {
      name: '登录知乎',
      authenticated: false,
      canLogout: false,
      profile: undefined,
    }
  }
  const profile = session.profile
  // 资料端点没有正式契约，可能读不到昵称；此时仍如实表明已登录，不退回登录入口。
  return {
    name: profile?.fullname ?? '已登录知乎',
    authenticated: true,
    canLogout: true,
    profile,
  }
}
