import { useState } from 'react'
import { LoginView } from './login-view'
import sceneArtwork from './scene.png'
import { beginZhihuLogin, useZhihuSessionSource } from '@ui/workbench/zhihu-account'

/**
 * 桌面端独立登录窗口的内容：整窗只有授权登录视图。
 * 授权离开本窗口完成，完成后由主进程关闭窗口并刷新主界面，所以这里的按钮不会回到 idle。
 */
export function LoginWindowApp() {
  const { state } = useZhihuSessionSource()
  const [redirecting, setRedirecting] = useState(false)
  const oauthEnabled = state.status === 'ready' && state.session.oauthEnabled

  return (
    <div className="login-view-stage">
      <LoginView
        artwork={sceneArtwork}
        version={__PRODUCT_VERSION__}
        state={redirecting ? 'connecting' : 'idle'}
        onContinue={() => {
          setRedirecting(true)
          beginZhihuLogin('home')
        }}
        unavailableReason={
          state.status === 'loading'
            ? '正在准备登录…'
            : oauthEnabled
              ? undefined
              : '登录暂时不可用，请稍后重试。'
        }
      />
    </div>
  )
}
