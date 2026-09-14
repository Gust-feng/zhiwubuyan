import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { WorkbenchView } from './navigation-state'
import { fetchJsonCached, readCachedJson } from '../personal-workbench/workbench/app/components/json-cache'

/**
 * 运行面能力：后端在 /api/status 里声明 surface。
 * 深度研究的研究产物由服务端承接，前端在这里维护它的可用状态与来源，
 * 不再按运行面复制界面。
 */

export type WorkbenchSurface = 'desktop' | 'web'

/** 服务端承接的板块：数据与执行都在服务端，前端只读展示。 */
export type ServerBackedCapability = {
  /** 服务端是否已具备该能力；未就绪时入口保留但如实说明。 */
  readonly available: boolean
}

export type SurfaceCapabilities = {
  readonly surface: WorkbenchSurface
  /** 深度研究（服务端承接；网页端为 Pro 单次直答）。 */
  readonly research: ServerBackedCapability
  /** 自研 Ultra 引擎是否由本侧承接。网页端只承接 Pro，故为 false。 */
  readonly researchUltra: ServerBackedCapability
  /** 成象（概念动画）是否由服务端承接；未就绪时入口保留但如实说明。 */
  readonly conceptAnimation: ServerBackedCapability
  /** 知乎登录是否已接通；未接通时列出缺少的配置项名称（服务端只回名称）。 */
  readonly login: {
    readonly available: boolean
    readonly missingConfig: readonly string[]
    /** 应用固定的回调地址；未配置公开来源时为 undefined。 */
    readonly redirectUri?: string
  }
}

type SurfaceState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly capabilities: SurfaceCapabilities }
  | { readonly status: 'error' }

/**
 * 按视图整页拦截的名单，当前为空。
 *
 * 登录只约束**消耗额度或读写个人数据的动作**（直答、主题检索、众声、研究 Pro、
 * 个人档案同步），不约束**查看**：页面结构、公开内容（热榜）与入口都应能匿名看到，
 * 由各页面在动作处拉起登录弹窗，而不是把整页换成一堵登录墙。
 * 保留这个机制供将来确有整页需要登录的板块使用。
 */
const WEB_LOGIN_VIEWS: ReadonlySet<WorkbenchView> = new Set<WorkbenchView>()

/** 能力探测的路径：与 index.html 的启动预取共用同一个缓存 key。 */
const STATUS_PATH = '/api/status'

type StatusBody = {
  surface?: unknown
  capabilities?: unknown
  auth?: { oauthEnabled?: unknown; missingConfig?: unknown; redirectUri?: unknown }
}

/** /api/status 的投影：服务端声明了什么就启用什么，未声明时如实按不可用处理。 */
function projectCapabilities(body: unknown): SurfaceCapabilities {
  const status = (body ?? {}) as StatusBody
  const surface: WorkbenchSurface = status.surface === 'desktop' ? 'desktop' : 'web'
  const capabilities = Array.isArray(status.capabilities) ? status.capabilities : []
  const missingConfig = Array.isArray(status.auth?.missingConfig)
    ? status.auth.missingConfig.filter((item): item is string => typeof item === 'string')
    : []
  return {
    surface,
    // 研究路由由服务端声明；未声明时不假装可用。
    research: { available: capabilities.includes('research') },
    // Ultra 引擎只在本机运行面承接；未声明时档位菜单不列出 Ultra。
    researchUltra: { available: capabilities.includes('research_ultra') },
    // 成象路由由服务端声明；未声明时入口给出未接通说明。
    conceptAnimation: { available: capabilities.includes('concept_animation') },
    login: {
      available: status.auth?.oauthEnabled === true,
      missingConfig,
      // 应用固定的回调地址；服务端未配置公开来源时为 undefined。
      ...(typeof status.auth?.redirectUri === 'string' && status.auth.redirectUri !== ''
        ? { redirectUri: status.auth.redirectUri }
        : {}),
    },
  }
}

/** 与启动预取共用同一条请求；失败不写缓存，下一次挂载还会重新探测。 */
export function loadSurfaceCapabilities(): Promise<SurfaceCapabilities> {
  return fetchJsonCached(STATUS_PATH, async () => {
    const response = await fetch(STATUS_PATH)
    if (!response.ok) throw new Error(`status ${response.status}`)
    return await response.json()
  }).then(projectCapabilities)
}

export type WorkbenchSurfaceState = {
  readonly surface: WorkbenchSurface
  readonly ready: boolean
  /** 服务端研究能力是否可用。 */
  readonly researchAvailable: boolean
  /** 自研 Ultra 引擎是否由本侧承接（网页端为 false，只有 Pro）。 */
  readonly researchUltraAvailable: boolean
  /** 成象（概念动画）是否由服务端承接。 */
  readonly conceptAnimationAvailable: boolean
  /** 知乎登录是否已接通。 */
  readonly loginAvailable: boolean
  /** 登录未接通时缺少的配置项名称；已接通为空。 */
  readonly loginMissingConfig: readonly string[]
  /** 应用固定的回调地址；未配置公开来源时为 undefined。 */
  readonly loginRedirectUri?: string
  /** 当前视图在本次运行面下是否需要登录（仅网页端为真）。 */
  readonly requiresLogin: (view: WorkbenchView) => boolean
}

const SurfaceContext = createContext<WorkbenchSurfaceState | undefined>(undefined)

export function WorkbenchSurfaceProvider({ children }: { readonly children: ReactNode }) {
  // 首帧直接认领已就绪的探测结果：预取让 /api/status 在 HTML 解析阶段就发出，通常先于首帧回来，
  // 界面因此不会先渲染一帧未就绪。
  const [state, setState] = useState<SurfaceState>(() => {
    const body = readCachedJson<unknown>(STATUS_PATH)
    return body === undefined
      ? { status: 'loading' }
      : { status: 'ready', capabilities: projectCapabilities(body) }
  })

  useEffect(() => {
    let alive = true
    loadSurfaceCapabilities()
      .then((capabilities) => {
        if (alive) setState({ status: 'ready', capabilities })
      })
      .catch(() => {
        // 已经探测到能力就保留：一次网络抖动不该把可用的界面打回未就绪。
        if (alive) setState((previous) => previous.status === 'ready' ? previous : { status: 'error' })
      })
    return () => {
      alive = false
    }
  }, [])

  const value = useMemo<WorkbenchSurfaceState>(() => {
    const capabilities = state.status === 'ready' ? state.capabilities : undefined
    const surface = capabilities?.surface ?? 'web'
    const requiresLogin = (view: WorkbenchView): boolean =>
      capabilities !== undefined && capabilities.surface === 'web' && WEB_LOGIN_VIEWS.has(view)
    return {
      surface,
      ready: capabilities !== undefined,
      researchAvailable: capabilities?.research.available ?? false,
      researchUltraAvailable: capabilities?.researchUltra.available ?? false,
      conceptAnimationAvailable: capabilities?.conceptAnimation.available ?? false,
      loginAvailable: capabilities?.login.available ?? false,
      loginMissingConfig: capabilities?.login.missingConfig ?? [],
      ...(capabilities?.login.redirectUri === undefined ? {} : { loginRedirectUri: capabilities.login.redirectUri }),
      requiresLogin,
    }
  }, [state])

  return <SurfaceContext.Provider value={value}>{children}</SurfaceContext.Provider>
}

/** 未挂载 Provider 时按最保守的网页端处理：不误开需要服务端的能力。 */
export function useWorkbenchSurface(): WorkbenchSurfaceState {
  const value = useContext(SurfaceContext)
  if (value !== undefined) return value
  return {
    surface: 'web',
    ready: false,
    researchAvailable: false,
    researchUltraAvailable: false,
    conceptAnimationAvailable: false,
    loginAvailable: false,
    loginMissingConfig: [],
    requiresLogin: () => false,
  }
}
