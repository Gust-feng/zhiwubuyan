import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { LoginDialog } from './login-dialog'
import { requestZhihuLogin } from '@ui/workbench/zhihu-account'
import { useWorkbenchSurface } from '@ui/workbench/surface'

type LoginRequest = {
  /** 请求登录；桌面端开独立窗口，网页端打开应用内弹窗。 */
  readonly openLogin: (returnView: string, notice?: string) => void
}

/** 登录可用性三态；弹窗据此决定按钮是否可点与显示哪种说明。 */
export type LoginAvailability = 'probing' | 'available' | 'unconfigured'

const LoginRequestContext = createContext<LoginRequest | undefined>(undefined)

type PendingLogin = {
  readonly returnView: string
  /** 附带说明，如授权回调带回的失败原因。 */
  readonly notice?: string
}

/**
 * 登录请求的唯一入口：侧栏账号区、首页动作与各板块门禁都从这里发起登录。
 * 桌面端交给主进程开独立登录窗口，网页端在同一棵树里渲染登录弹窗。
 *
 * 无论登录是否已接通，入口都可点开弹窗：未接通时弹窗内如实说明缺哪些配置，
 * 而不是把入口做成点了没反应的死按钮。
 */
export function ZhihuLoginProvider({ children }: { readonly children: ReactNode }) {
  const surface = useWorkbenchSurface()
  const [pending, setPending] = useState<PendingLogin>()

  const openLogin = useCallback((returnView: string, notice?: string) => {
    // 只有确认是桌面端才交给独立登录窗口；运行面未确认时用应用内弹窗更安全。
    if (requestZhihuLogin(surface.ready ? surface.surface : undefined)) return
    setPending(notice === undefined ? { returnView } : { returnView, notice })
  }, [surface])

  const request = useMemo<LoginRequest>(() => ({ openLogin }), [openLogin])

  const availability: LoginAvailability = !surface.ready
    ? 'probing'
    : surface.loginAvailable
      ? 'available'
      : 'unconfigured'

  return (
    <LoginRequestContext.Provider value={request}>
      {children}
      {pending !== undefined && (
        <LoginDialog
          returnView={pending.returnView}
          notice={pending.notice}
          onClose={() => setPending(undefined)}
          availability={availability}
          missingConfig={surface.loginMissingConfig}
          redirectUri={surface.loginRedirectUri}
        />
      )}
    </LoginRequestContext.Provider>
  )
}

/** 只能用在 ZhihuLoginProvider 内部；未挂载时明确报错而不是静默失败。 */
export function useZhihuLogin(): LoginRequest {
  const value = useContext(LoginRequestContext)
  if (value === undefined) throw new Error('useZhihuLogin 必须在 ZhihuLoginProvider 内使用。')
  return value
}
