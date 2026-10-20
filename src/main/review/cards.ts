import type { Highlight, PromptLine, PromptType } from '../../shared/types'

function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

export function makeCloze(context: string, exact: string): string {
  const ex = exact.trim()
  const n = wordCount(ex)
  const blank = n > 40
    ? `${ex.split(/\s+/).slice(0, 6).join(' ')} ▁▁▁▁ (~${n - 6} more words)`
    : `▁▁▁▁ (~${n} word${n === 1 ? '' : 's'})`
  const i = context.indexOf(ex)
  if (i >= 0) return context.slice(0, i) + blank + context.slice(i + ex.length)
  const norm = (s: string): string => s.replace(/\s+/g, ' ')
  const nc = norm(context)
  const ne = norm(ex)
  const j = nc.indexOf(ne)
  if (j >= 0) return nc.slice(0, j) + blank + nc.slice(j + ne.length)
  return blank
}

export function buildPrompt(h: Highlight, ai?: PromptLine): { promptType: PromptType; prompt: string; aiAnswer: string | null } {
  if (ai) return { promptType: 'ai', prompt: ai.question, aiAnswer: ai.answer ?? null }
  const note = h.note?.trim()
  if (note && note.endsWith('?')) return { promptType: 'note', prompt: note, aiAnswer: null }
  return { promptType: 'cloze', prompt: makeCloze(h.context, h.quote.exact), aiAnswer: null }
}
