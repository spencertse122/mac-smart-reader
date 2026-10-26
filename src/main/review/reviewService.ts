import { join } from 'node:path'
import type { CardState, Highlight, VocabWord, PromptIssues, PromptLine, PromptType, Rating, ReviewCard, ReviewLogEntry, ReviewStateFile } from '../../shared/types'
import { localDay } from '../../shared/dates'
import { jsonFile, type JsonFile } from '../store/jsonFile'
import { appendJsonl, readJsonl } from '../store/jsonl'
import { newCardState, retrievability, schedule } from './scheduler'
import { buildPrompt, cardSource } from './cards'

interface LiveItem { bookId: string; created: string; h?: Highlight; w?: VocabWord }

const DAY_MS = 24 * 60 * 60 * 1000

export interface HighlightSource {
  listAllBooks(): Promise<Array<{ bookId: string; highlights: Highlight[] }>>
}

export interface VocabSource {
  listAll(): Promise<VocabWord[]> // including deleted words, whose cards get suspended
}

export interface ReviewDeps {
  dataDir: string
  highlights: HighlightSource
  vocab?: VocabSource
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

  private async liveItems(): Promise<Map<string, LiveItem>> {
    const map = new Map<string, LiveItem>()
    for (const { bookId, highlights } of await this.deps.highlights.listAllBooks()) {
      for (const h of highlights) if (!h.deleted) map.set(h.id, { bookId, created: h.createdAt, h })
    }
    for (const w of await this.words()) if (!w.deleted) map.set(w.id, { bookId: w.contexts[0]?.bookId ?? '', created: w.createdAt, w })
    return map
  }

  private words(): Promise<VocabWord[]> {
    return this.deps.vocab ? this.deps.vocab.listAll() : Promise.resolve([])
  }

  async sync(): Promise<void> {
    const books = await this.deps.highlights.listAllBooks()
    const words = await this.words()
    await this.state.update(d => {
      for (const w of words) {
        const c = d.cards[w.id]
        if (w.deleted) {
          if (c) c.suspended = true
        } else if (!c) {
          d.cards[w.id] = newCardState(w.contexts[0]?.bookId ?? '', new Date(w.createdAt))
        } else if (c.suspended) {
          c.suspended = false // looked up again after a delete
        }
      }
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
    const live = await this.liveItems()
    const due: Array<{ id: string; r: number }> = []
    const fresh: Array<{ id: string; created: string }> = []
    for (const [id, c] of Object.entries(st.cards)) {
      const entry = live.get(id)
      if (c.suspended || !entry) continue
      if (c.state === 0) fresh.push({ id, created: entry.created })
      else if (new Date(c.due) <= now) due.push({ id, r: retrievability(c, now, st.desiredRetention) })
    }
    due.sort((a, b) => a.r - b.r)
    fresh.sort((a, b) => a.created.localeCompare(b.created))
    const quota = Math.max(0, (await this.deps.newCardsPerDay()) - (await this.newIntroducedToday()))
    const ids = [...due.map(d => d.id), ...fresh.slice(0, quota).map(f => f.id)]

    const titles = new Map<string, string>()
    const cards: ReviewCard[] = []
    for (const id of ids) {
      const item = live.get(id)!
      const { bookId } = item
      if (!titles.has(bookId)) titles.set(bookId, !bookId ? 'Unknown book' : await this.deps.bookTitle(bookId).catch(() => 'Unknown book'))
      if (item.w) {
        const w = item.w
        const ctx = w.contexts[0]
        cards.push({
          highlightId: id,
          bookId,
          bookTitle: titles.get(bookId)!,
          chapter: ctx?.chapter ?? null,
          location: ctx?.location ?? '',
          promptType: 'word',
          prompt: w.headword,
          answer: w.definition,
          note: null,
          aiAnswer: null,
          pronunciation: w.pronunciation,
          zh: w.zh ?? null,
          context: ctx?.sentence || null,
          isNew: st.cards[id].state === 0
        })
        continue
      }
      const h = item.h!
      cards.push({
        highlightId: id,
        bookId,
        bookTitle: titles.get(bookId)!,
        chapter: h.chapter,
        location: h.location,
        ...buildPrompt(h, this.deps.prompts.get(id)),
        ...cardSource(h),
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
      const next = schedule(c, rating, now, d.desiredRetention)
      // "Sooner" must come back within a day, however stable the card was
      const cap = new Date(now.getTime() + DAY_MS)
      if (rating === 'again' && new Date(next.due) > cap) next.due = cap.toISOString()
      d.cards[highlightId] = next
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
