import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { VOCAB_MAX_CONTEXTS, VOCAB_SENTENCE_MAX, type NewVocab, type VocabContext, type VocabFile, type VocabWord, type ZhResult } from '../../shared/types'
import { jsonFile, type JsonFile } from '../store/jsonFile'
import { writeFileAtomic } from '../store/atomic'
import { renderVocabMarkdown } from './markdown'

export class VocabError extends Error {}

export class VocabStore {
  private file: JsonFile<VocabFile>
  private backfilling = false
  private titles = new Map<string, string>()

  constructor(
    private dataDir: string,
    private bookTitle: (bookId: string) => Promise<string>,
    private now: () => Date = () => new Date()
  ) {
    this.file = jsonFile<VocabFile>(join(dataDir, 'vocab.json'), () => ({ version: 1, words: [] }), {
      afterWrite: async v => {
        for (const w of v.words) {
          for (const c of w.contexts) {
            if (!this.titles.has(c.bookId)) this.titles.set(c.bookId, await this.bookTitle(c.bookId).catch(() => 'Unknown book'))
          }
        }
        await writeFileAtomic(join(dataDir, 'vocab.md'), renderVocabMarkdown(v.words, id => this.titles.get(id) ?? 'Unknown book'))
      }
    })
  }

  async save(input: NewVocab): Promise<VocabWord> {
    const headword = input.headword.trim()
    if (!headword) throw new VocabError('Word is empty')
    const ts = this.now().toISOString()
    const ctx: VocabContext = {
      bookId: input.context.bookId,
      sentence: input.context.sentence.replace(/\s+/g, ' ').trim().slice(0, VOCAB_SENTENCE_MAX),
      location: input.context.location,
      chapter: input.context.chapter,
      at: ts
    }
    let result: VocabWord | undefined
    await this.file.update(d => {
      const key = headword.toLowerCase()
      let w = d.words.find(x => x.headword.toLowerCase() === key)
      if (!w) {
        w = {
          id: `w_${randomUUID()}`,
          headword,
          pronunciation: input.pronunciation,
          definition: input.definition,
          ...(input.zh !== undefined ? { zh: input.zh } : {}),
          ...(input.zhEntry !== undefined ? { zhEntry: input.zhEntry } : {}),
          contexts: [],
          createdAt: ts,
          updatedAt: ts,
          deleted: false
        }
        d.words.push(w)
      } else {
        if (w.deleted) w.deleted = false
        w.pronunciation = input.pronunciation ?? w.pronunciation
        w.definition = input.definition || w.definition
        w.updatedAt = ts
        if (input.zh !== undefined && (input.zh !== null || w.zh == null)) w.zh = input.zh
        if (input.zhEntry !== undefined && (input.zhEntry !== null || w.zhEntry == null)) w.zhEntry = input.zhEntry
      }
      if (ctx.bookId && !w.contexts.some(c => c.sentence === ctx.sentence)) {
        w.contexts.push(ctx)
        if (w.contexts.length > VOCAB_MAX_CONTEXTS) w.contexts = w.contexts.slice(-VOCAB_MAX_CONTEXTS)
      }
      result = { ...w, contexts: w.contexts.map(c => ({ ...c })) }
    })
    return result!
  }

  async list(): Promise<VocabWord[]> {
    return (await this.file.read()).words.filter(w => !w.deleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async remove(id: string): Promise<void> {
    await this.file.update(d => {
      const w = d.words.find(x => x.id === id)
      if (!w) throw new VocabError(`Word not found: ${id}`)
      w.deleted = true
      w.updatedAt = this.now().toISOString()
    })
  }

  // All words including deleted ones, so ReviewService can suspend cards of removed words.
  async listAll(): Promise<VocabWord[]> {
    return (await this.file.read()).words
  }

  // Fills in the Chinese gloss for words never looked up (zh === undefined). Sequential; stops at the first
  // 'unavailable' so a later run retries. Returns whether anything changed. Never runs twice at once.
  async backfillZh(lookup: (term: string) => Promise<ZhResult>): Promise<boolean> {
    if (this.backfilling) return false
    this.backfilling = true
    let changed = false
    try {
      const todo = (await this.file.read()).words.filter(w => !w.deleted && w.zh === undefined).map(w => ({ id: w.id, headword: w.headword }))
      for (const t of todo) {
        const r = await lookup(t.headword)
        if (r.status === 'unavailable') break
        await this.file.update(d => {
          const w = d.words.find(x => x.id === t.id)
          if (!w || w.zh !== undefined) return
          if (r.status === 'ok') {
            w.zh = r.gloss
            w.zhEntry = r.entry
          } else {
            w.zh = null
            w.zhEntry = null
          }
          changed = true
        })
      }
    } finally {
      this.backfilling = false
    }
    return changed
  }
}
