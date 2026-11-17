import type { ReactNode } from 'react'
import { BarChart3, BookA, BookMarked, BookOpen, Layers } from 'lucide-react'
import { useAppState, type View } from '../state/appState'
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
