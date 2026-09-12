import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DndProvider, useDrag, useDrop } from 'react-dnd'
import { getEmptyImage, HTML5Backend } from 'react-dnd-html5-backend'
import {
  Bookmark,
  ChevronRight,
  ExternalLink,
  FileText,
  GripVertical,
  LogIn,
  NotebookPen,
  Pencil,
  Plus,
  PenLine,
  RefreshCw,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  CollectionRow,
  CreationRow,
  FolloweeRow,
  readCollectionItems,
  readCreationItems,
  readFolloweeItems,
} from './home-feeds'
import { useNotes, type Note } from './notesStore'
import { NoteEditor } from './NoteEditor'
import { FloatingMenu } from '@ui/components/floating-menu'
import { BrandMark } from '@ui/components/brand-mark'
import { InlineName } from '@ui/components/inline-name'
import { useCoreFeed, type CoreFeed } from './use-core-feed'
import { rememberZhihuLoginReturnToMine } from '@ui/workbench/zhihu-auth-navigation'
import './home-page.css'
import './mine-page.css'

type AuthSessionView = {
  readonly oauthEnabled: boolean
  readonly authenticated: boolean
  readonly developerMode?: boolean
}

type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly session: AuthSessionView }
  | { readonly status: 'error'; readonly message: string }

type MineSection = 'notes' | 'creations' | 'collections' | 'followees'

/** 新建笔记后编辑器应首先落焦的位置：无标题笔记先命名，首篇笔记直接动笔。 */
type NoteFocusTarget = 'title' | 'body'

export type MinePageProps = {
  readonly onExit?: () => void
  readonly initialNoteId?: string | null
  readonly onNoteSelectionChange?: (noteId: string | null) => void
}

/** 登录后的个人内容工作区。未通过会话检查时不挂载个人数据请求。 */
export function MinePage(props: MinePageProps) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: 'loading' })
  const [loginError, setLoginError] = useState<string>()

  const loadSession = useCallback(() => {
    const controller = new AbortController()
    setSessionState({ status: 'loading' })
    fetch('/api/auth/session', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('暂时无法确认登录状态。')
        const body: unknown = await response.json()
        if (!isSession(body)) throw new Error('登录状态响应无法识别。')
        setSessionState({ status: 'ready', session: body })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setSessionState({
          status: 'error',
          message: error instanceof Error ? error.message : '暂时无法确认登录状态。',
        })
      })
    return () => controller.abort()
  }, [])

  useEffect(() => loadSession(), [loadSession])
  useEffect(() => setLoginError(readLoginError()), [])

  if (sessionState.status === 'loading') {
    return (
      <div className="ui-mine-route">
        <div className="ui-mine__loading" role="status">
          <RefreshCw size={15} aria-hidden />
          正在确认登录状态…
        </div>
      </div>
    )
  }

  if (sessionState.status === 'error') {
    return (
      <LoginGate
        title="暂时无法打开我的知乎"
        description={sessionState.message}
        onExit={props.onExit}
        onRetry={loadSession}
      />
    )
  }

  if (!sessionState.session.authenticated) {
    return (
      <LoginGate
        title="登录后进入我的知乎"
        description="查看你的笔记、创作、收藏与关注内容。"
        detail={loginError ?? (sessionState.session.oauthEnabled ? undefined : '当前环境尚未启用知乎登录。')}
        oauthEnabled={sessionState.session.oauthEnabled}
        onExit={props.onExit}
      />
    )
  }

  return <AuthenticatedMinePage initialNoteId={props.initialNoteId} onNoteSelectionChange={props.onNoteSelectionChange} developerMode={sessionState.session.developerMode === true} />
}

function AuthenticatedMinePage({ initialNoteId, onNoteSelectionChange, developerMode }: Pick<MinePageProps, 'initialNoteId' | 'onNoteSelectionChange'> & { readonly developerMode: boolean }) {
  const [section, setSection] = useState<MineSection>('notes')
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(initialNoteId ?? null)
  const [pendingNoteFocus, setPendingNoteFocus] = useState<{ id: string; target: NoteFocusTarget } | null>(null)
  const { notes, create, update, remove, reorder } = useNotes()
  const creations = useCoreFeed('/api/user/contents', readCreationItems)
  const collections = useCoreFeed('/api/user/collections', readCollectionItems)
  const followees = useCoreFeed('/api/user/followees', readFolloweeItems)

  // 拖动期间保留临时顺序，落下后写回笔记存储；删除时同步移除。
  const [noteDragOrder, setNoteDragOrder] = useState<string[] | null>(null)
  const noteDragOrderRef = useRef<string[] | null>(null)
  const orderedNotes = useMemo(() => {
    const notesById = new Map(notes.map((note) => [note.id, note]))
    return (noteDragOrder ?? notes.map((note) => note.id)).flatMap((id) => notesById.get(id) ?? [])
  }, [noteDragOrder, notes])

  const moveNote = (from: number, to: number): void => {
    const previous = noteDragOrderRef.current ?? notes.map((note) => note.id)
    const next = [...previous]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    noteDragOrderRef.current = next
    setNoteDragOrder(next)
  }

  const commitNoteOrder = (): void => {
    const next = noteDragOrderRef.current
    if (next === null) return
    reorder(next)
    noteDragOrderRef.current = null
    setNoteDragOrder(null)
  }

  const deleteNote = (id: string): void => {
    remove(id)
    if (noteDragOrderRef.current !== null) {
      const next = noteDragOrderRef.current.filter((noteId) => noteId !== id)
      noteDragOrderRef.current = next
      setNoteDragOrder(next)
    }
  }

  const openNote = (noteId: string): void => {
    setSection('notes')
    setSelectedNoteId(noteId)
    setPendingNoteFocus((current) => current?.id === noteId ? current : null)
    onNoteSelectionChange?.(noteId)
  }

  // 空列表时首篇笔记以“写下第一篇笔记”为题直接动笔；之后的新笔记先聚焦标题命名。
  const createNoteAndOpen = (): void => {
    if (notes.length === 0) {
      const note = create({ title: '写下第一篇笔记' })
      setPendingNoteFocus({ id: note.id, target: 'body' })
      openNote(note.id)
      return
    }
    const note = create()
    setPendingNoteFocus({ id: note.id, target: 'title' })
    openNote(note.id)
  }

  const selectedNote = selectedNoteId === null ? undefined : notes.find((note) => note.id === selectedNoteId)

  // 内容区不再有列表视图：选中项缺失或已被删除时自动打开列表首篇，编辑器是唯一形态。
  useEffect(() => {
    if (section !== 'notes') return
    if (selectedNoteId !== null && notes.some((note) => note.id === selectedNoteId)) return
    if (notes.length === 0) return
    openNote(notes[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, selectedNoteId, notes])

  return (
    <div className="ui-mine-route">
      <DndProvider backend={HTML5Backend}>
      <div className="ui-mine__workspace">
        <aside className="ui-mine__directory" aria-label="我的知乎目录">
          <header className="ui-mine__directory-head">
            <h1>我的知乎</h1>
            <p>{developerMode ? '开发预览 · ACS 数据源' : '4 个内容维度'}</p>
          </header>

          <NotesDirectorySection
            notes={orderedNotes}
            selectedNoteId={selectedNoteId}
            onOpenNote={openNote}
            onCreate={createNoteAndOpen}
            onRename={(id, title) => update(id, { title })}
            onDelete={deleteNote}
            onMoveNote={moveNote}
            onCommitNoteOrder={commitNoteOrder}
          />

          <DirectoryGroup label="知乎">
            <DirectoryRow
              active={section === 'creations'}
              icon={PenLine}
              label="我的创作"
              count={feedCount(creations)}
              onClick={() => { setSection('creations'); setSelectedNoteId(null) }}
            />
            <DirectoryRow
              active={section === 'collections'}
              icon={Bookmark}
              label="我的收藏"
              count={feedCount(collections)}
              onClick={() => { setSection('collections'); setSelectedNoteId(null) }}
            />
            <DirectoryRow
              active={section === 'followees'}
              icon={Users}
              label="关注的人"
              count={feedCount(followees)}
              onClick={() => { setSection('followees'); setSelectedNoteId(null) }}
            />
          </DirectoryGroup>
        </aside>

        <main className={`ui-mine__content${section === 'notes' && selectedNote !== undefined ? ' ui-mine__content--editor' : ''}`}>
          {section === 'notes' && selectedNote !== undefined ? (
            <NoteEditor
              note={selectedNote}
              initialFocusTarget={pendingNoteFocus?.id === selectedNote.id ? pendingNoteFocus.target : undefined}
              onInitialFocusHandled={() => setPendingNoteFocus(null)}
              onSave={update}
              onRemove={() => deleteNote(selectedNote.id)}
              onRestoreAsNew={(draft) => {
                const restored = create(draft)
                openNote(restored.id)
              }}
            />
          ) : null}
          {section === 'creations' && (
            <FeedView
              icon={PenLine}
              title="我的创作"
              description="你发布的回答、文章、想法与视频。"
              feed={creations}
              renderItem={(item) => <CreationRow item={item} />}
            />
          )}
          {section === 'collections' && (
            <FeedView
              icon={Bookmark}
              title="我的收藏"
              description="最近收藏的知乎内容，保留原收藏夹归属。"
              feed={collections}
              renderItem={(item) => <CollectionRow item={item} />}
            />
          )}
          {section === 'followees' && (
            <FeedView
              icon={Users}
              title="关注的人"
              description="你正在关注的创作者与他们的公开资料。"
              feed={followees}
              renderItem={(item) => <FolloweeRow item={item} />}
            />
          )}
        </main>
      </div>
      </DndProvider>
    </div>
  )
}

function DirectoryGroup({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <section className="ui-mine__directory-group">
      <h2>{label}</h2>
      <div>{children}</div>
    </section>
  )
}

function DirectoryRow({ active, icon: Icon, label, count, onClick }: {
  readonly active: boolean
  readonly icon: LucideIcon
  readonly label: string
  readonly count?: number
  readonly onClick: () => void
}) {
  return (
    <button type="button" className="ui-mine__directory-row" aria-current={active ? 'page' : undefined} onClick={onClick}>
      <Icon size={16} aria-hidden />
      <span>{label}</span>
      {count !== undefined && <small>{count}</small>}
      <ChevronRight size={14} aria-hidden />
    </button>
  )
}

/** 侧栏里的常驻笔记分区：标签带新建入口，空列表以引导行一键成文，行内悬停可拖拽排序、重命名与删除。 */
function NotesDirectorySection({ notes, selectedNoteId, onOpenNote, onCreate, onRename, onDelete, onMoveNote, onCommitNoteOrder }: {
  readonly notes: readonly Note[]
  readonly selectedNoteId: string | null
  readonly onOpenNote: (noteId: string) => void
  readonly onCreate: () => void
  readonly onRename: (id: string, title: string) => void
  readonly onDelete: (id: string) => void
  readonly onMoveNote: (from: number, to: number) => void
  readonly onCommitNoteOrder: () => void
}) {
  const rowsRef = useRef<HTMLDivElement | null>(null)
  const rowTopsRef = useRef<Map<string, number>>(new Map())

  // 顺序变化时用 FLIP 让既有行平滑滑动、新行淡入；拖拽期间行动画交给拖拽本身。
  useLayoutEffect(() => {
    const container = rowsRef.current
    if (container === null) return
    const nextTops = readNoteRowTops(container)
    const previousTops = rowTopsRef.current
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dragging = container.getElementsByClassName('ui-mine__notes-tree-row--dragging').length > 0
    for (const [id, topAfter] of nextTops) {
      const row = findNoteRow(container, id)
      if (row === null) continue
      const topBefore = previousTops.get(id)
      if (topBefore === undefined) {
        if (!reducedMotion && !dragging && previousTops.size > 0) {
          row.animate(
            [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }],
            { duration: NOTE_TREE_MOTION_MS, easing: 'ease-out' },
          )
        }
        continue
      }
      const shift = topBefore - topAfter
      if (reducedMotion || dragging || Math.abs(shift) < 1) continue
      row.animate(
        [{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }],
        { duration: NOTE_TREE_MOTION_MS, easing: 'ease-out' },
      )
    }
    rowTopsRef.current = nextTops
  })

  return (
    <section className="ui-mine__directory-group" aria-label="我的笔记">
      <div className="ui-mine__notes-tree-head">
        <h2>我的笔记</h2>
        <button type="button" className="ui-mine__notes-tree-add" onClick={onCreate} aria-label="新建笔记" title="新建笔记">
          <Plus size={13} aria-hidden />
        </button>
      </div>
      <div className="ui-mine__notes-tree-rows" ref={rowsRef}>
        {notes.length === 0 ? (
          <button type="button" className="ui-mine__notes-tree-guide" onClick={onCreate}>
            <span className="ui-mine__notes-tree-guide-slot" aria-hidden />
            <NotebookPen size={13} aria-hidden />
            <span>写下第一篇笔记</span>
          </button>
        ) : notes.map((note, index) => (
          <NoteTreeRow
            key={note.id}
            index={index}
            note={note}
            selected={selectedNoteId === note.id}
            onSelect={() => onOpenNote(note.id)}
            onRename={(title) => onRename(note.id, title)}
            onDelete={() => onDelete(note.id)}
            onMove={onMoveNote}
            onDrop={onCommitNoteOrder}
          />
        ))}
      </div>
    </section>
  )
}

/** 单条笔记行：整行点击打开，悬停露出拖拽手柄与操作菜单，双击进入行内重命名，拖拽换位。 */
function NoteTreeRow({ index, note, selected, onSelect, onRename, onDelete, onMove, onDrop }: {
  readonly index: number
  readonly note: Note
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onRename: (title: string) => void
  readonly onDelete: () => void
  readonly onMove: (from: number, to: number) => void
  readonly onDrop: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const title = note.title.trim() || '无标题笔记'

  const [{ isDragging }, drag, preview] = useDrag({
    type: NOTE_TREE_DRAG_TYPE,
    item: { index },
    canDrag: !editing,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    end: onDrop,
  })
  // 拖拽时不显示半透明的系统跟手图：行本身随换位移动，观感更贴近直接搬动。
  useEffect(() => { preview(getEmptyImage(), { captureDraggingState: true }) }, [preview])
  const [, drop] = useDrop<{ index: number }>({
    accept: NOTE_TREE_DRAG_TYPE,
    hover(item, monitor) {
      const element = ref.current
      if (element === null || item.index === index) return
      const offset = monitor.getClientOffset()
      if (offset === null) return
      const rect = element.getBoundingClientRect()
      const y = offset.y - rect.top
      const middleY = rect.height / 2
      if (item.index < index && y < middleY) return
      if (item.index > index && y > middleY) return
      onMove(item.index, index)
      item.index = index
    },
  })

  return (
    <div
      ref={(node) => { ref.current = node; drop(node) }}
      data-note-row={note.id}
      className={`ui-mine__notes-tree-row${selected ? ' ui-mine__notes-tree-row--selected' : ''}${isDragging ? ' ui-mine__notes-tree-row--dragging' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(false)
      }}
      onDoubleClick={() => setEditing(true)}
    >
      {!editing && (
        <button
          type="button"
          className="ui-mine__notes-tree-hit"
          aria-label={`打开${title}`}
          aria-current={selected ? 'page' : undefined}
          title={title}
          onClick={onSelect}
        />
      )}
      <span
        ref={(node) => { drag(node) }}
        className="ui-mine__notes-tree-drag"
        title="拖动调整顺序"
        onClick={(event) => event.stopPropagation()}
      >
        <GripVertical size={12} aria-hidden />
      </span>
      <NotebookPen size={13} className="ui-mine__notes-tree-icon" aria-hidden />
      {editing ? (
        <InlineName
          value={note.title}
          label={`重命名${title}`}
          onCommit={(nextTitle) => { onRename(nextTitle); setEditing(false) }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <span className="ui-mine__notes-tree-title">{title}</span>
      )}
      {editing ? (
        <span className="ui-mine__notes-tree-menu-slot" aria-hidden />
      ) : (
        <FloatingMenu
          label={`${title}操作`}
          visible={hovered}
          actions={[
            { label: '重命名', icon: <Pencil size={12} />, onClick: () => setEditing(true) },
            { label: '删除', icon: <Trash2 size={12} />, danger: true, onClick: onDelete },
          ]}
        />
      )}
    </div>
  )
}

const NOTE_TREE_MOTION_MS = 180

const NOTE_TREE_DRAG_TYPE = 'mine-note-row'

function readNoteRowTops(container: HTMLElement): Map<string, number> {
  const tops = new Map<string, number>()
  for (const row of container.querySelectorAll<HTMLElement>('[data-note-row]')) {
    const id = row.dataset.noteRow
    if (id !== undefined) tops.set(id, row.offsetTop)
  }
  return tops
}

function findNoteRow(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-note-row="${CSS.escape(id)}"]`)
}

function FeedView<T>({ icon, title, description, feed, renderItem }: {
  readonly icon: LucideIcon
  readonly title: string
  readonly description: string
  readonly feed: CoreFeed<T>
  readonly renderItem: (item: T) => ReactNode
}) {
  return (
    <ContentSection
      icon={icon}
      title={title}
      description={description}
      count={feed.status === 'ready' ? feed.items.length : undefined}
    >
      {feed.status === 'loading' && (
        <div className="ui-mine__skeleton" role="status" aria-label={`正在读取${title}`}>
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
        </div>
      )}
      {feed.status === 'error' && (
        <div className="ui-mine__notice" role="alert">
          <p>{feed.error}</p>
          <button type="button" onClick={feed.retry}>重试</button>
        </div>
      )}
      {feed.status === 'ready' && feed.items.length === 0 && (
        <EmptyState icon={icon}>这里还没有内容。</EmptyState>
      )}
      {feed.status === 'ready' && feed.items.length > 0 && (
        <ul className="ui-home__core-list ui-mine__feed-list">
          {feed.items.map((item, index) => <li key={index}>{renderItem(item)}</li>)}
        </ul>
      )}
    </ContentSection>
  )
}

function ContentSection({ icon: Icon, title, description, count, children }: {
  readonly icon: LucideIcon
  readonly title: string
  readonly description: string
  readonly count?: number
  readonly children: ReactNode
}) {
  const headingId = `mine-section-${title}`
  return (
    <section className="ui-mine__section-view" aria-labelledby={headingId}>
      <header className="ui-mine__content-head">
        <span className="ui-mine__content-icon"><Icon size={17} aria-hidden /></span>
        <div>
          <h2 id={headingId}>{title}</h2>
          <p>{description}</p>
        </div>
        {count !== undefined && (
          <div className="ui-mine__content-actions">
            <span className="ui-mine__content-count">{count} 项</span>
          </div>
        )}
      </header>
      <div className="ui-mine__content-body">{children}</div>
    </section>
  )
}

function EmptyState({ icon: Icon = FileText, children }: { readonly icon?: LucideIcon; readonly children: ReactNode }) {
  return (
    <div className="ui-mine__empty">
      <Icon size={28} aria-hidden />
      <p>{children}</p>
    </div>
  )
}

function LoginGate({ title, description, detail, oauthEnabled = false, onRetry, onExit }: {
  readonly title: string
  readonly description: string
  readonly detail?: string
  readonly oauthEnabled?: boolean
  readonly onRetry?: () => void
  readonly onExit?: () => void
}) {
  useEffect(() => {
    if (onExit === undefined) return
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', exitOnEscape)
    return () => window.removeEventListener('keydown', exitOnEscape)
  }, [onExit])

  const beginLogin = (): void => {
    rememberZhihuLoginReturnToMine()
    window.location.assign('/api/auth/authorize')
  }

  return (
    <div className="ui-mine-route">
      <div className="ui-login-gate">
        <section role="dialog" aria-modal="true" aria-labelledby="zhihu-login-title" className="ui-login-gate__dialog">
          <span className="ui-login-gate__mark" aria-hidden><BrandMark size={26} /></span>
          <h1 id="zhihu-login-title">{title}</h1>
          <p>{description}</p>
          {detail !== undefined && <div className="ui-login-gate__detail" role="status">{detail}</div>}
          <div className="ui-login-gate__actions">
            {onExit !== undefined && <button type="button" className="ui-login-gate__secondary" onClick={onExit}>返回首页</button>}
            {onRetry !== undefined && <button type="button" className="ui-login-gate__primary" onClick={() => { onRetry() }}>重新检查</button>}
            {onRetry === undefined && (
              <button type="button" className="ui-login-gate__primary" disabled={!oauthEnabled} onClick={beginLogin} autoFocus>
                <LogIn size={15} aria-hidden />
                使用知乎账号登录
                <ExternalLink size={13} aria-hidden />
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function feedCount<T>(feed: CoreFeed<T>): number | undefined {
  return feed.status === 'ready' ? feed.items.length : undefined
}

function isSession(body: unknown): body is AuthSessionView {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false
  const record = body as Record<string, unknown>
  return typeof record.oauthEnabled === 'boolean' && typeof record.authenticated === 'boolean'
}

function readLoginError(): string | undefined {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('login_error')
  if (code === null) return undefined
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
  switch (code) {
    case 'missing_code':
      return '知乎授权未返回授权码，请重新登录。'
    case 'UPSTREAM_ERROR':
      return '暂时无法连接知乎授权服务，请稍后再试。'
    default:
      return '知乎授权登录失败，请重试。'
  }
}
