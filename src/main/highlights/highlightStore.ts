import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { HIGHLIGHT_COLORS, LIMITS, type Highlight, type HighlightPatch, type HighlightsFile, type NewHighlight } from '../../shared/types'
import { jsonFile, type JsonFile } from '../store/jsonFile'
import { readJson, writeFileAtomic } from '../store/atomic'
import { renderHighlightsMarkdown } from './markdown'

export interface BookRef { bookId: string; slug: string; title: string; author: string }

export class HighlightError extends Error {}

export class HighlightStore {
  private files = new Map<string, JsonFile<HighlightsFile>>()

  constructor(
    private dataDir: string,
    private resolveBook: (bookId: string) => Promise<BookRef>,
    private now: () => Date = () => new Date()
  ) {}

  private fileAt(dir: string, bookId: string): JsonFile<HighlightsFile> {
    const path = join(dir, 'highlights.json')
    let f = this.files.get(path)
    if (!f) {
      f = jsonFile<HighlightsFile>(path, () => ({ version: 1, bookId, highlights: [] }), {
        afterWrite: async value => {
          const book = await this.resolveBook(value.bookId)
          await writeFileAtomic(join(dir, 'highlights.md'), renderHighlightsMarkdown(book, value.highlights))
        }
      })
      this.files.set(path, f)
    }
    return f
  }

  private async fileFor(bookId: string): Promise<JsonFile<HighlightsFile>> {
    const ref = await this.resolveBook(bookId)
    return this.fileAt(join(this.dataDir, 'books', ref.slug), bookId)
  }

  // The caller's bookId is authoritative: it also repairs files saved with an empty bookId by an earlier bug.
  private async mutate(bookId: string, fn: (d: HighlightsFile) => void): Promise<void> {
    const f = await this.fileFor(bookId)
    await f.update(d => {
      fn(d)
      if (!d.bookId) d.bookId = bookId
    })
  }

  async list(bookId: string): Promise<Highlight[]> {
    const f = await this.fileFor(bookId)
    return (await f.read()).highlights.filter(h => !h.deleted).sort((a, b) => a.position - b.position)
  }

  async add(bookId: string, input: NewHighlight): Promise<Highlight> {
    const exact = input.quote.exact
    if (!exact.trim()) throw new HighlightError('Highlight is empty')
    if (exact.length > LIMITS.exactMaxChars) throw new HighlightError('Highlight is too long')
    if (!HIGHLIGHT_COLORS.includes(input.color)) throw new HighlightError(`Unknown color: ${input.color}`)
    const ts = this.now().toISOString()
    const h: Highlight = {
      id: `h_${randomUUID()}`,
      location: input.location,
      quote: {
        exact,
        prefix: input.quote.prefix.slice(-LIMITS.quoteAffixChars),
        suffix: input.quote.suffix.slice(0, LIMITS.quoteAffixChars)
      },
      context: input.context.slice(0, LIMITS.contextChars),
      chapter: input.chapter,
      position: Math.min(1, Math.max(0, input.position || 0)),
      color: input.color,
      note: input.note?.trim() || null,
      createdAt: ts,
      updatedAt: ts,
      deleted: false
    }
    await this.mutate(bookId, d => {
      d.highlights.push(h)
    })
    // the cached copy is mutated by later updates, so hand back a snapshot
    return { ...h, quote: { ...h.quote } }
  }

  async update(bookId: string, id: string, patch: HighlightPatch): Promise<Highlight> {
    if (patch.color && !HIGHLIGHT_COLORS.includes(patch.color)) throw new HighlightError(`Unknown color: ${patch.color}`)
    let result: Highlight | undefined
    await this.mutate(bookId, d => {
      const h = d.highlights.find(x => x.id === id && !x.deleted)
      if (!h) throw new HighlightError(`Highlight not found: ${id}`)
      if (patch.color) h.color = patch.color
      if (patch.note !== undefined) h.note = patch.note?.trim() || null
      if (patch.location) h.location = patch.location
      h.updatedAt = this.now().toISOString()
      result = { ...h }
    })
    return result!
  }

  async remove(bookId: string, id: string): Promise<void> {
    await this.mutate(bookId, d => {
      const h = d.highlights.find(x => x.id === id)
      if (!h) throw new HighlightError(`Highlight not found: ${id}`)
      h.deleted = true
      h.updatedAt = this.now().toISOString()
    })
  }

  async listAllBooks(): Promise<Array<{ bookId: string; highlights: Highlight[] }>> {
    const booksDir = join(this.dataDir, 'books')
    let dirs: string[]
    try {
      dirs = (await readdir(booksDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name)
    } catch {
      return []
    }
    const out: Array<{ bookId: string; highlights: Highlight[] }> = []
    for (const name of dirs) {
      // Never create a cached JsonFile here: without a caller bookId its fallback would be { bookId: '' }.
      const path = join(booksDir, name, 'highlights.json')
      const cached = this.files.get(path)
      const v = cached ? await cached.read() : await readJson<HighlightsFile | null>(path, () => null)
      if (!v) continue
      if (v.bookId && v.highlights.length) out.push({ bookId: v.bookId, highlights: v.highlights })
    }
    return out
  }
}
