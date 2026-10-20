import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionLog } from '../../src/main/metrics/sessions'
import { computeK, cumulativeMinutes, knowledgePerHour, MetricsLog } from '../../src/main/metrics/metrics'
import type { CardState } from '../../src/shared/types'

const card = (over: Partial<CardState>): CardState => ({
  bookId: 'b', due: '', stability: 1, difficulty: 1, elapsed_days: 0, scheduled_days: 0, learning_steps: 0,
  reps: 1, lapses: 0, state: 2, last_review: '', suspended: false, ...over
})

describe('SessionLog', () => {
  it('computes minutes, drops tiny sessions, rejects invalid ranges', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sr-s-'))
    const log = new SessionLog(dir)
    const e = await log.append({ start: '2026-10-20T10:00:00Z', end: '2026-10-20T10:25:30Z', kind: 'reading', bookId: 'b', pomodoro: true })
    expect(e?.minutes).toBe(25.5)
    expect(await log.append({ start: '2026-10-20T10:00:00Z', end: '2026-10-20T10:00:03Z', kind: 'reading', bookId: 'b', pomodoro: false })).toBeNull()
    await expect(log.append({ start: '2026-10-20T10:00:00Z', end: '2026-10-20T09:00:00Z', kind: 'reading', bookId: null, pomodoro: false })).rejects.toThrow('Invalid session')
    expect(await log.all()).toHaveLength(1)
    expect((await readFile(join(dir, 'sessions.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1)
  })
})

describe('metrics', () => {
  it('K sums retrievability of reviewed, unsuspended cards', () => {
    const cards = [card({}), card({ reps: 0, state: 0 }), card({ suspended: true }), card({})]
    expect(computeK(cards, new Date(), () => 0.8)).toBe(1.6)
  })

  it('cumulative minutes excludes breaks', () => {
    expect(cumulativeMinutes([
      { start: '', end: '', kind: 'reading', bookId: null, minutes: 20, pomodoro: false },
      { start: '', end: '', kind: 'review', bookId: null, minutes: 5, pomodoro: false },
      { start: '', end: '', kind: 'break', bookId: null, minutes: 5, pomodoro: true }
    ])).toBe(25)
  })

  it('knowledgePerHour uses the snapshot ~30 days back, else the earliest', () => {
    const now = new Date('2026-12-01T12:00:00')
    const snaps = [
      { date: '2026-10-01', K: 0, cumulativeMinutes: 0 },
      { date: '2026-10-30', K: 10, cumulativeMinutes: 600 },
      { date: '2026-11-20', K: 30, cumulativeMinutes: 1200 }
    ]
    expect(knowledgePerHour(snaps, { K: 40, cumulativeMinutes: 1800 }, now)).toBe(1.5)
    expect(knowledgePerHour(snaps.slice(2), { K: 40, cumulativeMinutes: 1800 }, now)).toBe(1)
    expect(knowledgePerHour([], { K: 1, cumulativeMinutes: 10 }, now)).toBeNull()
    expect(knowledgePerHour(snaps.slice(2), { K: 31, cumulativeMinutes: 1210 }, now)).toBeNull()
  })

  it('ensureToday appends at most one snapshot per local day', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sr-m-'))
    const m = new MetricsLog(dir)
    await m.ensureToday(new Date('2026-10-20T09:00:00'), 1, 10)
    await m.ensureToday(new Date('2026-10-20T18:00:00'), 2, 20)
    await m.ensureToday(new Date('2026-10-21T09:00:00'), 3, 30)
    expect(await m.all()).toEqual([
      { date: '2026-10-20', K: 1, cumulativeMinutes: 10 },
      { date: '2026-10-21', K: 3, cumulativeMinutes: 30 }
    ])
  })
})
