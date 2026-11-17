// Runs the real Mac services against the real disk, in a child process (the web vitest process
// aliases node:fs to the VFS). Usage: jiti tests/web/macTool.ts <command> <dir> [args...]
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
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
  // A small but real library: books, one highlight, one word, a saved position and one review.
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
