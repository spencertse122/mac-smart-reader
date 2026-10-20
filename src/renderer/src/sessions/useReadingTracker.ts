import { useEffect, useRef } from 'react'
import { onReader } from '../reader/bus'
import { usePomodoro } from '../pomodoro/PomodoroProvider'
import { ReadingSessionTracker } from './tracker'

export function useReadingTracker(): void {
  const pomodoro = usePomodoro()
  const latest = useRef(pomodoro)
  latest.current = pomodoro
  const tracker = useRef<ReadingSessionTracker | null>(null)

  useEffect(() => {
    const t = new ReadingSessionTracker(s => {
      void window.api.sessions.log({
        start: new Date(s.start).toISOString(),
        end: new Date(s.end).toISOString(),
        kind: 'reading',
        bookId: s.bookId,
        pomodoro: s.pomodoro
      })
    })
    tracker.current = t
    const end = (): void => t.end(Date.now())
    const offs = [
      onReader('activity', ({ bookId }) => t.activity(bookId, Date.now(), latest.current.phase === 'work' && latest.current.running)),
      onReader('closed', end)
    ]
    window.addEventListener('blur', end)
    window.addEventListener('beforeunload', end)
    const timer = setInterval(() => t.tick(Date.now()), 15_000)
    return () => {
      offs.forEach(off => off())
      window.removeEventListener('blur', end)
      window.removeEventListener('beforeunload', end)
      clearInterval(timer)
    }
  }, [])
}
