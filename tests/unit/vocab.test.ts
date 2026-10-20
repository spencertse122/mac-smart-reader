import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VocabStore } from '../../src/main/vocab/vocabStore'
import type { NewVocab } from '../../src/shared/types'

let dir: string
let clock: number
let store: VocabStore
const input = (over: Partial<NewVocab> = {}, sentence = 'A stroke of serendipity.'): NewVocab => ({
  headword: 'serendipity', pronunciation: 'ˌserənˈdipədē', definition: 'noun luck',
  context: { bookId: 'b1', sentence, location: 'cfi1', chapter: 'Ch 1' }, ...over
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sr-vocab-'))
  clock = Date.parse('2026-10-20T10:00:00Z')
  store = new VocabStore(dir, async id => `Title ${id}`, () => new Date((clock += 1000)))
})

describe('VocabStore', () => {
  it('saves a new word', async () => {
    const w = await store.save(input())
    expect(w.id).toMatch(/^w_/)
    expect(w).toMatchObject({ headword: 'serendipity', deleted: false })
    expect(w.contexts).toHaveLength(1)
    expect(await store.list()).toHaveLength(1)
    const file = JSON.parse(await readFile(join(dir, 'vocab.json'), 'utf8'))
    expect(file.version).toBe(1)
  })
  it('dedupes by headword case-insensitively; contexts append, dedupe and cap at 5', async () => {
    const a = await store.save(input())
    const b = await store.save(input({ headword: 'Serendipity' }, 'Second sentence.'))
    expect(b.id).toBe(a.id)
    await store.save(input({}, 'Second sentence.'))
    expect((await store.list())[0].contexts.map(c => c.sentence)).toEqual(['A stroke of serendipity.', 'Second sentence.'])
    for (let i = 3; i <= 8; i++) await store.save(input({}, `Sentence ${i}.`))
    const ctx = (await store.list())[0].contexts.map(c => c.sentence)
    expect(ctx).toHaveLength(5)
    expect(ctx[4]).toBe('Sentence 8.')
    expect(await store.list()).toHaveLength(1)
  })
  it('caps the sentence at 300 chars and rejects empty words', async () => {
    const w = await store.save(input({}, 'x'.repeat(500)))
    expect(w.contexts[0].sentence).toHaveLength(300)
    await expect(store.save(input({ headword: '  ' }))).rejects.toThrow()
  })
  it('lists newest first; remove hides; re-save undeletes keeping the id', async () => {
    const a = await store.save(input())
    const b = await store.save(input({ headword: 'ephemeral' }, 'It was ephemeral.'))
    expect((await store.list()).map(w => w.id)).toEqual([b.id, a.id])
    await store.remove(a.id)
    expect((await store.list()).map(w => w.id)).toEqual([b.id])
    expect((await store.listAll()).find(w => w.id === a.id)?.deleted).toBe(true)
    const again = await store.save(input())
    expect(again.id).toBe(a.id)
    expect(again.deleted).toBe(false)
    await expect(store.remove('w_nope')).rejects.toThrow()
  })
  it('renders vocab.md', async () => {
    const a = await store.save(input())
    await store.save(input({ headword: 'gone' }, 'Gone.')).then(w => store.remove(w.id))
    const md = await readFile(join(dir, 'vocab.md'), 'utf8')
    expect(md).toContain('# Vocabulary')
    expect(md).toContain('## serendipity /ˌserənˈdipədē/')
    expect(md).toContain('noun luck')
    expect(md).toContain('- “A stroke of serendipity.” — Title b1')
    expect(md).toContain(`- id: ${a.id} · added 2026-10-20`)
    expect(md).not.toContain('gone')
  })
})
