import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewService, type HighlightSource } from '../../src/main/review/reviewService'
import type { Highlight, PromptLine } from '../../src/shared/types'

let dataDir: string
let clock: Date
let books: Array<{ bookId: string; highlights: Highlight[] }>
let prompts: Map<string, PromptLine>
let quota: number

const hl = (id: string, over: Partial<Highlight> = {}): Highlight => ({
  id, location: `cfi-${id}`, quote: { exact: `text ${id}`, prefix: '', suffix: '' }, context: `ctx text ${id} end`,
  chapter: 'C', position: 0, color: 'yellow', note: null, createdAt: '2026-10-20T08:00:00.000Z',
  updatedAt: '', deleted: false, ...over
})

function service(): ReviewService {
  const source: HighlightSource = { listAllBooks: async () => books }
  return new ReviewService({
    dataDir,
    highlights: source,
    bookTitle: async id => `Title ${id}`,
    prompts: { get: id => prompts.get(id), ids: () => [...prompts.keys()], invalidLines: 2 },
    newCardsPerDay: async () => quota,
    now: () => clock
  })
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'sr-rev-'))
  clock = new Date('2026-10-20T12:00:00')
  books = [{ bookId: 'b1', highlights: [hl('h_1'), hl('h_2', { createdAt: '2026-10-20T09:00:00.000Z' })] }]
  prompts = new Map()
  quota = 20
})

describe('ReviewService', () => {
  it('creates a New card for each highlight and builds cloze cards', async () => {
    const q = await service().queue()
    expect(q.map(c => c.highlightId)).toEqual(['h_1', 'h_2'])
    expect(q[0]).toMatchObject({
      bookId: 'b1', bookTitle: 'Title b1', chapter: 'C', location: 'cfi-h_1', promptType: 'cloze',
      prompt: 'ctx ▁▁▁▁ (~2 words) end', answer: 'text h_1', isNew: true, aiAnswer: null
    })
    const state = JSON.parse(await readFile(join(dataDir, 'review-state.json'), 'utf8'))
    expect(state.desiredRetention).toBe(0.9)
    expect(Object.keys(state.cards).sort()).toEqual(['h_1', 'h_2'])
  })

  it('uses AI prompts when present', async () => {
    prompts.set('h_2', { highlightId: 'h_2', question: 'Explain h2?', answer: 'Because' })
    const q = await service().queue()
    expect(q.find(c => c.highlightId === 'h_2')).toMatchObject({ promptType: 'ai', prompt: 'Explain h2?', aiAnswer: 'Because' })
  })

  it('rate schedules, logs, and removes the card from the immediate queue', async () => {
    const s = service()
    const entry = await s.rate('h_1', 'good', 4200.6, 'cloze')
    expect(entry).toMatchObject({ highlightId: 'h_1', bookId: 'b1', rating: 'good', promptType: 'cloze', durationMs: 4201, retrievabilityBefore: 0, wasNew: true })
    const log = (await readFile(join(dataDir, 'review-log.jsonl'), 'utf8')).trim().split('\n')
    expect(log).toHaveLength(1)
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_2'])
    clock = new Date(clock.getTime() + 60 * 60 * 1000)
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_1', 'h_2'])
  })

  it('due review cards come first, ordered by lowest retrievability', async () => {
    books = [{ bookId: 'b1', highlights: [hl('h_a'), hl('h_b'), hl('h_new')] }]
    const s = service()
    await s.rate('h_a', 'easy', 1, 'cloze')
    await s.rate('h_b', 'hard', 1, 'cloze')
    clock = new Date('2026-12-31T12:00:00')
    const q = await s.queue()
    expect(q.slice(0, 2).map(c => c.highlightId).sort()).toEqual(['h_a', 'h_b'])
    expect(q[2].highlightId).toBe('h_new')
    expect(q[0].isNew).toBe(false)
  })

  it('enforces the new-cards-per-day quota using today\'s log', async () => {
    quota = 1
    books = [{ bookId: 'b1', highlights: [hl('h_1'), hl('h_2'), hl('h_3')] }]
    const s = service()
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_1'])
    await s.rate('h_1', 'good', 1, 'cloze')
    expect(await s.queue()).toEqual([])
    expect(await s.dueCount()).toBe(0)
    clock = new Date('2026-10-21T12:00:00')
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_1', 'h_2'])
  })

  it('deleted highlights suspend their cards', async () => {
    const s = service()
    await s.queue()
    books = [{ bookId: 'b1', highlights: [hl('h_1', { deleted: true }), hl('h_2')] }]
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_2'])
    expect((await s.cards())['h_1'].suspended).toBe(true)
  })

  it('rate on unknown card rejects', async () => {
    await expect(service().rate('h_zzz', 'good', 1, 'cloze')).rejects.toThrow('No card')
  })

  it('reports prompt issues', async () => {
    prompts.set('h_1', { highlightId: 'h_1', question: 'ok' })
    prompts.set('h_ghost', { highlightId: 'h_ghost', question: 'ghost' })
    const s = service()
    await s.queue()
    expect(await s.promptIssues()).toEqual({ invalidLines: 2, unknownHighlightIds: 1 })
  })
})
