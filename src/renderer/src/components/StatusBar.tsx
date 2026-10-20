import { Layers, TerminalSquare } from 'lucide-react'
import { useAppState } from '../state/appState'
import { PomodoroControl } from '../pomodoro/PomodoroProvider'
import { KnowledgeRate } from '../stats/KnowledgeRate'

export function StatusBar() {
  const { state, dispatch } = useAppState()
  return (
    <footer className="statusbar">
      <PomodoroControl />
      <button className="status-item" data-testid="status-due" onClick={() => dispatch({ type: 'navigate', view: { name: 'review' } })}>
        <Layers size={13} /> {state.dueCount} due
      </button>
      <span className="spacer" />
      <KnowledgeRate />
      <button className="status-item" title="Toggle terminal (⌘J)" onClick={() => dispatch({ type: 'toggleTerminal' })}>
        <TerminalSquare size={13} /> Terminal
      </button>
    </footer>
  )
}
