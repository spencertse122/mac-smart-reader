import { useEffect, useRef } from 'react'
import { useAppState } from './state/appState'
import { chooseAndOpenLibrary, openLibrary, refreshBooks, refreshDueCount, toast } from './state/actions'
import { latestOpenedBook } from './library/metadata'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import { useIsMobile } from './components/useIsMobile'
import { Toasts } from './components/Toasts'
import { Welcome } from './components/Welcome'
import { LibraryView } from './views/LibraryView'
import { ReaderView } from './views/ReaderView'
import { ReviewView } from './views/ReviewView'
import { VocabView } from './views/VocabView'
import { StatsView } from './views/StatsView'
import { TerminalPanel } from './terminal/TerminalPanel'
import { PomodoroProvider, usePomodoro } from './pomodoro/PomodoroProvider'
import { emitReader } from './reader/bus'
import { useReadingTracker } from './sessions/useReadingTracker'
import './styles/mobile.css'

export function App() {
  return (
    <PomodoroProvider>
      <Shell />
    </PomodoroProvider>
  )
}

function Shell() {
  const { state, dispatch } = useAppState()
  const mobile = useIsMobile()
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
        else if (a.type === 'toggle-terminal') { if (window.api.platform !== 'web') dispatch({ type: 'toggleTerminal' }) }
        else if (a.type === 'continue-reading') openLatest()
        else if (a.type === 'toggle-pomodoro') pomodoro.current.toggle()
        else if (a.type === 'new-note') {
          if (viewName.current === 'reader') emitReader('new-note', {})
        }
      })
    ]
    return () => offs.forEach(off => off())
  }, [dispatch])

  // Cards fall due and the daily new-card quota resets with the clock alone, so recount
  // when the app comes back (e.g. after the Mac slept overnight) and once a minute.
  useEffect(() => {
    if (!state.root) return
    const refresh = (): void => { if (document.visibilityState === 'visible') void refreshDueCount(dispatch) }
    const timer = setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [dispatch, state.root])

  if (state.status === 'loading') return <div className="welcome" />
  if (!state.root) return (<><Welcome /><Toasts /></>)

  const v = state.view
  const views = (
    <>
      {v.name === 'library' && <LibraryView />}
      {v.name === 'reader' && <ReaderView key={v.bookId} bookId={v.bookId} target={v.target} />}
      {v.name === 'review' && <ReviewView />}
      {v.name === 'stats' && <StatsView />}
      {v.name === 'vocab' && <VocabView />}
    </>
  )
  const position = state.settings?.terminalPosition ?? 'bottom'
  // One tree for both layouts, so rotating a phone (which can flip the layout) never remounts the open view.
  // Phones get a full-screen view with a bottom tab bar; the reader takes the whole screen.
  return (
    <div className={mobile ? `app mobile${v.name === 'reader' ? ' in-reader' : ''}` : 'app'} data-testid="app-shell">
      {!mobile && <Sidebar />}
      <main className={mobile ? 'main' : `main term-${position}`}>
        <div className="content">{views}</div>
        {!mobile && window.api.platform !== 'web' && state.terminalMounted && <TerminalPanel visible={state.terminalOpen} />}
      </main>
      {!mobile && <StatusBar />}
      {mobile && v.name !== 'reader' && <TabBar />}
      <Toasts />
    </div>
  )
}
