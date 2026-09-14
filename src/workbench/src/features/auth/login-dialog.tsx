import { useEffect, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { LoginView } from './login-view'
import sceneArtwork from './scene.png'
import { beginZhihuLogin } from '@ui/workbench/zhihu-account'
import type { LoginAvailability } from './login-request'
import './login-dialog.css'

/**
 * 与后端固定回调路径一致（服务端常量 OAUTH_CALLBACK_PATH）。
 * 只在服务端还没给出登记地址时用于推导本地预览地址，不参与真实授权跳转。
 */
const FALLBACK_CALLBACK_PATH = '/api/auth/callback'

export type LoginDialogProps = {
  readonly onClose: () => void
  /** 授权回跳后要回到的视图，由打开方决定。 */
  readonly returnView: string
  /** 需要向用户交代的既有情况，如上次授权失败原因。 */
  readonly notice?: string
  /** 登录可用性三态；未接通时按钮不可用，并在弹窗内说明缺哪些配置。 */
  readonly availability: LoginAvailability
  /** 未接通时缺少的配置项名称（服务端只回名称，不含值）。 */
  readonly missingConfig: readonly string[]
  /** 应用固定的回调地址；服务端未配置公开来源时为 undefined。 */
  readonly redirectUri?: string
}

/**
 * 网页端登录弹窗：把登录视图放进应用内的浮层。
 * 桌面端不使用它——桌面端由主进程开独立登录窗口。
 *
 * 登录未接通时同样打开这个弹窗：按钮置灰，并在下方列出缺少的配置项与待登记的回调地址，
 * 让「点了没反应」变成「知道还差什么」。
 */
export function LoginDialog({ onClose, returnView, notice, availability, missingConfig, redirectUri }: LoginDialogProps) {
  const [redirecting, setRedirecting] = useState(false)
  const ready = availability === 'available'

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const unavailableReason = ready
    ? undefined
    : availability === 'probing'
      ? '正在准备登录…'
      : '登录尚未接通，还不能跳转知乎授权页。'

  return (
    <div className="zh-login-dialog" role="dialog" aria-modal="true" aria-label="登录知无不言">
      <div className="zh-login-dialog__backdrop" onClick={onClose} />
      <div className="zh-login-dialog__window">
        <button
          type="button"
          className="zh-login-dialog__close"
          aria-label="关闭登录"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <LoginView
          artwork={sceneArtwork}
          version={__PRODUCT_VERSION__}
          state={redirecting ? 'connecting' : 'idle'}
          onContinue={() => {
            setRedirecting(true)
            beginZhihuLogin(returnView)
          }}
          unavailableReason={unavailableReason}
          notice={notice}
          footer={availability === 'unconfigured'
            ? <LoginConfigHint missingConfig={missingConfig} redirectUri={redirectUri} />
            : undefined}
        />
      </div>
    </div>
  )
}

/**
 * 未接通说明：列出缺少的配置项与要登记到开放平台的回调地址。
 * 回调地址优先用服务端给出的登记地址；服务端还没配公开来源时，退回当前访问来源，
 * 便于本地预览时知道该往开放平台填什么。
 */
function LoginConfigHint({ missingConfig, redirectUri }: {
  readonly missingConfig: readonly string[]
  readonly redirectUri?: string
}) {
  const [copied, setCopied] = useState(false)
  const callbackUrl = redirectUri ?? `${window.location.origin}${FALLBACK_CALLBACK_PATH}`

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(callbackUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="zh-login-dialog__config" role="status">
      <p className="zh-login-dialog__config-title">完成接入需要：</p>
      {missingConfig.length > 0 && (
        <p className="zh-login-dialog__config-line">
          <span>配置服务端环境变量</span>
          {missingConfig.map((name) => <code key={name}>{name}</code>)}
        </p>
      )}
      <div className="zh-login-dialog__config-line">
        <span>回调地址登记为</span>
        <code className="zh-login-dialog__config-callback">{callbackUrl}</code>
        <button type="button" className="zh-login-dialog__config-copy" onClick={() => void copy()}>
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
    </div>
  )
}
