import { it, expect } from 'vitest'
import { newCardState, schedule, retrievability } from '../../src/main/review/scheduler'

const t0 = new Date('2026-10-20T10:00:00Z')

it('new card is New, due at creation, zero retrievability', () => {
  const c = newCardState('b1', t0)
  expect(c).toMatchObject({ bookId: 'b1', state: 0, reps: 0, suspended: false, last_review: null, due: t0.toISOString() })
  expect(retrievability(c, t0)).toBe(0)
})

it('good on a new card moves to learning; repeated good reaches review with growing intervals', () => {
  let c = newCardState('b1', t0)
  c = schedule(c, 'good', t0)
  expect(c.state).toBe(1)
  expect(c.reps).toBe(1)
  expect(c.last_review).toBe(t0.toISOString())
  let now = new Date(c.due)
  c = schedule(c, 'good', now)
  expect(c.state).toBe(2)
  const firstInterval = new Date(c.due).getTime() - now.getTime()
  now = new Date(c.due)
  c = schedule(c, 'good', now)
  expect(new Date(c.due).getTime() - now.getTime()).toBeGreaterThan(firstInterval)
})

it('again on a review card increments lapses; retrievability decays over time', () => {
  let c = schedule(newCardState('b1', t0), 'easy', t0)
  const r1 = retrievability(c, new Date(t0.getTime() + 86400000))
  const r30 = retrievability(c, new Date(t0.getTime() + 30 * 86400000))
  expect(r1).toBeGreaterThan(r30)
  expect(r1).toBeLessThanOrEqual(1)
  c = schedule(c, 'again', new Date(c.due))
  expect(c.lapses).toBe(1)
})

it('preserves suspended flag and bookId through scheduling', () => {
  const c = { ...newCardState('bX', t0), suspended: true }
  expect(schedule(c, 'good', t0)).toMatchObject({ bookId: 'bX', suspended: true })
})
