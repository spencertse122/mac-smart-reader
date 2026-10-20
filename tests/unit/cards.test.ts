import { it, expect } from 'vitest'
import { buildPrompt, cardSource } from '../../src/main/review/cards'
import type { Highlight } from '../../src/shared/types'

const h = (over: Partial<Highlight> = {}): Highlight => ({
  id: 'h_1', location: 'cfi', quote: { exact: 'deliberate practice', prefix: '', suffix: '' },
  context: 'Experts rely on deliberate practice to improve.', chapter: 'Ch 2', position: 0.2,
  color: 'yellow', note: null, createdAt: '', updatedAt: '', deleted: false, ...over
})
const note = (text: string): Highlight => h({ kind: 'note', note: text, quote: { exact: '', prefix: '', suffix: '' }, context: '' })

it('prompt priority: ai > note > highlight', () => {
  const ai = { highlightId: 'h_1', question: 'Why practice?', answer: 'Because.' }
  expect(buildPrompt(h(), ai)).toEqual({ promptType: 'ai', prompt: 'Why practice?', aiAnswer: 'Because.' })
  expect(buildPrompt(note('x'), ai).promptType).toBe('ai')
  expect(buildPrompt(note(' my thought '))).toEqual({ promptType: 'note', prompt: 'my thought', aiAnswer: null })
  expect(buildPrompt(h())).toEqual({ promptType: 'highlight', prompt: 'deliberate practice', aiAnswer: null })
})

it('a highlight note ending in ? no longer becomes the prompt', () => {
  expect(buildPrompt(h({ note: 'What makes it deliberate?' }))).toEqual({ promptType: 'highlight', prompt: 'deliberate practice', aiAnswer: null })
})

it('card source: highlight keeps quote + own note; note item is its text', () => {
  expect(cardSource(h({ note: 'mine' }))).toEqual({ answer: 'deliberate practice', note: 'mine' })
  expect(cardSource(note('my thought'))).toEqual({ answer: 'my thought', note: null })
})
