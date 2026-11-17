// Runs the real Mac services against the real disk, in a child process (the web vitest process
// aliases node:fs to the VFS). Usage: jiti tests/web/macTool.ts <command> <dir> [args...]
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Workspace } from '../../src/main/workspace'

const REPO = resolve(__dirname, '../..')
const FIXTURES = join(REPO, 'tests/fixtures/books')

const openWs = (dir: string) =>
  Workspace.open(dir, {
    templateDir: join(REPO, 'resources/workspace-template'),
    newCardsPerDay: async () => 20,
    onReviewChanged: () => {}
  })

type Command = (dir: string, args: string[]) => Promise<unknown>

const commands: Record<string, Command> = {
  // What the real Mac services see in a folder: used to check web edits round-trip through Drive.
  async dump(dir) {
    const ws = await openWs(dir)
    try {
      const books = await ws.library.list()
      const highlights: Record<string, unknown[]> = {}
      for (const b of books) highlights[b.id] = await ws.highlights.list(b.id)
      const cards = JSON.parse(readFileSync(join(dir, '.smartreader', 'review-state.json'), 'utf8'))
      const logPath = join(dir, '.smartreader', 'review-log.jsonl')
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
      return {
        books: books.map(b => ({ id: b.id, title: b.title, location: b.location, progress: b.progress })),
        highlights,
        vocab: (await ws.vocab.list()).map(w => ({ id: w.id, headword: w.headword })),
        reviewState: cards,
        reviewLog: log
      }
    } finally {
      ws.close()
    }
  },
  // A small but real library: books, one highlight, one word, a saved (last opened) position and one review.
  async seed(dir) {
    mkdirSync(dir, { recursive: true })
    for (const n of readdirSync(FIXTURES)) copyFileSync(join(FIXTURES, n), join(dir, n))
    const ws = await openWs(dir)
    try {
      const books = await ws.library.list()
      const epub = books.find(b => b.format === 'epub')!
      const highlight = await ws.highlights.add(epub.id, {
        location: 'epubcfi(/6/4!/4/2/1:0)',
        quote: { exact: 'All warfare is based on deception', prefix: '', suffix: '' },
        context: 'All warfare is based on deception.',
        chapter: 'Laying Plans',
        position: 0.05,
        color: 'yellow',
        note: null
      })
      const word = await ws.vocab.save({
        headword: 'deception',
        pronunciation: null,
        definition: 'the act of deceiving',
        context: { bookId: epub.id, sentence: 'All warfare is based on deception.', location: 'epubcfi(/6/4!/4/2/1:0)', chapter: 'Laying Plans' }
      })
      const location = 'epubcfi(/6/8!/4/2/1:0)'
      await ws.library.saveProgress(epub.id, location, 0.12)
      await ws.library.markOpened(epub.id)
      await ws.review.rate(highlight.id, 'good', 4000, 'highlight')
      return { books: books.map(b => ({ id: b.id, path: b.path, slug: b.slug })), epubId: epub.id, highlightId: highlight.id, wordId: word.id, location }
    } finally {
      ws.close()
    }
  }
}

async function main(): Promise<void> {
  const [cmd, dir, ...args] = process.argv.slice(2)
  const run = commands[cmd]
  if (!run || !dir) throw new Error(`usage: macTool <${Object.keys(commands).join('|')}> <dir> [args]`)
  process.stdout.write(JSON.stringify(await run(resolve(dir), args)))
}

main().catch(e => {
  process.stderr.write(String(e?.stack ?? e))
  process.exit(1)
})
