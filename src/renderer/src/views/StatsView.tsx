import { useEffect, useState } from 'react'
import type { Stats } from '../../../shared/types'
import { BarChart, LineChart } from '../stats/charts'
import { formatRate } from '../stats/format'
import '../stats/stats.css'

const shortDate = (d: string) => d.slice(5)

function Kpi({ label, value, sub, testId }: { label: string; value: string; sub: string; testId?: string }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" data-testid={testId}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}

export function StatsView() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => { void window.api.stats.get().then(s => { if (alive) setStats(s) }) }
    load()
    const off = window.api.on.reviewChanged(load)
    return () => { alive = false; off() }
  }, [])

  return (
    <div className="stats-view" data-testid="view-stats">
      <div className="stats-inner">
        <h1>Your learning</h1>
        {!stats ? (
          <>
            <div className="kpi-row">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 96 }} />)}</div>
            <div className="skeleton" style={{ height: 220 }} />
            <div className="skeleton" style={{ height: 220 }} />
          </>
        ) : (
          <>
            <div className="kpi-row">
              <Kpi label="Fresh items per hour" value={formatRate(stats.knowledgePerHour)} sub="last 30 days" testId="kpi-rate" />
              <Kpi label="Fresh in mind" value={stats.K.toFixed(1)} sub="items likely still fresh today" />
              <Kpi label="Due today" value={String(stats.dueToday)} sub="cards" />
              <Kpi label="Streak" value={`${stats.streakDays} ${stats.streakDays === 1 ? 'day' : 'days'}`} sub="consecutive days" />
            </div>
            <p className="stats-explainer">
              Fresh in mind = how many of your highlights and notes are likely still fresh, based on when you last saw them in Review. Each item starts counting after its first review; reviewing keeps it fresh.
            </p>
            <section className="card stats-card">
              <h2>Fresh in mind over time</h2>
              <LineChart height={200} points={stats.kTrend.map(p => ({ label: shortDate(p.date), value: p.K }))} />
            </section>
            <section className="card stats-card">
              <h2>Minutes per day (reading + review)</h2>
              <BarChart height={180} highlightLast bars={stats.minutesByDay.map(p => ({ label: shortDate(p.date), value: p.minutes }))} />
            </section>
            <section className="card stats-card">
              <h2>Reviews due, next 14 days</h2>
              <BarChart height={180} bars={stats.forecast.map(p => ({ label: shortDate(p.date), value: p.count }))} />
            </section>
            <section className="card stats-card">
              <h2>Cards by book</h2>
              {stats.perBook.length === 0 ? <div className="muted">No cards yet.</div> : (
                <table className="stats-table">
                  <tbody>
                    {stats.perBook.slice(0, 10).map(b => <tr key={b.bookId}><td>{b.title}</td><td>{b.cards}</td></tr>)}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
