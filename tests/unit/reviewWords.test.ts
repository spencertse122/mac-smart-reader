import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewService } from '../../src/main/review/reviewService'
import type { Highlight, VocabWord } from '../../src/shared/types'

let dataDir: string
let clock: Date
let highlights: Array<{ bookId: string; highlights: Highlight[] }>
let words: VocabWord[]
let quota: number

const hl = (id: string, createdAt: string): Highlight => ({
  id, location: 'cfi', quote: { exact: `text ${id}`, prefix: '', suffix: '' }, context: '', chapter: 'C', position: 0,
  color: 'yellow', note: null, createdAt, updatedAt: '', deleted: false
})
const word = (id: string, headword: string, createdAt: string, over: Partial<VocabWord> = {}): VocabWord => ({
  id, headword, pronunciation: 'pron', definition: `def of ${headword}`,
  contexts: [{ bookId: 'b1', sentence: `A ${headword} sentence.`, location: 'cfi-w', chapter: 'Ch 2', at: createdAt }],
  createdAt, updatedAt: createdAt, deleted: false, ...over
})

const service = (): ReviewService =>
  new ReviewService({
    dataDir,
    highlights: { listAllBooks: async () => highlights },
    vocab: { listAll: async () => words },
    bookTitle: async id => `Title ${id}`,
    prompts: { get: () => undefined, ids: () => [], invalidLines: 0 },
    newCardsPerDay: async () => quota,
    now: () => clock
  })

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'sr-revw-'))
  clock = new Date('2026-10-20T12:00:00')
  highlights = [{ bookId: 'b1', highlights: [hl('h_1', '2026-10-20T08:00:00.000Z')] }]
  words = [word('w_1', 'serendipity', '2026-10-20T09:00:00.000Z')]
  quota = 20
})

describe('ReviewService with vocabulary', () => {
  it('queues word cards with promptType word', async () => {
    const q = await service().queue()
    expect(q.map(c => c.highlightId)).toEqual(['h_1', 'w_1'])
    expect(q[1]).toMatchObject({
      promptType: 'word', prompt: 'serendipity', answer: 'def of serendipity', pronunciation: 'pron',
      context: 'A serendipity sentence.', bookId: 'b1', bookTitle: 'Title b1', chapter: 'Ch 2', location: 'cfi-w',
      note: null, aiAnswer: null, isNew: true
    })
  })
  it('shares the new-card quota with highlights', async () => {
    quota = 1
    expect((await service().queue()).map(c => c.highlightId)).toEqual(['h_1'])
    const s = service()
    await s.rate('h_1', 'good', 1, 'highlight')
    expect(await s.queue()).toEqual([])
    quota = 2
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['w_1'])
  })
  it('suspends the card of a deleted word and restores it when undeleted', async () => {
    const s = service()
    await s.queue()
    words = [word('w_1', 'serendipity', '2026-10-20T09:00:00.000Z', { deleted: true })]
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_1'])
    expect((await s.cards())['w_1'].suspended).toBe(true)
    words = [word('w_1', 'serendipity', '2026-10-20T09:00:00.000Z')]
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_1', 'w_1'])
  })
  it('rates a word id and attributes it to the first context book', async () => {
    const s = service()
    const e = await s.rate('w_1', 'again', 1200, 'word')
    expect(e).toMatchObject({ highlightId: 'w_1', bookId: 'b1', promptType: 'word', wasNew: true })
    expect((await s.cards())['w_1'].bookId).toBe('b1')
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_1'])
  })
})
