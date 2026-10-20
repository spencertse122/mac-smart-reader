import { it, expect } from 'vitest'
import { makeCloze, buildPrompt } from '../../src/main/review/cards'
import type { Highlight } from '../../src/shared/types'

const h = (over: Partial<Highlight> = {}): Highlight => ({
  id: 'h_1', location: 'cfi', quote: { exact: 'deliberate practice', prefix: '', suffix: '' },
  context: 'Experts rely on deliberate practice to improve.', chapter: 'Ch 2', position: 0.2,
  color: 'yellow', note: null, createdAt: '', updatedAt: '', deleted: false, ...over
})

it('blanks the highlight inside its context with a word count', () => {
  expect(makeCloze('Experts rely on deliberate practice to improve.', 'deliberate practice'))
    .toBe('Experts rely on ▁▁▁▁ (~2 words) to improve.')
  expect(makeCloze('A word here.', 'word')).toBe('A ▁▁▁▁ (~1 word) here.')
})

it('long highlights keep the first 6 words as a cue', () => {
  const words = Array.from({ length: 45 }, (_, i) => `w${i}`).join(' ')
  expect(makeCloze(`Start ${words} end`, words)).toBe('Start w0 w1 w2 w3 w4 w5 ▁▁▁▁ (~39 more words) end')
})

it('matches across whitespace differences', () => {
  expect(makeCloze('one  two\nthree four', 'two three')).toBe('one ▁▁▁▁ (~2 words) four')
})

it('cloze falls back when quote not in context', () => {
  expect(makeCloze('unrelated context', 'missing words')).toBe('▁▁▁▁ (~2 words)')
})

it('prompt priority: ai > note question > cloze', () => {
  expect(buildPrompt(h(), { highlightId: 'h_1', question: 'Why practice?', answer: 'Because.' }))
    .toEqual({ promptType: 'ai', prompt: 'Why practice?', aiAnswer: 'Because.' })
  expect(buildPrompt(h({ note: ' What makes practice deliberate? ' })))
    .toEqual({ promptType: 'note', prompt: 'What makes practice deliberate?', aiAnswer: null })
  expect(buildPrompt(h({ note: 'just a note' })).promptType).toBe('cloze')
  expect(buildPrompt(h({ note: 'just a note' })).prompt).toBe('Experts rely on ▁▁▁▁ (~2 words) to improve.')
})
