import { join } from 'node:path'
import type { CardState, MetricSnapshot, ReviewLogEntry, SessionEntry, Stats } from '../../shared/types'
import { addDays, localDay } from '../../shared/dates'
import { readJsonl } from '../store/jsonl'
import { computeK, cumulativeMinutes, knowledgePerHour, MetricsLog } from './metrics'
import type { SessionLog } from './sessions'

export interface StatsInput {
  now: Date
  cards: Record<string, CardState>
  reviewLog: ReviewLogEntry[]
  sessions: SessionEntry[]
  snapshots: MetricSnapshot[]
  books: Array<{ id: string; title: string }>
  retrievability: (c: CardState, now: Date) => number
  dueToday: number
}

export function buildStats(input: StatsInput): Stats {
  const { now } = input
  const today = localDay(now)
  const cards = Object.values(input.cards)
  const K = computeK(cards, now, input.retrievability)
  const minutes = cumulativeMinutes(input.sessions)

  const forecast = Array.from({ length: 14 }, (_, i) => ({ date: localDay(addDays(now, i)), count: 0 }))
  for (const c of cards) {
    if (c.suspended || c.state === 0) continue
    const d = localDay(new Date(c.due))
    const slot = d <= today ? forecast[0] : forecast.find(f => f.date === d)
    if (slot) slot.count++
  }

  const reviewDays = new Set(input.reviewLog.map(e => localDay(new Date(e.ts))))
  let streakDays = 0
  let cursor = reviewDays.has(today) ? now : addDays(now, -1)
  while (reviewDays.has(localDay(cursor))) {
    streakDays++
    cursor = addDays(cursor, -1)
  }

  const minutesByDay = Array.from({ length: 30 }, (_, i) => ({ date: localDay(addDays(now, i - 29)), minutes: 0 }))
  for (const s of input.sessions) {
    if (s.kind === 'break') continue
    const slot = minutesByDay.find(m => m.date === localDay(new Date(s.start)))
    if (slot) slot.minutes = Math.round((slot.minutes + s.minutes) * 100) / 100
  }

  const kTrend = input.snapshots.filter(s => s.date !== today).slice(-59).map(s => ({ date: s.date, K: s.K }))
  kTrend.push({ date: today, K })

  const counts = new Map<string, number>()
  for (const c of cards) if (!c.suspended) counts.set(c.bookId, (counts.get(c.bookId) ?? 0) + 1)
  const titles = new Map(input.books.map(b => [b.id, b.title]))
  const perBook = [...counts.entries()]
    .map(([bookId, n]) => ({ bookId, title: titles.get(bookId) ?? 'Unknown book', cards: n }))
    .sort((a, b) => b.cards - a.cards)

  return {
    K,
    knowledgePerHour: knowledgePerHour(input.snapshots, { K, cumulativeMinutes: minutes }, now),
    dueToday: input.dueToday,
    streakDays,
    forecast,
    minutesByDay,
    kTrend,
    perBook
  }
}

export interface StatsDeps {
  dataDir: string
  getCards: () => Promise<Record<string, CardState>>
  dueCount: () => Promise<number>
  books: () => Promise<Array<{ id: string; title: string }>>
  sessions: SessionLog
  retrievability: (c: CardState, now: Date) => number
  now?: () => Date
}

export class StatsService {
  private metrics: MetricsLog

  constructor(private deps: StatsDeps) {
    this.metrics = new MetricsLog(deps.dataDir)
  }

  async get(): Promise<Stats> {
    const now = (this.deps.now ?? (() => new Date()))()
    const [cards, sessions, reviewLog, books, dueToday] = await Promise.all([
      this.deps.getCards(),
      this.deps.sessions.all(),
      readJsonl<ReviewLogEntry>(join(this.deps.dataDir, 'review-log.jsonl')).then(r => r.items),
      this.deps.books(),
      this.deps.dueCount()
    ])
    const K = computeK(Object.values(cards), now, this.deps.retrievability)
    await this.metrics.ensureToday(now, K, cumulativeMinutes(sessions))
    const snapshots = await this.metrics.all()
    return buildStats({ now, cards, reviewLog, sessions, snapshots, books, retrievability: this.deps.retrievability, dueToday })
  }
}
