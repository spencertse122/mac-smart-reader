import { BookOpen } from 'lucide-react'
import { useAppState } from '../state/appState'
import { chooseAndOpenLibrary, openLibrary } from '../state/actions'

export function Welcome() {
  const { state, dispatch } = useAppState()
  const recent = state.settings?.recentLibraries ?? []
  return (
    <div className="welcome">
      <div className="welcome-card card">
        <BookOpen size={44} strokeWidth={1.4} color="var(--accent)" />
        <h1>Smart Reader</h1>
        <p>Read, highlight, and actually remember. Choose the folder where you keep your ebooks to begin.</p>
        <button className="btn btn-primary" data-testid="choose-folder" onClick={() => void chooseAndOpenLibrary(dispatch)}>
          Choose your books folder
        </button>
        {recent.length > 0 && (
          <div className="welcome-recent">
            <div className="muted" style={{ fontSize: 12, margin: '0 10px 4px' }}>Recent</div>
            {recent.map(p => (
              <button key={p} onClick={() => void openLibrary(dispatch, p)} title={p}>{p}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
