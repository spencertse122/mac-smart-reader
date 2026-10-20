import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useAppState } from '../state/appState'

export function Toasts() {
  const { state, dispatch } = useAppState()
  useEffect(() => {
    const timers = state.toasts.map(t => setTimeout(() => dispatch({ type: 'dismissToast', id: t.id }), t.kind === 'error' ? 9000 : 5000))
    return () => timers.forEach(clearTimeout)
  }, [state.toasts, dispatch])
  return (
    <div className="toasts" role="status">
      {state.toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind}`} data-testid="toast">
          <span style={{ flex: 1 }}>{t.message}</span>
          <button className="icon-btn" onClick={() => dispatch({ type: 'dismissToast', id: t.id })} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
