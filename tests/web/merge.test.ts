import { describe, expect, it } from 'vitest'
import { mergeFile } from '../../src/web/sync/merge'

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n'
const p = (s: string) => JSON.parse(s)

const hl = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) => ({
  id, location: 'cfi', quote: { exact: id, prefix: '', suffix: '' }, context: '', chapter: null, position: 0,
  color: 'yellow', note: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt, deleted: false, ...extra
})
const card = (last: string | null, extra: Record<string, unknown> = {}) => ({
  bookId: 'b1', due: '2026-02-01T00:00:00.000Z', stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 0,
  learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: last, suspended: false, ...extra
})
const HL = '/library/.smartreader/books/x/highlights.json'

describe('mergeFile', () => {
  it('highlights: both sides add different items → both kept', () => {
    const base = { version: 1, bookId: 'b', highlights: [hl('a', 't1')] }
    const local = { ...base, highlights: [hl('a', 't1'), hl('l', 't2')] }
    const remote = { ...base, highlights: [hl('a', 't1'), hl('r', 't3')] }
    const out = p(mergeFile(HL, j(base), j(local), j(remote)))
    expect(out.highlights.map((h: { id: string }) => h.id).sort()).toEqual(['a', 'l', 'r'])
    // also without a base (two-way)
    const two = p(mergeFile(HL, null, j(local), j(remote)))
    expect(two.highlights.map((h: { id: string }) => h.id).sort()).toEqual(['a', 'l', 'r'])
  })

  it('highlights: both edit same id → later updatedAt wins', () => {
    const base = { version: 1, bookId: 'b', highlights: [hl('a', '2026-01-01T00:00:00.000Z'), hl('b', '2026-01-01T00:00:00.000Z')] }
    const local = { ...base, highlights: [hl('a', '2026-01-03T00:00:00.000Z', { color: 'green' }), hl('b', '2026-01-02T00:00:00.000Z', { note: 'mine' })] }
    const remote = { ...base, highlights: [hl('a', '2026-01-02T00:00:00.000Z', { note: 'theirs' }), hl('b', '2026-01-04T00:00:00.000Z', { color: 'pink' })] }
    const out = p(mergeFile(HL, j(base), j(local), j(remote)))
    const byId = Object.fromEntries(out.highlights.map((h: { id: string }) => [h.id, h]))
    expect(byId.a).toEqual(local.highlights[0]) // whole item, not a field mix
    expect(byId.b).toEqual(remote.highlights[1])
    // one side changed only → that side
    const onlyRemote = { ...base, highlights: [hl('a', '2026-01-01T00:00:00.000Z'), hl('b', '2025-01-01T00:00:00.000Z', { color: 'blue' })] }
    const out2 = p(mergeFile(HL, j(base), j(base), j(onlyRemote)))
    expect(out2.highlights[1].color).toBe('blue')
  })

  it('review-state: card changed both sides → later last_review wins as a whole card', () => {
    const P = '/library/.smartreader/review-state.json'
    const base = { version: 1, desiredRetention: 0.9, cards: { c1: card(null), c2: card(null), c3: card(null) } }
    const local = { ...base, cards: { c1: card('2026-01-05T00:00:00.000Z', { stability: 2, suspended: true }), c2: card('2026-01-05T00:00:00.000Z', { reps: 1 }), c3: card(null), c4: card(null) } }
    const remote = { ...base, desiredRetention: 0.95, cards: { c1: card('2026-01-06T00:00:00.000Z', { stability: 3 }), c2: card('2026-01-04T00:00:00.000Z', { reps: 2 }), c3: card('2026-01-01T00:00:00.000Z', { reps: 9 }) } }
    const out = p(mergeFile(P, j(base), j(local), j(remote)))
    expect(out.cards.c1).toEqual(remote.cards.c1)
    expect(out.cards.c2).toEqual(local.cards.c2)
    expect(out.cards.c3).toEqual(remote.cards.c3)
    expect(out.cards.c4).toEqual(local.cards.c4)
    expect(out.desiredRetention).toBe(0.95)
    // a tie goes to local
    const t = '2026-01-05T00:00:00.000Z'
    const tie = p(mergeFile(P, j(base), j({ ...base, cards: { c1: card(t, { reps: 1 }) } }), j({ ...base, cards: { c1: card(t, { reps: 2 }) } })))
    expect(tie.cards.c1.reps).toBe(1)
  })

  it('library: location+progress move as a unit; disjoint fields from both sides kept', () => {
    const P = '/library/.smartreader/library.json'
    const book = { id: 'b1', title: 'T', author: 'A', location: 'L0', progress: 0, lastOpenedAt: null, hasCover: false }
    const base = { version: 1, books: { b1: book } }
    const local = { version: 1, books: { b1: { ...book, location: 'L1', title: 'Local title' } } }
    const remote = { version: 1, books: { b1: { ...book, progress: 0.5, lastOpenedAt: 'x' }, b2: { ...book, id: 'b2' } } }
    const out = p(mergeFile(P, j(base), j(local), j(remote)))
    // local moved the position, so its location AND progress win together
    expect(out.books.b1).toMatchObject({ location: 'L1', progress: 0, title: 'Local title', lastOpenedAt: 'x' })
    expect(out.books.b2).toBeTruthy()
    // remote moved the position only → remote pair
    const r2 = { version: 1, books: { b1: { ...book, location: 'L2', progress: 0.7 } } }
    const out2 = p(mergeFile(P, j(base), j({ version: 1, books: { b1: { ...book, title: 'X' } } }), j(r2)))
    expect(out2.books.b1).toMatchObject({ location: 'L2', progress: 0.7, title: 'X' })
    // both changed the same field → local
    const out3 = p(mergeFile(P, j(base), j({ version: 1, books: { b1: { ...book, author: 'L' } } }), j({ version: 1, books: { b1: { ...book, author: 'R' } } })))
    expect(out3.books.b1.author).toBe('L')
  })

  it('jsonl: remote lines + local new lines, no duplicates, order kept', () => {
    const P = '/library/.smartreader/review-log.jsonl'
    const base = '{"a":1}\n{"a":2}\n'
    const local = '{"a":1}\n{"a":2}\n{"l":1}\n{"l":2}\n'
    const remote = '{"a":1}\n{"a":2}\n{"r":1}\n{"l":1}\n'
    expect(mergeFile(P, base, local, remote)).toBe('{"a":1}\n{"a":2}\n{"r":1}\n{"l":1}\n{"l":2}\n')
    expect(mergeFile(P, null, local, remote)).toBe('{"a":1}\n{"a":2}\n{"r":1}\n{"l":1}\n{"l":2}\n')
    // a line removed remotely and untouched locally stays removed
    expect(mergeFile(P, base, base, '{"a":2}\n')).toBe('{"a":2}\n')
  })

  it('md mirrors: local wins', () => {
    expect(mergeFile('/library/.smartreader/books/x/highlights.md', 'b', 'local', 'remote')).toBe('local')
    expect(mergeFile('/library/.smartreader/vocab.md', null, 'local', 'remote')).toBe('local')
  })

  it('generic json: local change vs base wins, otherwise remote', () => {
    const P = '/library/.smartreader/template-manifest.json'
    const base = { version: 1, files: { a: '1', b: '1', c: '1' }, list: [1, 2] }
    const local = { version: 1, files: { a: '2', b: '1', c: '1' }, list: [1, 2] }
    const remote = { version: 1, files: { a: '3', b: '3', d: '1' }, list: [3] }
    expect(p(mergeFile(P, j(base), j(local), j(remote)))).toEqual({ version: 1, files: { a: '2', b: '3', d: '1' }, list: [3] })
  })

  it('invalid remote JSON → local returned', () => {
    const P = '/library/.smartreader/vocab.json'
    const local = j({ version: 1, words: [] })
    expect(mergeFile(P, null, local, '{"version": 1, "wor')).toBe(local)
  })
})
