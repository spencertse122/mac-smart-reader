import { it, expect } from 'vitest'
import { buildStats } from '../../src/main/metrics/stats'
import type { CardState, ReviewLogEntry } from '../../src/shared/types'

const now = new Date('2026-10-20T12:00:00')
const card = (over: Partial<CardState>): CardState => ({
  bookId: 'b1', due: '2026-10-20T08:00:00', stability: 1, difficulty: 1, elapsed_days: 0, scheduled_days: 0,
  learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: '', suspended: false, ...over
})
const log = (ts: string): ReviewLogEntry => ({ ts, highlightId: 'h', bookId: 'b1', rating: 'good', promptType: 'cloze', durationMs: 1, retrievabilityBefore: 0, wasNew: false })

it('builds forecast, streak, minutes, trend and per-book counts', () => {
  const s = buildStats({
    now,
    cards: {
      a: card({ due: '2026-10-18T08:00:00' }),
      b: card({ due: '2026-10-20T20:00:00' }),
      c: card({ due: '2026-10-22T08:00:00', bookId: 'b2' }),
      d: card({ state: 0, reps: 0 }),
      e: card({ suspended: true })
    },
    reviewLog: [log('2026-10-18T10:00:00'), log('2026-10-19T10:00:00'), log('2026-10-20T10:00:00')],
    sessions: [
      { start: '2026-10-20T09:00:00', end: '', kind: 'reading', bookId: 'b1', minutes: 30, pomodoro: true },
      { start: '2026-10-19T09:00:00', end: '', kind: 'review', bookId: null, minutes: 10, pomodoro: false },
      { start: '2026-10-19T09:30:00', end: '', kind: 'break', bookId: null, minutes: 5, pomodoro: true }
    ],
    snapshots: [{ date: '2026-10-19', K: 1, cumulativeMinutes: 10 }],
    books: [{ id: 'b1', title: 'Book One' }, { id: 'b2', title: 'Book Two' }],
    retrievability: () => 0.9,
    dueToday: 3
  })
  expect(s.K).toBe(2.7)
  expect(s.dueToday).toBe(3)
  expect(s.forecast).toHaveLength(14)
  expect(s.forecast[0]).toEqual({ date: '2026-10-20', count: 2 })
  expect(s.forecast[2]).toEqual({ date: '2026-10-22', count: 1 })
  expect(s.streakDays).toBe(3)
  expect(s.minutesByDay).toHaveLength(30)
  expect(s.minutesByDay.at(-1)).toEqual({ date: '2026-10-20', minutes: 30 })
  expect(s.minutesByDay.at(-2)).toEqual({ date: '2026-10-19', minutes: 10 })
  expect(s.kTrend).toEqual([{ date: '2026-10-19', K: 1 }, { date: '2026-10-20', K: 2.7 }])
  expect(s.knowledgePerHour).toBe(3.4) // (2.7 - 1) / ((40 - 10) / 60)
  expect(s.perBook).toEqual([
    { bookId: 'b1', title: 'Book One', cards: 3 },
    { bookId: 'b2', title: 'Book Two', cards: 1 }
  ])
})

it('streak counts from yesterday when nothing reviewed today, and is 0 after a gap', () => {
  const base = { now, cards: {}, sessions: [], snapshots: [], books: [], retrievability: () => 0, dueToday: 0 }
  expect(buildStats({ ...base, reviewLog: [log('2026-10-18T10:00:00'), log('2026-10-19T10:00:00')] }).streakDays).toBe(2)
  expect(buildStats({ ...base, reviewLog: [log('2026-10-17T10:00:00')] }).streakDays).toBe(0)
})
