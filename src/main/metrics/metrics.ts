import { join } from 'node:path'
import type { CardState, MetricSnapshot, SessionEntry } from '../../shared/types'
import { addDays, localDay } from '../../shared/dates'
import { appendJsonl, readJsonl } from '../store/jsonl'

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places

export function computeK(cards: CardState[], now: Date, retr: (c: CardState, now: Date) => number): number {
  let k = 0
  for (const c of cards) if (!c.suspended && c.reps > 0) k += retr(c, now)
  return round(k, 3)
}

export function cumulativeMinutes(sessions: SessionEntry[]): number {
  return round(sessions.filter(s => s.kind !== 'break').reduce((a, s) => a + s.minutes, 0), 2)
}

export function knowledgePerHour(
  snapshots: MetricSnapshot[],
  current: { K: number; cumulativeMinutes: number },
  now: Date
): number | null {
  if (snapshots.length === 0) return null
  const cutoff = localDay(addDays(now, -30))
  const older = snapshots.filter(s => s.date <= cutoff)
  const base = older.length ? older[older.length - 1] : snapshots[0]
  const hours = (current.cumulativeMinutes - base.cumulativeMinutes) / 60
  if (hours < 0.25) return null
  return round((current.K - base.K) / hours, 2)
}

export class MetricsLog {
  private path: string

  constructor(dataDir: string) {
    this.path = join(dataDir, 'metrics.jsonl')
  }

  async all(): Promise<MetricSnapshot[]> {
    return (await readJsonl<MetricSnapshot>(this.path)).items
  }

  async ensureToday(now: Date, K: number, cumulativeMinutes: number): Promise<void> {
    const today = localDay(now)
    const all = await this.all()
    if (all.length && all[all.length - 1].date === today) return
    await appendJsonl(this.path, { date: today, K, cumulativeMinutes })
  }
}
