import { join } from 'node:path'
import type { CardState, Highlight, PromptIssues, PromptLine, PromptType, Rating, ReviewCard, ReviewLogEntry, ReviewStateFile } from '../../shared/types'
import { localDay } from '../../shared/dates'
import { jsonFile, type JsonFile } from '../store/jsonFile'
import { appendJsonl, readJsonl } from '../store/jsonl'
import { newCardState, retrievability, schedule } from './scheduler'
import { buildPrompt } from './cards'

export interface HighlightSource {
  listAllBooks(): Promise<Array<{ bookId: string; highlights: Highlight[] }>>
}

export interface ReviewDeps {
  dataDir: string
  highlights: HighlightSource
  bookTitle: (bookId: string) => Promise<string>
  prompts: { get(id: string): PromptLine | undefined; ids(): string[]; readonly invalidLines: number }
  newCardsPerDay: () => Promise<number>
  now?: () => Date
}

export class ReviewService {
  readonly desiredRetention = 0.9
  private state: JsonFile<ReviewStateFile>
  private logPath: string
  private now: () => Date

  constructor(private deps: ReviewDeps) {
    this.now = deps.now ?? (() => new Date())
    this.state = jsonFile<ReviewStateFile>(join(deps.dataDir, 'review-state.json'), () => ({
      version: 1,
      desiredRetention: this.desiredRetention,
      cards: {}
    }))
    this.logPath = join(deps.dataDir, 'review-log.jsonl')
  }

  private async liveHighlights(): Promise<Map<string, { bookId: string; h: Highlight }>> {
    const map = new Map<string, { bookId: string; h: Highlight }>()
    for (const { bookId, highlights } of await this.deps.highlights.listAllBooks()) {
      for (const h of highlights) if (!h.deleted) map.set(h.id, { bookId, h })
    }
    return map
  }

  async sync(): Promise<void> {
    const books = await this.deps.highlights.listAllBooks()
    await this.state.update(d => {
      for (const { bookId, highlights } of books) {
        for (const h of highlights) {
          const c = d.cards[h.id]
          if (h.deleted) {
            if (c) c.suspended = true
          } else if (!c) {
            d.cards[h.id] = newCardState(bookId, new Date(h.createdAt))
          }
        }
      }
    })
  }

  async cards(): Promise<Record<string, CardState>> {
    await this.sync()
    return (await this.state.read()).cards
  }

  private async newIntroducedToday(): Promise<number> {
    const { items } = await readJsonl<ReviewLogEntry>(this.logPath)
    const today = localDay(this.now())
    return new Set(items.filter(e => e.wasNew && localDay(new Date(e.ts)) === today).map(e => e.highlightId)).size
  }

  async queue(): Promise<ReviewCard[]> {
    await this.sync()
    const now = this.now()
    const st = await this.state.read()
    const live = await this.liveHighlights()
    const due: Array<{ id: string; r: number }> = []
    const fresh: Array<{ id: string; created: string }> = []
    for (const [id, c] of Object.entries(st.cards)) {
      const entry = live.get(id)
      if (c.suspended || !entry) continue
      if (c.state === 0) fresh.push({ id, created: entry.h.createdAt })
      else if (new Date(c.due) <= now) due.push({ id, r: retrievability(c, now, st.desiredRetention) })
    }
    due.sort((a, b) => a.r - b.r)
    fresh.sort((a, b) => a.created.localeCompare(b.created))
    const quota = Math.max(0, (await this.deps.newCardsPerDay()) - (await this.newIntroducedToday()))
    const ids = [...due.map(d => d.id), ...fresh.slice(0, quota).map(f => f.id)]

    const titles = new Map<string, string>()
    const cards: ReviewCard[] = []
    for (const id of ids) {
      const { bookId, h } = live.get(id)!
      if (!titles.has(bookId)) titles.set(bookId, await this.deps.bookTitle(bookId).catch(() => 'Unknown book'))
      cards.push({
        highlightId: id,
        bookId,
        bookTitle: titles.get(bookId)!,
        chapter: h.chapter,
        location: h.location,
        ...buildPrompt(h, this.deps.prompts.get(id)),
        answer: h.quote.exact,
        note: h.note,
        isNew: st.cards[id].state === 0
      })
    }
    return cards
  }

  async dueCount(): Promise<number> {
    return (await this.queue()).length
  }

  async rate(highlightId: string, rating: Rating, durationMs: number, promptType: PromptType): Promise<ReviewLogEntry> {
    await this.sync()
    const now = this.now()
    let entry: ReviewLogEntry | undefined
    await this.state.update(d => {
      const c = d.cards[highlightId]
      if (!c) throw new Error(`No card for ${highlightId}`)
      const before = retrievability(c, now, d.desiredRetention)
      entry = {
        ts: now.toISOString(),
        highlightId,
        bookId: c.bookId,
        rating,
        promptType,
        durationMs: Math.max(0, Math.round(durationMs)),
        retrievabilityBefore: Math.round(before * 1000) / 1000,
        wasNew: c.state === 0
      }
      d.cards[highlightId] = schedule(c, rating, now, d.desiredRetention)
    })
    await appendJsonl(this.logPath, entry)
    return entry!
  }

  async promptIssues(): Promise<PromptIssues> {
    const known = new Set(Object.keys((await this.state.read()).cards))
    return {
      invalidLines: this.deps.prompts.invalidLines,
      unknownHighlightIds: this.deps.prompts.ids().filter(id => !known.has(id)).length
    }
  }
}
