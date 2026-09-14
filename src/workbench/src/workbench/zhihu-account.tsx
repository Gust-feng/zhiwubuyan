import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { rememberZhihuLoginReturn } from './zhihu-auth-navigation'
import { clearJsonCache, fetchJsonCached, readCachedJson } from '../personal-workbench/workbench/app/components/json-cache'
import { forgetEntrySeeds } from './entry-seeds'

/** 会话随附的展示资料；端点无正式契约，读取不到时整个 profile 缺省。 */
export type ZhihuAccountProfile = {
  readonly fullname: string
  readonly avatarUrl?: string
  readonly headline?: string
}

/** 运行面：桌面端登录走独立窗口，网页端在应用内弹窗。 */
export type ZhihuSurface = 'desktop' | 'web'

export type ZhihuSession = {
  readonly oauthEnabled: boolean
  readonly authenticated: boolean
  /** 本地开发预览用调用方身份读取个人数据，并非真实知乎登录。 */
  readonly developerMode?: boolean
  /** 展示资料来自无正式契约的端点，读取不到时整体缺省。 */
  readonly profile?: ZhihuAccountProfile
  readonly surface?: ZhihuSurface
}

export type ZhihuSessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly session: ZhihuSession }
  | { readonly status: 'error'; readonly message: string }

/**
 * 是否为用户本人完成 OAuth 授权的会话。
 * 本地开发数据开关只提供调用方数据预览，不等于用户已经登录；账号相关界面统一从这里判断。
 */
export function isZhihuUserSession(session: ZhihuSession | undefined): boolean {
  return session?.authenticated === true && session.developerMode !== true
}

/** 登录状态唯一读取入口：侧栏账号区与「我的知乎」共用同一形状。 */
export function isZhihuSession(value: unknown): value is ZhihuSession {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.oauthEnabled === 'boolean' && typeof record.authenticated === 'boolean'
}

const SESSION_PATH = '/api/auth/session'

async function readSessionBody(): Promise<unknown> {
  const response = await fetch(SESSION_PATH)
  if (!response.ok) throw new Error('暂时无法确认登录状态。')
  return await response.json()
}

/**
 * 登录状态取数：与 index.html 的启动预取共用同一条请求，同屏多处消费方也只发一次。
 * 不带 AbortSignal——请求是共享的单飞，首个调用者的取消会连带取消别人的；
 * 两个消费方（工作台根 Provider、桌面端登录窗口）都与页面同生命周期。
 */
export async function fetchZhihuSession(options: { force?: boolean } = {}): Promise<ZhihuSession> {
  const body = await fetchJsonCached(SESSION_PATH, readSessionBody, options)
  if (!isZhihuSession(body)) throw new Error('登录状态响应无法识别。')
  return body
}

/** 登录状态读取结果；多处消费方共用同一形状。 */
export type ZhihuSessionController = {
  readonly state: ZhihuSessionState
  readonly reload: () => void
}

/**
 * 会话状态的取数实现。工作台内由 Provider 持有唯一一份，
 * 独立登录窗口（不在工作台树下）自持一份即可，不必为它搭上下文。
 */
export function useZhihuSessionSource(): ZhihuSessionController {
  // 首帧直接认领已就绪的结果：线上这条请求要一秒左右，预取让它在解析阶段就发出，
  // 通常先于首帧回来，界面因此不会先渲染一帧加载态。
  const [state, setState] = useState<ZhihuSessionState>(() => {
    const body = readCachedJson<unknown>(SESSION_PATH)
    return isZhihuSession(body) ? { status: 'ready', session: body } : { status: 'loading' }
  })

  const load = useCallback((force: boolean) => {
    // 重新确认时不退回 loading：保留当前（或已知）状态，结果回来后原子替换。
    setState((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }))
    fetchZhihuSession({ force })
      .then((session) => setState({ status: 'ready', session }))
      .catch((error: unknown) => {
        // 已经有结果时保留它：一次网络抖动不该把已登录的界面打成错误态。
        setState((previous) => previous.status === 'ready'
          ? previous
          : {
            status: 'error',
            message: error instanceof Error ? error.message : '暂时无法确认登录状态。',
          })
      })
  }, [])

  useEffect(() => { load(false) }, [load])

  // 「重新检查」必须绕过缓存，否则 30 秒内点它只是拿回同一份结果。
  const reload = useCallback(() => { load(true) }, [load])

  return { state, reload }
}

const ZhihuSessionContext = createContext<ZhihuSessionController | undefined>(undefined)

/**
 * 工作台会话状态唯一来源：侧栏账号区、登录入口、各视图门禁共用一次取数，
 * 避免同一屏内多处各打一次 /api/auth/session，也保证登出后各消费方同步失效。
 */
export function ZhihuSessionProvider({ children }: { readonly children: ReactNode }) {
  const value = useZhihuSessionSource()
  return <ZhihuSessionContext.Provider value={value}>{children}</ZhihuSessionContext.Provider>
}

/** 只能用在 ZhihuSessionProvider 内部；未挂载时明确报错而不是静默自持一份。 */
export function useZhihuSession(): ZhihuSessionController {
  const value = useContext(ZhihuSessionContext)
  if (value === undefined) throw new Error('useZhihuSession 必须在 ZhihuSessionProvider 内使用。')
  return value
}

/** 退出登录：清除服务端会话后整页回到初始状态，个人数据缓存随之失效。 */
export async function logoutZhihuAccount(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
  // 会话本身也在取数缓存里，一并清掉，避免继续按已登出身份渲染。
  clearJsonCache()
  forgetEntrySeeds()
}

/**
 * 开始知乎授权登录：记录回跳视图后离开当前页面。
 * 网页端弹窗里的「使用知乎继续」直接调用它完成跳转。
 */
export function beginZhihuLogin(returnView: string): void {
  rememberZhihuLoginReturn(returnView)
  window.location.assign('/api/auth/authorize')
}

/**
 * 请求登录。桌面端由主进程开独立登录窗口（同一个 OAuth 流程在该窗口内完成）；
 * 网页端打开应用内弹窗，由弹窗按钮再触发跳转。
 * 返回 true 表示已交给外部窗口处理，调用方不必再显示弹窗。
 */
export function requestZhihuLogin(surface: ZhihuSurface | undefined): boolean {
  if (surface !== 'desktop') return false
  // 走标准 window.open：主进程的窗口打开钩子据此创建登录窗口。
  window.open('/login', 'zhihu-login', 'width=1080,height=720')
  return true
}
