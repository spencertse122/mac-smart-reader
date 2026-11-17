import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BarChart3, BookA, BookMarked, BookOpen, CircleUserRound, FolderOpen, Layers } from 'lucide-react'
import { useAppState, type View } from '../state/appState'
import { chooseAndOpenLibrary } from '../state/actions'
import { latestOpenedBook } from '../library/metadata'
import { useBookRefresh } from './useBookRefresh'

export function TabBar() {
  const { state, dispatch } = useAppState()
  useBookRefresh()
  const latest = latestOpenedBook(state.books)
  const name = state.view.name
  const go = (view: View): void => dispatch({ type: 'navigate', view })
  const tab = (id: string, label: string, icon: ReactNode, active: boolean, onClick: () => void, extra?: ReactNode) => (
    <button className={`tab ${active ? 'active' : ''}`} onClick={onClick} data-testid={`tab-${id}`} aria-current={active ? 'page' : undefined}>
      <span className="tab-icon">{icon}{extra}</span>
      <span className="tab-label">{label}</span>
    </button>
  )
  return (
    <nav className="tabbar" aria-label="Main">
      {latest && tab('continue', 'Continue', <BookMarked size={22} />, false, () => go({ name: 'reader', bookId: latest.id }))}
      {tab('library', 'Library', <BookOpen size={22} />, name === 'library', () => go({ name: 'library' }))}
      {tab('review', 'Review', <Layers size={22} />, name === 'review', () => go({ name: 'review' }),
        state.dueCount > 0 ? <span className="badge tab-badge" data-testid="due-badge">{state.dueCount}</span> : undefined)}
      {tab('vocab', 'Vocabulary', <BookA size={22} />, name === 'vocab', () => go({ name: 'vocab' }))}
      {tab('stats', 'Stats', <BarChart3 size={22} />, name === 'stats', () => go({ name: 'stats' }))}
    </nav>
  )
}

// The sidebar footer's folder/account menu, for screens without a sidebar.
export function AccountButton() {
  const { state, dispatch } = useAppState()
  const account = window.api.account
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])
  const folder = state.root?.split('/').filter(Boolean).pop() ?? ''
  if (!account) {
    return (
      <button className="m-account-btn" onClick={() => void chooseAndOpenLibrary(dispatch)} title="Open another folder">
        <FolderOpen size={16} /> <span>{folder}</span>
      </button>
    )
  }
  const email = account.email()
  return (
    <div className="m-account" ref={ref}>
      <button className="m-account-btn" onClick={() => setOpen(o => !o)} data-testid="account-menu" aria-expanded={open} aria-label="Account">
        <CircleUserRound size={17} /> <span>Account</span>
      </button>
      {open && (
        <div className="account-menu m-account-menu" role="menu">
          {email && <div className="m-account-email">{email}</div>}
          <button role="menuitem" onClick={() => { setOpen(false); void chooseAndOpenLibrary(dispatch) }}>Switch folder</button>
          <button role="menuitem" data-testid="sign-out" onClick={() => { setOpen(false); void account.signOut() }}>Sign out</button>
        </div>
      )}
    </div>
  )
}
