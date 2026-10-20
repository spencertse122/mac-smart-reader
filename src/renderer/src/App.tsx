import { useEffect, useRef } from 'react'
import { useAppState } from './state/appState'
import { chooseAndOpenLibrary, openLibrary, refreshBooks, refreshDueCount, toast } from './state/actions'
import { latestOpenedBook } from './library/metadata'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Toasts } from './components/Toasts'
import { Welcome } from './components/Welcome'
import { LibraryView } from './views/LibraryView'
import { ReaderView } from './views/ReaderView'
import { ReviewView } from './views/ReviewView'
import { StatsView } from './views/StatsView'
import { TerminalPanel } from './terminal/TerminalPanel'
import { PomodoroProvider, usePomodoro } from './pomodoro/PomodoroProvider'
import { emitReader } from './reader/bus'
import { useReadingTracker } from './sessions/useReadingTracker'

export function App() {
  return (
    <PomodoroProvider>
      <Shell />
    </PomodoroProvider>
  )
}

function Shell() {
  const { state, dispatch } = useAppState()
  const pomodoroState = usePomodoro()
  const pomodoro = useRef(pomodoroState)
  pomodoro.current = pomodoroState
  const viewName = useRef(state.view.name)
  viewName.current = state.view.name
  useReadingTracker()
  const booksRef = useRef(state.books)
  booksRef.current = state.books
  const openLatest = (): void => {
    const b = latestOpenedBook(booksRef.current)
    if (b) dispatch({ type: 'navigate', view: { name: 'reader', bookId: b.id } })
  }

  useEffect(() => {
    void (async () => {
      const settings = await window.api.settings.get()
      dispatch({ type: 'settings', settings })
      if (settings.libraryPath) {
        const ok = await openLibrary(dispatch, settings.libraryPath)
        if (!ok) dispatch({ type: 'libraryClosed' })
      } else {
        dispatch({ type: 'libraryClosed' })
      }
    })()
  }, [dispatch])

  useEffect(() => {
    const offs = [
      window.api.on.toast(t => toast(dispatch, t.kind, t.message)),
      window.api.on.reviewChanged(() => void refreshDueCount(dispatch)),
      window.api.on.libraryChanged(() => void refreshBooks(dispatch)),
      window.api.on.menu(a => {
        if (a.type === 'open-folder') void chooseAndOpenLibrary(dispatch)
        else if (a.type === 'open-library') void openLibrary(dispatch, a.path)
        else if (a.type === 'toggle-terminal') dispatch({ type: 'toggleTerminal' })
        else if (a.type === 'continue-reading') openLatest()
        else if (a.type === 'toggle-pomodoro') pomodoro.current.toggle()
        else if (a.type === 'new-note') {
          if (viewName.current === 'reader') emitReader('new-note', {})
        }
      })
    ]
    return () => offs.forEach(off => off())
  }, [dispatch])

  if (state.status === 'loading') return <div className="welcome" />
  if (!state.root) return (<><Welcome /><Toasts /></>)

  const v = state.view
  const position = state.settings?.terminalPosition ?? 'bottom'
  return (
    <div className="app" data-testid="app-shell">
      <Sidebar />
      <main className={`main term-${position}`}>
        <div className="content">
          {v.name === 'library' && <LibraryView />}
          {v.name === 'reader' && <ReaderView key={v.bookId} bookId={v.bookId} target={v.target} />}
          {v.name === 'review' && <ReviewView />}
          {v.name === 'stats' && <StatsView />}
        </div>
        {state.terminalMounted && <TerminalPanel visible={state.terminalOpen} />}
      </main>
      <StatusBar />
      <Toasts />
    </div>
  )
}
