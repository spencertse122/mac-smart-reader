import { it, expect } from 'vitest'
import { sessionReducer, initialSession, summarize } from '../../src/renderer/src/review/session'
import type { ReviewCard, ReviewLogEntry } from '../../src/shared/types'

const card = (id: string): ReviewCard => ({ highlightId: id, bookId: 'b', bookTitle: 'B', chapter: null, location: 'cfi', promptType: 'cloze', prompt: 'p', answer: 'a', note: null, aiAnswer: null, isNew: true })
const entry = (r: number, ms: number): ReviewLogEntry => ({ ts: '', highlightId: 'h', bookId: 'b', rating: 'good', promptType: 'cloze', durationMs: ms, retrievabilityBefore: r, wasNew: false })

it('walks loading → card → reveal → next → done', () => {
  let s = sessionReducer(initialSession, { type: 'loaded', cards: [card('1'), card('2')], now: 1000 })
  expect(s).toMatchObject({ phase: 'card', index: 0, revealed: false, shownAt: 1000, startedAt: 1000 })
  s = sessionReducer(s, { type: 'reveal' })
  expect(s.revealed).toBe(true)
  s = sessionReducer(s, { type: 'rated', entry: entry(0.8, 4000), now: 6000 })
  expect(s).toMatchObject({ index: 1, revealed: false, shownAt: 6000 })
  s = sessionReducer(s, { type: 'rated', entry: entry(0.6, 2000), now: 9000 })
  expect(s.phase).toBe('done')
  expect(summarize(s)).toEqual({ count: 2, minutes: 0.1, avgRetrievability: 0.7 })
})

it('empty queue goes to empty; more cards can be appended after done', () => {
  expect(sessionReducer(initialSession, { type: 'loaded', cards: [], now: 0 }).phase).toBe('empty')
  let s = sessionReducer(initialSession, { type: 'loaded', cards: [card('1')], now: 0 })
  s = sessionReducer(s, { type: 'rated', entry: entry(0, 1000), now: 1000 })
  expect(s.phase).toBe('done')
  s = sessionReducer(s, { type: 'more', cards: [card('9')], now: 2000 })
  expect(s).toMatchObject({ phase: 'card', index: 1, shownAt: 2000 })
})
