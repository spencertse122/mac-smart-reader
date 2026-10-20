import { it, expect } from 'vitest'
import { ReadingSessionTracker } from '../../src/renderer/src/sessions/tracker'

const MIN = 60_000

it('groups activity into sessions, splits on idle and book change, ends at last activity', () => {
  const logged: Array<{ start: number; end: number; bookId: string; pomodoro: boolean }> = []
  const t = new ReadingSessionTracker(e => logged.push(e), 3 * MIN)
  t.activity('a', 0, false)
  t.activity('a', 2 * MIN, true)
  t.activity('a', 4 * MIN, false)
  t.tick(6 * MIN)
  expect(logged).toEqual([])
  t.tick(7.5 * MIN)
  expect(logged).toEqual([{ start: 0, end: 4 * MIN, bookId: 'a', pomodoro: true }])
  t.activity('a', 8 * MIN, false)
  t.activity('b', 9 * MIN, false)
  expect(logged[1]).toEqual({ start: 8 * MIN, end: 9 * MIN, bookId: 'a', pomodoro: false })
  t.end(10 * MIN)
  expect(logged[2]).toEqual({ start: 9 * MIN, end: 10 * MIN, bookId: 'b', pomodoro: false })
  t.end(11 * MIN)
  expect(logged).toHaveLength(3)
})
