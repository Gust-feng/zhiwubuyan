import { useEffect, useRef } from 'react'
import { useZhihuLogin } from '@ui/features/auth/login-request'
import { readLoginError } from '@ui/workbench/zhihu-auth-navigation'
import { useZhihuSession } from '@ui/workbench/zhihu-account'
import { PersonalArchiveView } from './personal-archive'
import { usePersonalArchive } from './use-personal-archive'
import './mine-page.css'

/** “我的知乎”只承载个人档案；账号菜单仍是唯一入口。 */
export function MinePage() {
  const { state: sessionState, reload } = useZhihuSession()
  const { openLogin } = useZhihuLogin()
  const loginErrorRef = useRef<string | undefined>(readLoginError())
  const openedLoginRef = useRef(false)
  // 本地开发数据模式仍允许预览档案布局；它只在账号展示上保持“未登录”语义。
  const unauthenticated = sessionState.status === 'ready' && !sessionState.session.authenticated

  useEffect(() => {
    if (!unauthenticated || openedLoginRef.current) return
    openedLoginRef.current = true
    openLogin('mine', loginErrorRef.current)
  }, [unauthenticated, openLogin])

  if (sessionState.status === 'loading') {
    return <MineStatus message="正在确认登录状态…" />
  }
  if (sessionState.status === 'error') {
    return <MineStatus message={sessionState.message} actionLabel="重新检查" onAction={reload} />
  }
  if (unauthenticated) {
    // 未登录也保留页面结构：说明这项由什么数据组织而成，并给出登录入口，
    // 而不是把整页换成一堵墙。
    return (
      <div className="ui-view">
        <div className="ui-view__frame">
          <div className="ui-view__sub" role="status">
            个人档案由你自己的创作、收藏与关注组织而成，需要登录后才能同步。
          </div>
          <button type="button" className="ui-ask__submit" onClick={() => openLogin('mine')}>登录知乎</button>
        </div>
      </div>
    )
  }
  return <ArchivePage />
}

function ArchivePage() {
  const archive = usePersonalArchive(true)
  return (
    <div className="ui-mine-route">
      <main className="ui-mine__archive-page">
        {archive.status === 'loading' && (
          <div className="ui-mine__archive-skeleton" role="status" aria-label="正在同步个人档案">
            {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
          </div>
        )}
        {archive.status === 'error' && (
          <div className="ui-mine__archive-notice" role="alert">
            <p>{archive.error}</p>
            <button type="button" onClick={archive.retry}>重试</button>
          </div>
        )}
        {archive.status === 'ready' && archive.archive !== undefined && (
          <PersonalArchiveView archive={archive.archive} onRefresh={archive.refresh} />
        )}
      </main>
    </div>
  )
}

function MineStatus({ message, actionLabel, onAction }: {
  readonly message: string
  readonly actionLabel?: string
  readonly onAction?: () => void
}) {
  return (
    <div className="ui-view">
      <div className="ui-view__frame">
        <div className="ui-view__sub" role="status">{message}</div>
        {actionLabel !== undefined && onAction !== undefined && (
          <button type="button" className="ui-ask__submit" onClick={onAction}>{actionLabel}</button>
        )}
      </div>
    </div>
  )
}
