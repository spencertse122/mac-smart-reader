import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'
import { useAppState } from '../state/appState'
import { updateSettings } from '../state/actions'
import { WELCOME_LINE, xtermTheme } from './xtermTheme'

interface Tab { key: number; ptyId: string | null; exited: boolean; title: string }
interface Session { term: Terminal; fit: FitAddon; ptyId: string | null; exited: boolean }

const EXIT_NOTICE = '\r\n\x1b[2m[Process exited — press Enter to restart]\x1b[0m\r\n'
const darkMql = () => window.matchMedia('(prefers-color-scheme: dark)')

function loadSize(position: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(`sr.terminal.size.${position}`))
    return n > 0 ? n : fallback
  } catch { return fallback }
}

export function TerminalPanel({ visible }: { visible: boolean }) {
  const { state, dispatch } = useAppState()
  const position = state.settings?.terminalPosition ?? 'bottom'
  const nextKey = useRef(1)
  const [tabs, setTabs] = useState<Tab[]>([{ key: 0, ptyId: null, exited: false, title: 'Terminal 1' }])
  const [active, setActive] = useState(0)
  const [sizes, setSizes] = useState({ bottom: loadSize('bottom', 280), right: loadSize('right', 420) })
  const sessions = useRef(new Map<number, Session>())
  const pending = useRef(new Map<string, string>())
  const counter = useRef(1)

  const byPty = useCallback((id: string) => {
    for (const [key, s] of sessions.current) if (s.ptyId === id) return { key, s }
    return null
  }, [])

  const markExited = useCallback((key: number, exited: boolean) => {
    setTabs(ts => ts.map(t => (t.key === key ? { ...t, exited } : t)))
  }, [])

  useEffect(() => {
    const offData = window.api.pty.onData((id, data) => {
      const hit = byPty(id)
      if (hit) hit.s.term.write(data)
      else pending.current.set(id, (pending.current.get(id) ?? '') + data)
    })
    const offExit = window.api.pty.onExit(id => {
      const hit = byPty(id)
      if (!hit) return
      hit.s.exited = true
      hit.s.term.write(EXIT_NOTICE)
      markExited(hit.key, true)
    })
    return () => { offData(); offExit() }
  }, [byPty, markExited])

  const addTab = useCallback(() => {
    const key = nextKey.current++
    counter.current += 1
    setTabs(ts => [...ts, { key, ptyId: null, exited: false, title: `Terminal ${counter.current}` }])
    setActive(key)
  }, [])

  const closeTab = useCallback((key: number) => {
    setTabs(ts => ts.filter(t => t.key !== key))
    setActive(a => {
      if (a !== key) return a
      const rest = [...sessions.current.keys()].filter(k => k !== key)
      return rest.length ? rest[rest.length - 1] : a
    })
  }, [])

  // Closing the last tab hides the panel; a fresh tab is created next time it opens.
  useEffect(() => {
    if (tabs.length === 0) {
      if (visible) dispatch({ type: 'toggleTerminal', open: false })
      return
    }
  }, [tabs.length, visible, dispatch])

  useEffect(() => {
    if (visible && tabs.length === 0) {
      const key = nextKey.current++
      counter.current = 1
      setTabs([{ key, ptyId: null, exited: false, title: 'Terminal 1' }])
      setActive(key)
    }
  }, [visible, tabs.length])

  useEffect(() => {
    if (!visible) return
    const s = sessions.current.get(active)
    if (!s) return
    requestAnimationFrame(() => {
      try { s.fit.fit() } catch { /* not laid out yet */ }
      if (s.ptyId) window.api.pty.resize(s.ptyId, s.term.cols, s.term.rows)
      s.term.focus()
    })
  }, [visible, active, tabs.length, position])

  const size = position === 'bottom' ? sizes.bottom : sizes.right

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const start = position === 'bottom' ? e.clientY : e.clientX
    const base = size
    const move = (ev: PointerEvent) => {
      const delta = (position === 'bottom' ? ev.clientY : ev.clientX) - start
      const next = base - delta
      const max = (position === 'bottom' ? window.innerHeight : window.innerWidth) * 0.8
      const min = position === 'bottom' ? 120 : 260
      const clamped = Math.round(Math.min(Math.max(next, min), max))
      setSizes(s => ({ ...s, [position]: clamped }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setSizes(s => {
        try { localStorage.setItem(`sr.terminal.size.${position}`, String(s[position])) } catch { /* ignore */ }
        return s
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const style = position === 'bottom' ? { height: size } : { width: size }

  return (
    <div
      className={`terminal-panel pos-${position}${visible ? '' : ' hidden'}`}
      data-testid="terminal-panel"
      style={style}
    >
      <div className="term-resize" onPointerDown={startDrag} data-testid="term-resize" />
      <div className="term-header">
        <div className="term-tabs">
          {tabs.map(t => (
            <div
              key={t.key}
              className={`term-tab${t.key === active ? ' active' : ''}${t.exited ? ' exited' : ''}`}
              onMouseDown={() => setActive(t.key)}
            >
              <span className="term-tab-title">{t.title}</span>
              <button className="term-btn" title="Close terminal" aria-label="Close terminal" onClick={e => { e.stopPropagation(); closeTab(t.key) }}>×</button>
            </div>
          ))}
          <button className="term-btn" data-testid="term-new-tab" title="New terminal" aria-label="New terminal" onClick={addTab}>+</button>
        </div>
        <div className="term-actions">
          <button
            className="term-btn"
            title={position === 'bottom' ? 'Move to right' : 'Move to bottom'}
            aria-label="Toggle terminal position"
            onClick={() => updateSettings(dispatch, { terminalPosition: position === 'bottom' ? 'right' : 'bottom' })}
          >{position === 'bottom' ? '⇥' : '⇩'}</button>
          <button className="term-btn" title="Hide terminal" aria-label="Hide terminal" onClick={() => dispatch({ type: 'toggleTerminal', open: false })}>–</button>
        </div>
      </div>
      <div className="term-body">
        {tabs.map(t => (
          <TermPane
            key={t.key}
            tabKey={t.key}
            active={t.key === active}
            sessions={sessions.current}
            pending={pending.current}
            onExited={markExited}
          />
        ))}
      </div>
    </div>
  )
}

interface PaneProps {
  tabKey: number
  active: boolean
  sessions: Map<number, Session>
  pending: Map<string, string>
  onExited: (key: number, exited: boolean) => void
}

function TermPane({ tabKey, active, sessions, pending, onExited }: PaneProps) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current!
    const mql = darkMql()
    const term = new Terminal({
      fontFamily: "'SF Mono', Menlo, monospace", fontSize: 12.5, lineHeight: 1.2, cursorBlink: true,
      allowProposedApi: true, theme: xtermTheme(mql.matches), scrollback: 5000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    const session: Session = { term, fit, ptyId: null, exited: false }
    sessions.set(tabKey, session)
    let disposed = false
    try { fit.fit() } catch { /* hidden */ }
    term.write(WELCOME_LINE)

    const start = async () => {
      try {
        const id = await window.api.pty.create(term.cols, term.rows)
        if (disposed) { window.api.pty.kill(id); return }
        session.ptyId = id
        session.exited = false
        onExited(tabKey, false)
        const buffered = pending.get(id)
        if (buffered) { pending.delete(id); term.write(buffered) }
      } catch (err) {
        session.exited = true
        const msg = err instanceof Error ? err.message : String(err)
        term.write(`\r\n\x1b[31mCould not start a shell: ${msg}\x1b[0m\r\n`)
        onExited(tabKey, true)
      }
    }
    void start()

    const dataSub = term.onData(d => {
      if (session.exited) {
        if (d === '\r') {
          session.ptyId = null
          session.exited = false
          void start()
        }
        return
      }
      if (session.ptyId) window.api.pty.write(session.ptyId, d)
    })

    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!el.offsetParent) return
        try { fit.fit() } catch { return }
        if (session.ptyId) window.api.pty.resize(session.ptyId, term.cols, term.rows)
      }, 50)
    })
    ro.observe(el)

    const onTheme = (e: MediaQueryListEvent) => { term.options.theme = xtermTheme(e.matches) }
    mql.addEventListener('change', onTheme)

    return () => {
      disposed = true
      clearTimeout(timer)
      ro.disconnect()
      mql.removeEventListener('change', onTheme)
      dataSub.dispose()
      if (session.ptyId) window.api.pty.kill(session.ptyId)
      sessions.delete(tabKey)
      term.dispose()
    }
  }, [tabKey, sessions, pending, onExited])

  return <div ref={host} className={`term-pane${active ? '' : ' inactive'}`} />
}
