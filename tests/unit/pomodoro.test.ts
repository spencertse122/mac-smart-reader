import { it, expect } from 'vitest'
import { pomodoroReducer, initialPomodoro, remaining } from '../../src/renderer/src/pomodoro/machine'
import { DEFAULT_SETTINGS } from '../../src/shared/types'

const cfg = { ...DEFAULT_SETTINGS.pomodoro, longEvery: 2 }
const MIN = 60_000

it('start → work runs; pause/resume preserve remaining time', () => {
  let { state } = pomodoroReducer(initialPomodoro, { type: 'start', now: 0, cfg })
  expect(state).toMatchObject({ phase: 'work', running: true, endsAt: 25 * MIN })
  ;({ state } = pomodoroReducer(state, { type: 'pause', now: 5 * MIN, cfg }))
  expect(state).toMatchObject({ running: false, remainingMs: 20 * MIN })
  expect(remaining(state, 99 * MIN)).toBe(20 * MIN)
  ;({ state } = pomodoroReducer(state, { type: 'start', now: 10 * MIN, cfg }))
  expect(state.endsAt).toBe(30 * MIN)
})

it('work end auto-starts a break and emits workEnded; long break every N; break end waits for user', () => {
  let r = pomodoroReducer(initialPomodoro, { type: 'start', now: 0, cfg })
  r = pomodoroReducer(r.state, { type: 'tick', now: 25 * MIN, cfg })
  expect(r.event).toBe('workEnded')
  expect(r.state).toMatchObject({ phase: 'break', running: true, cycle: 1, endsAt: 30 * MIN })
  r = pomodoroReducer(r.state, { type: 'tick', now: 30 * MIN, cfg })
  expect(r.event).toBe('breakEnded')
  expect(r.state).toMatchObject({ phase: 'work', running: false, remainingMs: 25 * MIN })
  r = pomodoroReducer(r.state, { type: 'start', now: 31 * MIN, cfg })
  r = pomodoroReducer(r.state, { type: 'tick', now: 56 * MIN, cfg })
  expect(r.state).toMatchObject({ phase: 'longBreak', cycle: 2, endsAt: 71 * MIN })
})

it('skip ends the current phase immediately; reset returns to idle', () => {
  let r = pomodoroReducer(initialPomodoro, { type: 'start', now: 0, cfg })
  r = pomodoroReducer(r.state, { type: 'skip', now: 1 * MIN, cfg })
  expect(r.state.phase).toBe('break')
  r = pomodoroReducer(r.state, { type: 'reset', now: 2 * MIN, cfg })
  expect(r.state).toEqual(initialPomodoro)
})

it('tick before the end changes nothing', () => {
  const r0 = pomodoroReducer(initialPomodoro, { type: 'start', now: 0, cfg })
  const r = pomodoroReducer(r0.state, { type: 'tick', now: 10 * MIN, cfg })
  expect(r.state).toBe(r0.state)
  expect(r.event).toBeUndefined()
})
