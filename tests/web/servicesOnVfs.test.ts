import { beforeEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { Vfs, setVfs } from '../../src/web/vfs/vfs'
import { readFile } from '../../src/web/vfs/fsPromises'
import { HighlightStore } from '../../src/main/highlights/highlightStore'
import { VocabStore } from '../../src/main/vocab/vocabStore'
import { ReviewService } from '../../src/main/review/reviewService'
import { LibraryService } from '../../src/main/library/libraryService'
import { SessionLog } from '../../src/main/metrics/sessions'
import { StatsService } from '../../src/main/metrics/stats'
import { retrievability } from '../../src/main/review/scheduler'

const FIXTURES = join(__dirname, '../fixtures/books')

// Same recipe as src/main/library/ids.ts, but against the real disk.
function realId(file: string): string {
  const buf = readFileSync(file)
  const h = createHash('sha256').update(buf.subarray(0, 1024 * 1024)).update(String(statSync(file).size))
  return h.digest('hex').slice(0, 16)
}

let vfs: Vfs
beforeEach(() => {
  vfs = new Vfs()
  setVfs(vfs)
})

function seedBooks(root: string): string[] {
  const names = readdirSync(FIXTURES)
  for (const n of names) vfs.writeLocal(`${root}/${n}`, new Uint8Array(readFileSync(join(FIXTURES, n))), { fromRemote: true })
  return names
}

describe('existing services on the VFS', () => {
  it('highlights, vocab, review, sessions and stats run unchanged', async () => {
    const root = '/lib'
    seedBooks(root)
    const library = new LibraryService(root, undefined, undefined, { trustMtime: false })
    const book = (await library.scan()).find(b => b.path.endsWith('.epub'))!
    const highlights = new HighlightStore(library.dataDir, async id => {
      const b = await library.get(id)
      return { bookId: id, slug: b.slug, title: b.title, author: b.author }
    })
    const vocab = new VocabStore(library.dataDir, async id => (await library.get(id)).title)
    const h = await highlights.add(book.id, {
      location: 'epubcfi(/6/2)', quote: { exact: 'know thyself', prefix: '', suffix: '' }, context: 'know thyself',
      chapter: 'c1', position: 0.1, color: 'yellow', note: null
    })
    const n = await highlights.addNote(book.id, { location: 'epubcfi(/6/4)', chapter: 'c1', position: 0.2, text: 'a note' })
    expect((await highlights.list(book.id)).map(x => x.id).sort()).toEqual([h.id, n.id].sort())

    const review = new ReviewService({
      dataDir: library.dataDir,
      highlights,
      vocab,
      bookTitle: async id => (await library.get(id)).title,
      prompts: { get: () => undefined, ids: () => [], invalidLines: 0 },
      newCardsPerDay: async () => 20
    })
    const ids = (await review.queue()).map(c => c.highlightId)
    expect(ids).toEqual(expect.arrayContaining([h.id, n.id]))
    await review.rate(h.id, 'good', 1000, 'highlight')
    expect(new TextDecoder().decode(await readFile(`${library.dataDir}/review-log.jsonl`))).toContain(h.id)

    const stats = new StatsService({
      dataDir: library.dataDir,
      getCards: () => review.cards(),
      dueCount: () => review.dueCount(),
      books: async () => (await library.list()).map(b => ({ id: b.id, title: b.title })),
      sessions: new SessionLog(library.dataDir),
      retrievability: (c, t) => retrievability(c, t, review.desiredRetention)
    })
    expect((await stats.get()).K).toBeGreaterThanOrEqual(0)
  })

  it('saveMetadata retitle renames the data dir of a book without highlights.json', async () => {
    seedBooks('/lib')
    const library = new LibraryService('/lib', undefined, undefined, { trustMtime: false })
    const book = (await library.scan()).find(b => b.path.endsWith('.epub'))!
    const oldDir = await library.bookDir(book.id)
    const oldSlug = book.slug
    vfs.writeLocal(`${oldDir}/cover.jpg`, new Uint8Array([1, 2, 3]))
    const saved = await library.saveMetadata(book.id, { title: 'Brand New Title', author: 'Me', cover: null })
    expect(saved.slug).not.toBe(oldSlug)
    expect(vfs.entry(oldDir)).toBeUndefined()
    expect(vfs.entry(`${await library.bookDir(book.id)}/cover.jpg`)?.size).toBe(3)
  })

  it('library.scan lists the fixture books with the real content ids', async () => {
    const root = '/lib'
    const names = seedBooks(root)
    const lib = new LibraryService(root)
    const books = await lib.scan()
    expect(books.map(b => b.id).sort()).toEqual(names.map(n => realId(join(FIXTURES, n))).sort())
  })
})
