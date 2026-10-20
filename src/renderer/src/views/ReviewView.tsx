import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { PromptIssues, Rating } from '../../../shared/types'
import { useAppState } from '../state/appState'
import { refreshDueCount } from '../state/actions'
import { initialSession, sessionReducer, summarize } from '../review/session'
import { ReviewCardView } from '../review/ReviewCardView'
import '../review/review.css'

export function ReviewView() {
  const { dispatch: appDispatch } = useAppState()
  const [s, dispatch] = useReducer(sessionReducer, initialSession)
  const [issues, setIssues] = useState<PromptIssues | null>(null)
  const sRef = useRef(s)
  sRef.current = s
  const busy = useRef(false)
  const logged = useRef(false)
  const card = s.cards[s.index]

  useEffect(() => {
    let live = true
    window.api.review.queue().then(cards => { if (live) dispatch({ type: 'loaded', cards, now: Date.now() }) })
    window.api.review.promptIssues().then(i => { if (live) setIssues(i) })
    return () => { live = false }
  }, [])

  const logSession = useCallback(() => {
    const cur = sRef.current
    if (logged.current || cur.results.length < 1 || cur.startedAt == null) return
    logged.current = true
    void window.api.sessions.log({ start: new Date(cur.startedAt).toISOString(), end: new Date().toISOString(), kind: 'review', bookId: null, pomodoro: false })
  }, [])

  useEffect(() => () => logSession(), [logSession])

  useEffect(() => {
    if (s.phase === 'done') {
      logSession()
      let live = true
      window.api.review.queue().then(q => {
        const have = new Set(sRef.current.cards.map(c => c.highlightId))
        const fresh = q.filter(c => !have.has(c.highlightId))
        if (live && fresh.length) dispatch({ type: 'more', cards: fresh, now: Date.now() })
      })
      return () => { live = false }
    }
    if (s.phase === 'empty') logSession()
  }, [s.phase, logSession])

  const rate = useCallback(async (rating: Rating) => {
    const cur = sRef.current
    const c = cur.cards[cur.index]
    if (!c || !cur.revealed || busy.current) return
    busy.current = true
    try {
      const entry = await window.api.review.rate(c.highlightId, rating, Date.now() - cur.shownAt, c.promptType)
      dispatch({ type: 'rated', entry, now: Date.now() })
      await refreshDueCount(appDispatch)
    } finally {
      busy.current = false
    }
  }, [appDispatch])

  const open = useCallback(() => {
    const c = sRef.current.cards[sRef.current.index]
    if (c) appDispatch({ type: 'navigate', view: { name: 'reader', bookId: c.bookId, target: c.location } })
  }, [appDispatch])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const cur = sRef.current
      if (cur.phase !== 'card') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); open(); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') { e.preventDefault(); dispatch({ type: 'reveal' }) }
      else if (cur.revealed) {
        const r = ({ '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' } as const)[e.key as '1']
        if (r) void rate(r)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rate, open])

  const skipped = issues ? issues.invalidLines + issues.unknownHighlightIds : 0
  const sum = summarize(s)

  let body = null
  if (s.phase === 'card' && card) {
    body = (
      <ReviewCardView card={card} position={s.index + 1} total={s.cards.length} revealed={s.revealed}
        onReveal={() => dispatch({ type: 'reveal' })} onRate={r => void rate(r)} onOpen={open} />
    )
  } else if (s.phase === 'empty') {
    body = (
      <div className="review-state" data-testid="review-empty">
        <svg className="review-check" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="m8 12.5 3 3 5-6" />
        </svg>
        <h2>You're all caught up</h2>
        <div className="muted">Highlight while reading — each highlight becomes a card.</div>
      </div>
    )
  } else if (s.phase === 'done') {
    body = (
      <div className="card review-card review-state" data-testid="review-done">
        <h2>Session complete</h2>
        <div className="review-stats">
          <div className="review-tile"><b>{sum.count}</b><span>Cards</span></div>
          <div className="review-tile"><b>{sum.minutes}</b><span>Minutes</span></div>
          <div className="review-tile"><b>{Math.round(sum.avgRetrievability * 100)}%</b><span>Avg. recall before review</span></div>
        </div>
        <button className="btn btn-primary" onClick={() => appDispatch({ type: 'navigate', view: { name: 'library' } })}>Back to Library</button>
      </div>
    )
  }

  return (
    <div className="review-root" data-testid="view-review">
      <div className="review-stage">{body}</div>
      {skipped > 0 && <div className="review-issues muted">{skipped} lines in knowledge/prompts.jsonl were skipped.</div>}
    </div>
  )
}
