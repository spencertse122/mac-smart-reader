import { useEffect, useState } from 'react'
import { Brain } from 'lucide-react'
import { useAppState } from '../state/appState'
import { formatRate } from './format'

export function KnowledgeRate() {
  const { state, dispatch } = useAppState()
  const [rate, setRate] = useState<number | null>(null)
  const open = state.root !== null

  useEffect(() => {
    if (!open) return
    let alive = true
    const load = () => { void window.api.stats.get().then(s => { if (alive) setRate(s.knowledgePerHour) }).catch(() => {}) }
    load()
    const off = window.api.on.reviewChanged(load)
    const timer = setInterval(load, 5 * 60 * 1000)
    return () => { alive = false; off(); clearInterval(timer) }
  }, [open])

  if (!open) return null
  return (
    <button className="status-item" data-testid="status-rate"
      title="Fresh items per hour of reading and review (last 30 days)"
      onClick={() => dispatch({ type: 'navigate', view: { name: 'stats' } })}>
      <Brain size={13} /> {formatRate(rate)}
    </button>
  )
}
