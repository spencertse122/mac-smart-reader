import { useEffect, type ReactNode } from 'react'
import { BarChart3, BookMarked, BookOpen, FolderOpen, Highlighter, Layers } from 'lucide-react'
import { useAppState, type SidebarTab } from '../state/appState'
import { chooseAndOpenLibrary, refreshBooks } from '../state/actions'
import { latestOpenedBook } from '../library/metadata'
import { HighlightsPanel } from './HighlightsPanel'

export function Sidebar() {
  const { state, dispatch } = useAppState()
  const readerBookId = state.view.name === 'reader' ? state.view.bookId : null
  const go = (tab: SidebarTab): void => {
    if (tab === 'library') dispatch({ type: 'navigate', view: { name: 'library' } })
    else if (tab === 'review') dispatch({ type: 'navigate', view: { name: 'review' } })
    else if (tab === 'stats') dispatch({ type: 'navigate', view: { name: 'stats' } })
    else dispatch({ type: 'sidebarTab', tab })
  }
  const item = (tab: SidebarTab, label: string, icon: ReactNode, extra?: ReactNode) => (
    <button className={`sidebar-item ${state.sidebarTab === tab ? 'active' : ''}`} onClick={() => go(tab)} onMouseUp={e => e.currentTarget.blur()} data-testid={`nav-${tab}`}>
      {icon}
      <span>{label}</span>
      {extra}
    </button>
  )
  // Opening a book and reading both update the persisted book record; pick that up whenever the view changes.
  const viewName = state.view.name
  useEffect(() => { if (state.root) void refreshBooks(dispatch).catch(() => undefined) }, [viewName, readerBookId, state.root, dispatch])
  const latest = latestOpenedBook(state.books)
  const folder = state.root?.split('/').filter(Boolean).pop() ?? ''
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {latest && (
          <button className={`sidebar-item ${readerBookId === latest.id ? 'active' : ''}`} title={`Continue Reading: ${latest.title} (⌘B)`}
            onClick={() => dispatch({ type: 'navigate', view: { name: 'reader', bookId: latest.id } })} onMouseUp={e => e.currentTarget.blur()} data-testid="nav-continue">
            <BookMarked size={16} />
            <span className="continue-title">{latest.title}</span>
            <span className="continue-pct">{Math.round(latest.progress * 100)}%</span>
          </button>
        )}
        {item('library', 'Library', <BookOpen size={16} />)}
        {item('highlights', 'Highlights', <Highlighter size={16} />)}
        {item('review', 'Review', <Layers size={16} />, state.dueCount > 0 ? <span className="badge" data-testid="due-badge">{state.dueCount}</span> : undefined)}
        {item('stats', 'Stats', <BarChart3 size={16} />)}
      </nav>
      <div className="sidebar-section">
        {state.sidebarTab === 'highlights' &&
          (readerBookId ? <HighlightsPanel bookId={readerBookId} /> : <p className="muted" style={{ padding: '12px 18px' }}>Open a book to see its highlights.</p>)}
      </div>
      <div className="sidebar-footer" title={state.root ?? ''}>
        <FolderOpen size={14} />
        <span className="folder-name">{folder}</span>
        <button className="btn-ghost icon-btn" title="Open another folder (⇧⌘O)" onClick={() => void chooseAndOpenLibrary(dispatch)}>
          …
        </button>
      </div>
    </aside>
  )
}
