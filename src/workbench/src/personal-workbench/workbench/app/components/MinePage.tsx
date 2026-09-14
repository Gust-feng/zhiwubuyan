import { useEffect, useRef } from 'react'
import { Layers } from 'lucide-react'
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
    return <MineStatus message="登录后查看你的个人档案。" />
  }
  return <ArchivePage />
}

function ArchivePage() {
  const archive = usePersonalArchive(true)
  return (
    <div className="ui-mine-route">
      <main className="ui-mine__archive-page">
        <header className="ui-mine__archive-head">
          <span className="ui-mine__archive-icon"><Layers size={17} aria-hidden /></span>
          <div>
            <h1>个人档案</h1>
            <p>由你自己的创作、收藏与关注按规则组织而成。</p>
          </div>
          {archive.status === 'ready' && (
            <button type="button" className="ui-mine__archive-refresh" onClick={archive.refresh}>重新同步</button>
          )}
        </header>

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
          <PersonalArchiveView archive={archive.archive} />
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
