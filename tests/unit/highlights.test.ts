import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HighlightStore, type BookRef } from '../../src/main/highlights/highlightStore'
import { renderHighlightsMarkdown } from '../../src/main/highlights/markdown'
import type { NewHighlight } from '../../src/shared/types'

let dataDir: string
let store: HighlightStore
const books: Record<string, BookRef> = {
  b1: { bookId: 'b1', slug: 'deep-work-b1b1b1', title: 'Deep Work', author: 'Cal Newport' },
  b2: { bookId: 'b2', slug: 'other-b2b2b2', title: 'Other', author: '' }
}
let tick = 0
const now = () => new Date(Date.UTC(2026, 9, 20, 10, 0, tick++))

const nh = (over: Partial<NewHighlight> = {}): NewHighlight => ({
  location: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
  quote: { exact: 'Deep work is valuable', prefix: 'p', suffix: 's' },
  context: 'In short: Deep work is valuable and rare.',
  chapter: 'Chapter 1',
  position: 0.1,
  color: 'yellow',
  note: null,
  ...over
})

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'sr-hl-'))
  store = new HighlightStore(dataDir, async id => books[id], now)
})

describe('HighlightStore', () => {
  it('adds with generated id/timestamps and persists under the book slug', async () => {
    const h = await store.add('b1', nh())
    expect(h.id).toMatch(/^h_[0-9a-f-]{36}$/)
    expect(h.deleted).toBe(false)
    expect(h.createdAt).toBe(h.updatedAt)
    const file = JSON.parse(await readFile(join(dataDir, 'books/deep-work-b1b1b1/highlights.json'), 'utf8'))
    expect(file).toMatchObject({ version: 1, bookId: 'b1' })
    expect(file.highlights[0].id).toBe(h.id)
  })

  it('normalizes: trims note to null, caps context and affixes', async () => {
    const h = await store.add('b1', nh({
      note: '   ',
      context: 'x'.repeat(900),
      quote: { exact: 'Deep work', prefix: 'a'.repeat(100), suffix: 'b'.repeat(100) }
    }))
    expect(h.note).toBeNull()
    expect(h.context).toHaveLength(600)
    expect(h.quote.prefix).toHaveLength(64)
    expect(h.quote.suffix).toHaveLength(64)
  })

  it('rejects blank and oversized highlights and bad colors', async () => {
    await expect(store.add('b1', nh({ quote: { exact: '  \n ', prefix: '', suffix: '' } }))).rejects.toThrow('empty')
    await expect(store.add('b1', nh({ quote: { exact: 'x'.repeat(3001), prefix: '', suffix: '' } }))).rejects.toThrow('too long')
    await expect(store.add('b1', nh({ color: 'purple' as never }))).rejects.toThrow('color')
  })

  it('list returns non-deleted sorted by position', async () => {
    const a = await store.add('b1', nh({ position: 0.5 }))
    const b = await store.add('b1', nh({ position: 0.2 }))
    const c = await store.add('b1', nh({ position: 0.9 }))
    await store.remove('b1', c.id)
    expect((await store.list('b1')).map(h => h.id)).toEqual([b.id, a.id])
  })

  it('update changes color/note/location and bumps updatedAt', async () => {
    const h = await store.add('b1', nh())
    const u = await store.update('b1', h.id, { color: 'green', note: 'Why?', location: 'epubcfi(/6/8)' })
    expect(u).toMatchObject({ color: 'green', note: 'Why?', location: 'epubcfi(/6/8)' })
    expect(u.updatedAt > h.updatedAt).toBe(true)
    await expect(store.update('b1', 'h_missing', { color: 'blue' })).rejects.toThrow('not found')
  })

  it('remove soft-deletes; listAllBooks includes deleted across books', async () => {
    const h = await store.add('b1', nh())
    await store.add('b2', nh())
    await store.remove('b1', h.id)
    const all = await store.listAllBooks()
    expect(all.map(x => x.bookId).sort()).toEqual(['b1', 'b2'])
    expect(all.find(x => x.bookId === 'b1')!.highlights[0].deleted).toBe(true)
  })

  it('writes highlights.md mirror on every change', async () => {
    const h = await store.add('b1', nh({ note: 'remember this' }))
    let md = await readFile(join(dataDir, 'books/deep-work-b1b1b1/highlights.md'), 'utf8')
    expect(md).toContain('# Deep Work — Cal Newport')
    expect(md).toContain('> Deep work is valuable')
    expect(md).toContain(`- id: ${h.id}`)
    expect(md).toContain('- note: remember this')
    await store.remove('b1', h.id)
    md = await readFile(join(dataDir, 'books/deep-work-b1b1b1/highlights.md'), 'utf8')
    expect(md).not.toContain(h.id)
  })

  it('concurrent adds are all kept', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.add('b1', nh({ position: i / 10 }))))
    expect(await store.list('b1')).toHaveLength(10)
  })
})

describe('renderHighlightsMarkdown', () => {
  it('groups consecutive highlights by chapter in position order and quotes multi-line text', () => {
    const base = { prefix: '', suffix: '' }
    const md = renderHighlightsMarkdown({ title: 'T', author: '' }, [
      { id: 'h_2', location: '', quote: { exact: 'second', ...base }, context: '', chapter: 'B', position: 0.6, color: 'blue', note: null, createdAt: '2026-10-20T00:00:00Z', updatedAt: '', deleted: false },
      { id: 'h_1', location: '', quote: { exact: 'line one\nline two', ...base }, context: '', chapter: 'A', position: 0.1, color: 'yellow', note: 'n', createdAt: '2026-10-19T00:00:00Z', updatedAt: '', deleted: false },
      { id: 'h_3', location: '', quote: { exact: 'gone', ...base }, context: '', chapter: 'A', position: 0.2, color: 'yellow', note: null, createdAt: '2026-10-19T00:00:00Z', updatedAt: '', deleted: true }
    ])
    expect(md.indexOf('## A')).toBeLessThan(md.indexOf('## B'))
    expect(md).toContain('> line one\n> line two')
    expect(md).toContain('- id: h_1 · color: yellow · 2026-10-19')
    expect(md).not.toContain('gone')
    expect(md.startsWith('# T\n')).toBe(true)
  })

  it('renders an empty-state line', () => {
    expect(renderHighlightsMarkdown({ title: 'T', author: 'A' }, [])).toContain('_No highlights yet._')
  })
})
