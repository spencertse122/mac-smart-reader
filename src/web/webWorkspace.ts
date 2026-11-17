import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { LibraryService } from '../main/library/libraryService'
import { HighlightStore } from '../main/highlights/highlightStore'
import { VocabStore } from '../main/vocab/vocabStore'
import { PromptWatcher } from '../main/review/prompts'
import { ReviewService } from '../main/review/reviewService'
import { retrievability } from '../main/review/scheduler'
import { SessionLog } from '../main/metrics/sessions'
import { StatsService } from '../main/metrics/stats'

export interface WebWorkspace {
  root: string
  library: LibraryService
  highlights: HighlightStore
  vocab: VocabStore
  review: ReviewService
  sessions: SessionLog
  stats: StatsService
  close(): void
}

// Same composition as the Mac Workspace.open, minus setupWorkspace (no templates, no agent skills on web).
export async function openWebWorkspace(
  root: '/library',
  opts: { newCardsPerDay: () => Promise<number>; onReviewChanged: () => void; now?: () => Date }
): Promise<WebWorkspace> {
  const now = opts.now ?? (() => new Date())
  // trustMtime off: Drive mtimes are not the file's own, so size alone decides whether to rehash
  const library = new LibraryService(root, now, undefined, { trustMtime: false })
  await mkdir(library.dataDir, { recursive: true })
  await mkdir(join(root, 'knowledge'), { recursive: true })
  await library.scan()
  const highlights = new HighlightStore(library.dataDir, async id => {
    const b = await library.get(id)
    return { bookId: id, slug: b.slug, title: b.title, author: b.author }
  }, now)
  const vocab = new VocabStore(library.dataDir, async id => (await library.get(id)).title, now)
  const prompts = new PromptWatcher(join(root, 'knowledge', 'prompts.jsonl'), opts.onReviewChanged)
  await prompts.load()
  prompts.start()
  const review = new ReviewService({
    dataDir: library.dataDir,
    highlights,
    vocab,
    bookTitle: async id => (await library.get(id)).title,
    prompts,
    newCardsPerDay: opts.newCardsPerDay,
    now
  })
  const sessions = new SessionLog(library.dataDir)
  const stats = new StatsService({
    dataDir: library.dataDir,
    getCards: () => review.cards(),
    dueCount: () => review.dueCount(),
    books: async () => (await library.list()).map(b => ({ id: b.id, title: b.title })),
    sessions,
    retrievability: (c, t) => retrievability(c, t, review.desiredRetention),
    now
  })
  await stats.get()
  return { root, library, highlights, vocab, review, sessions, stats, close: () => prompts.stop() }
}
