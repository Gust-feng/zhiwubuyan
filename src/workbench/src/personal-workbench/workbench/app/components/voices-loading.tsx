import { Quote, Scale } from 'lucide-react'
import './voices-loading.css'

/** 请求只返回最终结果；循环图形表达等待，不推算阶段或完成比例。 */
export function VoicesLoading({ issue }: { readonly issue: string }) {
  return (
    <section className="voices-loading" aria-labelledby="voices-loading-topic">
      <header className="voices-loading__message">
        <p className="voices-loading__status" role="status">
          <span className="voices-loading__activity" aria-hidden="true"><i /><i /><i /></span>
          正在整理
        </p>
        <h1 className="voices-loading__topic" id="voices-loading-topic">
          <span className="voices-loading__quote" aria-hidden="true">“</span>
          <span className="voices-loading__topic-text">{issue.trim()}</span>
          <span className="voices-loading__quote voices-loading__quote--closing" aria-hidden="true">”</span>
        </h1>
      </header>
      <div className="voices-loading__scene" aria-hidden="true">
        <div className="voices-loading__halo" />
        <svg className="voices-loading__connections" viewBox="0 0 480 260" fill="none">
          <path d="M 122 84 C 172 84 168 130 240 130" />
          <path d="M 366 58 C 302 58 310 130 240 130" />
          <path d="M 374 198 C 302 198 310 130 240 130" />
        </svg>
        <div className="voices-loading__center"><Scale size={42} strokeWidth={1.5} /></div>
        {['first', 'second', 'third'].map((position) => (
          <div className={`voices-loading__voice voices-loading__voice--${position}`} key={position}>
            <Quote size={16} strokeWidth={1.5} />
            <span /><span />
          </div>
        ))}
      </div>
    </section>
  )
}
