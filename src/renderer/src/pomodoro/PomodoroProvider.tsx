import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pause, Play, Timer } from 'lucide-react'
import { DEFAULT_SETTINGS, type PomodoroSettings } from '../../../shared/types'
import { useAppState } from '../state/appState'
import { toast, updateSettings } from '../state/actions'
import { initialPomodoro, pomodoroReducer, remaining, type Phase, type PomodoroAction, type PomodoroState } from './machine'
import { playChime } from './chime'
import { BreakOverlay } from './BreakOverlay'
import './pomodoro.css'

export type PomodoroPhase = Phase

interface Ctx {
  state: PomodoroState
  remainingMs: number
  cfg: PomodoroSettings
  toggle(): void
  skip(): void
  reset(): void
}

const PomodoroContext = createContext<Ctx | null>(null)

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const { state: app, dispatch } = useAppState()
  const cfg = app.settings?.pomodoro ?? DEFAULT_SETTINGS.pomodoro
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const stateRef = useRef(initialPomodoro)
  const [state, setState] = useState(initialPomodoro)
  const [now, setNow] = useState(() => Date.now())
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [due, setDue] = useState(0)
  const breakStart = useRef<number | null>(null)

  const run = useCallback((type: PomodoroAction['type']) => {
    const t = Date.now()
    const r = pomodoroReducer(stateRef.current, { type, now: t, cfg: cfgRef.current })
    stateRef.current = r.state
    setState(r.state)
    setNow(t)
    if (r.event === 'workEnded') {
      breakStart.current = t
      if (cfgRef.current.sound) playChime()
      setOverlayOpen(true)
      void window.api.review.dueCount().then(setDue)
    } else if (r.event === 'breakEnded') {
      if (cfgRef.current.sound) playChime()
      toast(dispatch, 'info', 'Break over — press ▶ or ⌥⌘P to start the next focus session')
      setOverlayOpen(false)
      if (breakStart.current !== null) {
        void window.api.sessions.log({
          start: new Date(breakStart.current).toISOString(),
          end: new Date(t).toISOString(),
          kind: 'break',
          bookId: null,
          pomodoro: true
        })
        breakStart.current = null
      }
    } else if (type === 'reset') {
      breakStart.current = null
      setOverlayOpen(false)
    }
  }, [dispatch])

  useEffect(() => {
    const id = setInterval(() => run('tick'), 1000)
    return () => clearInterval(id)
  }, [run])

  const toggle = useCallback(() => run(stateRef.current.running ? 'pause' : 'start'), [run])
  const skip = useCallback(() => run('skip'), [run])
  const reset = useCallback(() => run('reset'), [run])

  const value = useMemo<Ctx>(
    () => ({ state, remainingMs: remaining(state, now), cfg, toggle, skip, reset }),
    [state, now, cfg, toggle, skip, reset]
  )
  const inBreak = state.phase === 'break' || state.phase === 'longBreak'

  return (
    <PomodoroContext.Provider value={value}>
      {children}
      {overlayOpen && inBreak && <BreakOverlay remainingMs={value.remainingMs} dueCount={due} onClose={() => setOverlayOpen(false)} />}
    </PomodoroContext.Provider>
  )
}

export function usePomodoro(): { phase: PomodoroPhase; running: boolean; remainingMs: number; toggle(): void; skip(): void; reset(): void } {
  const c = useContext(PomodoroContext)
  if (!c) throw new Error('usePomodoro outside PomodoroProvider')
  return { phase: c.state.phase, running: c.state.running, remainingMs: c.remainingMs, toggle: c.toggle, skip: c.skip, reset: c.reset }
}

function fmt(ms: number): string {
  const total = Math.ceil(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function PomodoroControl() {
  const c = useContext(PomodoroContext)
  const { dispatch } = useAppState()
  const [open, setOpen] = useState(false)
  if (!c) return null
  const { state, cfg } = c
  const set = (patch: Partial<PomodoroSettings>): void => void updateSettings(dispatch, { pomodoro: { ...cfg, ...patch } })
  const num = (label: string, key: 'workMin' | 'breakMin' | 'longBreakMin' | 'longEvery') => (
    <label>
      {label}
      <input type="number" min={key === 'longEvery' ? 1 : 0.1} step={key === 'longEvery' ? 1 : 1} value={cfg[key]}
        onChange={e => { const v = Number(e.target.value); if (v > 0) set({ [key]: v }) }} />
    </label>
  )

  return (
    <span className="pomo" data-testid="pomodoro">
      {state.phase === 'idle' ? (
        <button className="status-item" data-testid="pomodoro-start" title="Start focus session (⌥⌘P)" onClick={c.toggle}>
          <Timer size={13} /> Focus
        </button>
      ) : (
        <>
          <button className="status-item" title="Timer options" onClick={() => setOpen(o => !o)}>
            <span className={`pomo-dot ${state.phase === 'work' ? '' : 'break'}`} />
            <span className="pomo-time" data-testid="pomodoro-time">{fmt(c.remainingMs)}</span>
          </button>
          <button className="status-item" data-testid="pomodoro-toggle" title={state.running ? 'Pause' : 'Resume'} onClick={c.toggle}>
            {state.running ? <Pause size={13} /> : <Play size={13} />}
          </button>
        </>
      )}
      {open && state.phase !== 'idle' && (
        <div className="pomo-pop">
          <div className="row">
            <button className="btn" onClick={() => { c.skip(); setOpen(false) }}>Skip</button>
            <button className="btn" onClick={() => { c.reset(); setOpen(false) }}>Reset</button>
          </div>
          {num('Work (min)', 'workMin')}
          {num('Break (min)', 'breakMin')}
          {num('Long break (min)', 'longBreakMin')}
          {num('Long break every', 'longEvery')}
          <label>Sound<input type="checkbox" checked={cfg.sound} onChange={e => set({ sound: e.target.checked })} /></label>
        </div>
      )}
    </span>
  )
}
