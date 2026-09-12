const ZHIHU_LOGIN_RETURN_KEY = 'zhihu.login.return-view'

/** OAuth 离开当前页面前保存一次用户意图，回跳后只消费一次。 */
export function rememberZhihuLoginReturnToMine(): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(ZHIHU_LOGIN_RETURN_KEY, 'mine')
}

export function consumeZhihuLoginReturnToMine(): boolean {
  if (typeof window === 'undefined') return false
  const pendingView = window.sessionStorage.getItem(ZHIHU_LOGIN_RETURN_KEY)
  if (pendingView !== 'mine') return false
  window.sessionStorage.removeItem(ZHIHU_LOGIN_RETURN_KEY)
  return true
}
