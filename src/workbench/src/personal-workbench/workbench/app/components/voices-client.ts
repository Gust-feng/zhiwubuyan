import type { VoicesRecency, VoicesScope, VoicesView } from '../../../../contracts/voices'

/** 众声请求：议题 + 检索范围 + 时间范围，落点问题可选。 */
export async function requestVoices(
  issue: string,
  options: { anchorQuestionId?: string; scope: VoicesScope; recency: VoicesRecency },
): Promise<VoicesView> {
  const payload: Record<string, unknown> = { issue, scope: options.scope, recency: options.recency }
  if (options.anchorQuestionId !== undefined) payload.anchorQuestionId = options.anchorQuestionId
  const response = await fetch('/api/research/voices', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = readErrorMessage(body)
    throw new Error(message ?? '知乎那边接口暂时没有响应，不是你的操作有问题，可以再试一次')
  }
  if (!isVoices(body)) throw new Error('整理结果的结构不符合预期，可以再试一次')
  return body
}

/** 服务端错误体是扁平的 { code, message, detail }，这里读 message。 */
export function readErrorMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined
  const message = (body as Record<string, unknown>).message
  return typeof message === 'string' && message !== '' ? message : undefined
}

export function isVoices(body: unknown): body is VoicesView {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false
  const record = body as Record<string, unknown>
  return typeof record.issue === 'string' && Array.isArray(record.clusters)
}
