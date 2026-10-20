import { useAppState } from '../state/appState'

export function BreakOverlay({ remainingMs, dueCount, onClose }: { remainingMs: number; dueCount: number; onClose: () => void }) {
  const { dispatch } = useAppState()
  const total = Math.ceil(remainingMs / 1000)
  const time = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  return (
    <div className="break-overlay" data-testid="break-overlay">
      <div className="break-card">
        <h2>Break time</h2>
        <div className="break-time">{time}</div>
        {dueCount > 0 ? (
          <>
            <p>Quick win: review {dueCount} due cards?</p>
            <div className="break-actions">
              <button className="btn btn-primary" data-testid="break-review" onClick={() => { onClose(); dispatch({ type: 'navigate', view: { name: 'review' } }) }}>Review</button>
              <button className="btn" data-testid="break-skip" onClick={onClose}>Skip</button>
            </div>
          </>
        ) : (
          <>
            <p>Stand up, stretch, look far away.</p>
            <div className="break-actions">
              <button className="btn" data-testid="break-skip" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
