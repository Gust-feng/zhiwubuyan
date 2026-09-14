import { useEffect, useState } from 'react'
import { Download, ExternalLink, RotateCcw } from 'lucide-react'
import type { AnimationRecord } from '@contracts/concept-animation'

/** 成象播放器：用沙箱 iframe 渲染模型产出的单文件 HTML。
 *
 *  安全：产物是模型生成的、会在浏览器里执行脚本的内容，因此用 sandbox="allow-scripts"
 *  而不给 allow-same-origin——产物拿不到同源权限，读不到父页面、存储与 cookie。
 *  提示词也要求它不访问 window.parent，这里是兜底。 */
export function ImageryPlayer({ record, onReset }: {
  record: AnimationRecord
  onReset: () => void
}) {
  const [key, setKey] = useState(0)

  // 换记录时重建 iframe：srcdoc 变化不会重置已运行的动画，靠 key 强制重挂载。
  useEffect(() => {
    setKey((value) => value + 1)
  }, [record.id])

  function download() {
    const blob = new Blob([record.html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const anchor = Object.assign(document.createElement('a'), {
      href: url,
      download: `${safeFileName(record.title || record.topic)}.html`,
    })
    document.body.appendChild(anchor)
    anchor.click()
    URL.revokeObjectURL(url)
    anchor.remove()
  }

  function openInNewWindow() {
    const blob = new Blob([record.html], { type: 'text/html' })
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  }

  return (
    <section className="imagery-stage" aria-label="成象动画">
      <header className="imagery-stage__bar">
        <h2 className="imagery-stage__title">{record.title || record.topic}</h2>
        <div className="imagery-stage__actions">
          <button type="button" className="imagery-text-button" onClick={() => setKey((value) => value + 1)}>
            <RotateCcw size={14} />重新播放
          </button>
          <button type="button" className="imagery-text-button" onClick={openInNewWindow}>
            <ExternalLink size={14} />新窗口打开
          </button>
          <button type="button" className="imagery-text-button" onClick={download}>
            <Download size={14} />下载 HTML
          </button>
          <button type="button" className="imagery-text-button" onClick={onReset}>换一个概念</button>
        </div>
      </header>
      <div className="imagery-stage__frame">
        <iframe
          key={key}
          className="imagery-stage__iframe"
          title={record.title || record.topic}
          sandbox="allow-scripts"
          srcDoc={record.html}
        />
      </div>
    </section>
  )
}

function safeFileName(value: string): string {
  const base = value.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return base || 'animation'
}
