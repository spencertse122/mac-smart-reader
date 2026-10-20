import type { PomodoroSettings } from '../../../shared/types'

export type Phase = 'idle' | 'work' | 'break' | 'longBreak'

export interface PomodoroState {
  phase: Phase
  running: boolean
  endsAt: number | null // epoch ms while running
  remainingMs: number // while paused
  cycle: number // completed work phases
}

export type PomodoroAction =
  | { type: 'start' | 'pause' | 'skip' | 'reset' | 'tick'; now: number; cfg: PomodoroSettings }

export type PomodoroEvent = 'workEnded' | 'breakEnded'

export const initialPomodoro: PomodoroState = { phase: 'idle', running: false, endsAt: null, remainingMs: 0, cycle: 0 }

const MIN = 60_000

export function remaining(s: PomodoroState, now: number): number {
  return s.running && s.endsAt !== null ? Math.max(0, s.endsAt - now) : s.remainingMs
}

function finish(s: PomodoroState, now: number, cfg: PomodoroSettings): { state: PomodoroState; event: PomodoroEvent } {
  if (s.phase === 'work') {
    const cycle = s.cycle + 1
    const long = cycle % cfg.longEvery === 0
    const len = (long ? cfg.longBreakMin : cfg.breakMin) * MIN
    return { state: { phase: long ? 'longBreak' : 'break', running: true, endsAt: now + len, remainingMs: len, cycle }, event: 'workEnded' }
  }
  return { state: { phase: 'work', running: false, endsAt: null, remainingMs: cfg.workMin * MIN, cycle: s.cycle }, event: 'breakEnded' }
}

export function pomodoroReducer(s: PomodoroState, a: PomodoroAction): { state: PomodoroState; event?: PomodoroEvent } {
  switch (a.type) {
    case 'start': {
      if (s.running) return { state: s }
      if (s.phase === 'idle') {
        const len = a.cfg.workMin * MIN
        return { state: { ...s, phase: 'work', running: true, endsAt: a.now + len, remainingMs: len } }
      }
      return { state: { ...s, running: true, endsAt: a.now + s.remainingMs } }
    }
    case 'pause':
      return s.running ? { state: { ...s, running: false, endsAt: null, remainingMs: remaining(s, a.now) } } : { state: s }
    case 'skip':
      return s.phase === 'idle' ? { state: s } : finish(s, a.now, a.cfg)
    case 'reset':
      return { state: initialPomodoro }
    case 'tick':
      return s.running && s.endsAt !== null && a.now >= s.endsAt ? finish(s, s.endsAt, a.cfg) : { state: s }
  }
}
