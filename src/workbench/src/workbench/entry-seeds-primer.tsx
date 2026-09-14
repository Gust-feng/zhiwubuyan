import { useEffect } from 'react'
import { useZhihuSession } from './zhihu-account'
import { primeEntrySeeds } from './entry-seeds'

/**
 * 挂在会话 Provider 内、外壳第一位：两个入口的种子各按自己的素材来源，尽早开始生成。
 *   - 众声用公开热榜，应用一打开就能取，与登录无关；
 *   - 深度研究用本人收藏，确认登录后才读得到。
 * 都不等用户打开入口——入口打开时才发请求的话，结果回来前那几秒只能先摆内置内容。
 * 这里不管用户停在哪个板块，生成都在后台跑完；入口自己只读结果，不触发取数。
 */
export function EntrySeedsPrimer(): null {
  const { state } = useZhihuSession()
  const authenticated = state.status === 'ready' && state.session.authenticated
  useEffect(() => {
    primeEntrySeeds('voices')
  }, [])
  useEffect(() => {
    if (authenticated) primeEntrySeeds('research')
  }, [authenticated])
  return null
}
