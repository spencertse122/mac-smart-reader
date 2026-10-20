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
  it('creates a New card for each highlight and builds highlight cards', async () => {
    const q = await service().queue()
    expect(q.map(c => c.highlightId)).toEqual(['h_1', 'h_2'])
    expect(q[0]).toMatchObject({
      bookId: 'b1', bookTitle: 'Title b1', chapter: 'C', location: 'cfi-h_1', promptType: 'highlight',
      prompt: 'text h_1', answer: 'text h_1', note: null, isNew: true, aiAnswer: null
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
    const entry = await s.rate('h_1', 'good', 4200.6, 'highlight')
    expect(entry).toMatchObject({ highlightId: 'h_1', bookId: 'b1', rating: 'good', promptType: 'highlight', durationMs: 4201, retrievabilityBefore: 0, wasNew: true })
    const log = (await readFile(join(dataDir, 'review-log.jsonl'), 'utf8')).trim().split('\n')
    expect(log).toHaveLength(1)
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_2'])
    // no learning steps: a good card is not shown again minutes (or hours) later
    clock = new Date(clock.getTime() + 60 * 60 * 1000)
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_2'])
    const st = await s.cards()
    expect(new Date(st['h_1'].due).getTime() - clock.getTime()).toBeGreaterThan(23 * 3600 * 1000)
  })

  it('again clamps due to at most one day, even for a stable review card', async () => {
    const s = service()
    await s.rate('h_1', 'easy', 1, 'highlight')
    clock = new Date('2027-03-01T12:00:00')
    await s.rate('h_1', 'good', 1, 'highlight')
    const goodDue = new Date((await s.cards())['h_1'].due).getTime() - clock.getTime()
    expect(goodDue).toBeGreaterThan(24 * 3600 * 1000)
    clock = new Date('2027-09-01T12:00:00')
    await s.rate('h_1', 'again', 1, 'highlight')
    const due = new Date((await s.cards())['h_1'].due).getTime() - clock.getTime()
    expect(due).toBeLessThanOrEqual(24 * 3600 * 1000)
    expect(due).toBeGreaterThan(0)
  })

  it('note items become note cards (answer = note text) and can carry AI questions', async () => {
    books = [{ bookId: 'b1', highlights: [hl('n_1', { kind: 'note', note: 'my thought', quote: { exact: '', prefix: '', suffix: '' } })] }]
    prompts.set('n_1', { highlightId: 'n_1', question: 'What did I think?' })
    const s = service()
    expect((await s.queue())[0]).toMatchObject({ promptType: 'ai', prompt: 'What did I think?', answer: 'my thought', note: null })
    prompts.clear()
    expect((await s.queue())[0]).toMatchObject({ promptType: 'note', prompt: 'my thought', answer: 'my thought', note: null })
  })

  it('due review cards come first, ordered by lowest retrievability', async () => {
    books = [{ bookId: 'b1', highlights: [hl('h_a'), hl('h_b'), hl('h_new')] }]
    const s = service()
    await s.rate('h_a', 'easy', 1, 'highlight')
    await s.rate('h_b', 'hard', 1, 'highlight')
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
    await s.rate('h_1', 'good', 1, 'highlight')
    expect(await s.queue()).toEqual([])
    expect(await s.dueCount()).toBe(0)
    clock = new Date('2026-10-21T12:00:00')
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_2'])
    clock = new Date('2026-10-25T12:00:00')
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
    await expect(service().rate('h_zzz', 'good', 1, 'highlight')).rejects.toThrow('No card')
  })

  it('reports prompt issues', async () => {
    prompts.set('h_1', { highlightId: 'h_1', question: 'ok' })
    prompts.set('h_ghost', { highlightId: 'h_ghost', question: 'ghost' })
    const s = service()
    await s.queue()
    expect(await s.promptIssues()).toEqual({ invalidLines: 2, unknownHighlightIds: 1 })
  })
})
