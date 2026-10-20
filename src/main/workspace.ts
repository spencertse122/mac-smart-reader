import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { LibraryService } from './library/libraryService'
import { HighlightStore } from './highlights/highlightStore'
import { PromptWatcher } from './review/prompts'
import { ReviewService } from './review/reviewService'
import { retrievability } from './review/scheduler'
import { SessionLog } from './metrics/sessions'
import { StatsService } from './metrics/stats'
import { setupWorkspace } from './setup/workspaceSetup'

export class WorkspaceError extends Error {}

export interface WorkspaceOptions {
  templateDir: string
  newCardsPerDay: () => Promise<number>
  onReviewChanged: () => void
  now?: () => Date
}

export class Workspace {
  private constructor(
    readonly root: string,
    readonly library: LibraryService,
    readonly highlights: HighlightStore,
    readonly review: ReviewService,
    readonly sessions: SessionLog,
    readonly stats: StatsService,
    private prompts: PromptWatcher
  ) {}

  static async open(root: string, opts: WorkspaceOptions): Promise<Workspace> {
    const now = opts.now ?? (() => new Date())
    const st = await stat(root).catch(() => null)
    if (!st?.isDirectory()) throw new WorkspaceError(`Folder not found: ${root}`)
    try {
      await access(root, constants.R_OK | constants.W_OK)
    } catch {
      throw new WorkspaceError(`No permission to write to ${root}`)
    }
    await setupWorkspace(root, opts.templateDir)
    const library = new LibraryService(root, now)
    await library.scan()
    const highlights = new HighlightStore(library.dataDir, async id => {
      const b = await library.get(id)
      return { bookId: id, slug: b.slug, title: b.title, author: b.author }
    }, now)
    const prompts = new PromptWatcher(join(root, 'knowledge', 'prompts.jsonl'), opts.onReviewChanged)
    await prompts.load()
    prompts.start()
    const review = new ReviewService({
      dataDir: library.dataDir,
      highlights,
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
    await stats.get() // records today's K snapshot
    return new Workspace(root, library, highlights, review, sessions, stats, prompts)
  }

  close(): void {
    this.prompts.stop()
  }
}
