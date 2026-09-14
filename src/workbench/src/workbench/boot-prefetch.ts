import { adoptInFlightJson } from '../personal-workbench/workbench/app/components/json-cache'

/**
 * 首屏要用的几条 GET 在 HTML 解析阶段就发出了（index.html 的内联脚本），结果挂在 window 上；
 * 这里把它们认领进 json-cache，消费方按各自的路径 key 正常取数就会命中在途请求或已就绪的响应体，
 * 不需要知道预取层的存在。
 *
 * 为什么要这么早：线上这三条各要一秒左右（Vercel 函数每次调用都有冷启开销），
 * 等 React 挂载后的 effect 再发，首屏身份区就得先空等那一秒、渲染成加载态。
 * 挪到解析阶段发出，响应能在首帧之前回来，加载态根本不渲染。
 *
 * 预取层只保存**原始响应体**：校验与投影由各消费方自己做
 * （会话在 zhihu-account、能力在 surface、热榜条目在 use-home-feed），这里不复制第二套解析。
 */
declare global {
  interface Window {
    zhihuBootPrefetch?: Record<string, Promise<unknown>>
  }
}

/** 认领启动预取的结果；认领一次即从 window 上摘掉，重复调用不会再写。 */
export function adoptBootPrefetch(): void {
  const prefetched = window.zhihuBootPrefetch
  if (prefetched === undefined) return
  delete window.zhihuBootPrefetch
  for (const [path, task] of Object.entries(prefetched)) {
    adoptInFlightJson(path, task)
  }
}
