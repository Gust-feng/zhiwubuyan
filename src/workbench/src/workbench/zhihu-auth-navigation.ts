const ZHIHU_LOGIN_RETURN_KEY = 'zhihu.login.return-view'

/** OAuth 离开当前页面前保存一次用户意图，回跳后只消费一次。 */
export function rememberZhihuLoginReturn(view: string): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(ZHIHU_LOGIN_RETURN_KEY, view)
}

/**
 * 读取并清除登录前的视图意图。只接受调用方声明的合法视图名，
 * 避免把过期或未知的值当成导航目标。
 */
export function consumeZhihuLoginReturn(allowed: readonly string[]): string | undefined {
  if (typeof window === 'undefined') return undefined
  const pending = window.sessionStorage.getItem(ZHIHU_LOGIN_RETURN_KEY)
  if (pending === null) return undefined
  window.sessionStorage.removeItem(ZHIHU_LOGIN_RETURN_KEY)
  return allowed.includes(pending) ? pending : undefined
}

/** 授权回调带回的失败码；读取后从地址栏移除，避免刷新重复提示。 */
export function readLoginError(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const params = new URLSearchParams(window.location.search)
  const code = params.get('login_error')
  if (code === null) return undefined
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
  switch (code) {
    case 'missing_code':
      return '知乎授权未返回授权码，请重新登录。'
    case 'UPSTREAM_ERROR':
      return '暂时无法连接知乎授权服务，请稍后再试。'
    default:
      return '知乎授权登录失败，请重试。'
  }
}
