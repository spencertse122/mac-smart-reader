import { unwatchFile, watchFile } from 'node:fs'
import type { PromptLine } from '../../shared/types'
import { readJsonl } from '../store/jsonl'

export function parsePromptLines(items: unknown[]): { prompts: Map<string, PromptLine>; invalid: number } {
  const prompts = new Map<string, PromptLine>()
  let invalid = 0
  for (const it of items) {
    const o = it as Partial<PromptLine>
    if (typeof o.highlightId !== 'string' || typeof o.question !== 'string' || !o.question.trim()) {
      invalid++
      continue
    }
    const line: PromptLine = { highlightId: o.highlightId, question: o.question.trim() }
    if (typeof o.answer === 'string' && o.answer.trim()) line.answer = o.answer.trim()
    if (typeof o.createdAt === 'string') line.createdAt = o.createdAt
    if (typeof o.by === 'string') line.by = o.by
    prompts.set(o.highlightId, line)
  }
  return { prompts, invalid }
}

// Polls with fs.watchFile so it survives agents replacing the file via rename.
export class PromptWatcher {
  private prompts = new Map<string, PromptLine>()
  private invalid = 0
  private watching = false

  constructor(private file: string, private onChange: () => void = () => {}) {}

  get invalidLines(): number {
    return this.invalid
  }

  async load(): Promise<void> {
    const { items, skipped } = await readJsonl<unknown>(this.file)
    const r = parsePromptLines(items)
    this.prompts = r.prompts
    this.invalid = skipped + r.invalid
  }

  start(intervalMs = 1000): void {
    if (this.watching) return
    this.watching = true
    watchFile(this.file, { interval: intervalMs }, (cur, prev) => {
      if (cur.mtimeMs !== prev.mtimeMs || cur.size !== prev.size || cur.ino !== prev.ino) {
        void this.load().then(() => this.onChange(), () => undefined)
      }
    })
  }

  stop(): void {
    if (!this.watching) return
    unwatchFile(this.file)
    this.watching = false
  }

  get(highlightId: string): PromptLine | undefined {
    return this.prompts.get(highlightId)
  }

  ids(): string[] {
    return [...this.prompts.keys()]
  }
}
