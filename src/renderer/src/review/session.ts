import type { ReviewCard, ReviewLogEntry } from '../../../shared/types'

export interface SessionState {
  cards: ReviewCard[]
  index: number
  revealed: boolean
  shownAt: number
  results: ReviewLogEntry[]
  startedAt: number | null
  phase: 'loading' | 'card' | 'done' | 'empty'
}

export type SessionAction =
  | { type: 'loaded'; cards: ReviewCard[]; now: number }
  | { type: 'reveal' }
  | { type: 'rated'; entry: ReviewLogEntry; now: number }
  | { type: 'more'; cards: ReviewCard[]; now: number }

export const initialSession: SessionState = { cards: [], index: 0, revealed: false, shownAt: 0, results: [], startedAt: null, phase: 'loading' }

export function sessionReducer(s: SessionState, a: SessionAction): SessionState {
  switch (a.type) {
    case 'loaded':
      return a.cards.length
        ? { ...initialSession, cards: a.cards, phase: 'card', shownAt: a.now, startedAt: a.now }
        : { ...initialSession, phase: 'empty' }
    case 'reveal':
      return s.phase === 'card' ? { ...s, revealed: true } : s
    case 'rated': {
      const results = [...s.results, a.entry]
      const index = s.index + 1
      return index < s.cards.length
        ? { ...s, results, index, revealed: false, shownAt: a.now }
        : { ...s, results, index, revealed: false, phase: 'done' }
    }
    case 'more':
      return a.cards.length ? { ...s, cards: [...s.cards, ...a.cards], phase: 'card', revealed: false, shownAt: a.now } : s
  }
}

export function summarize(s: SessionState): { count: number; minutes: number; avgRetrievability: number } {
  const count = s.results.length
  const ms = s.results.reduce((a, r) => a + r.durationMs, 0)
  const avg = count ? s.results.reduce((a, r) => a + r.retrievabilityBefore, 0) / count : 0
  return { count, minutes: Math.round((ms / 60000) * 10) / 10, avgRetrievability: Math.round(avg * 100) / 100 }
}
