import type { Highlight, PromptLine, PromptType } from '../../shared/types'

export function buildPrompt(h: Highlight, ai?: PromptLine): { promptType: PromptType; prompt: string; aiAnswer: string | null } {
  if (ai) return { promptType: 'ai', prompt: ai.question, aiAnswer: ai.answer ?? null }
  if (h.kind === 'note') return { promptType: 'note', prompt: (h.note ?? '').trim(), aiAnswer: null }
  return { promptType: 'highlight', prompt: h.quote.exact, aiAnswer: null }
}

// What a card reveals as its source: the quote (plus the highlight's own note), or the note text itself.
export function cardSource(h: Highlight): { answer: string; note: string | null } {
  if (h.kind === 'note') return { answer: (h.note ?? '').trim(), note: null }
  return { answer: h.quote.exact, note: h.note }
}
