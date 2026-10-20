export const SENTENCE_MAX = 300

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

// Is the selection something a dictionary can answer: 1-64 chars, at most 4 words.
export function lookupTerm(selected: string): string | null {
  const t = collapse(selected)
  if (t.length < 1 || t.length > 64) return null
  if (t.split(' ').length > 4) return null
  return t
}

const ENDERS = /[.!?…]/
const CLOSERS = /["'”’)\]]/

// The sentence of `context` that contains `selected`, capped at `max` chars. Falls back to a window of the context.
export function sentenceAround(context: string, selected: string, max: number = SENTENCE_MAX): string {
  const text = collapse(context)
  const sel = collapse(selected)
  if (!text) return sel.slice(0, max)
  let i = sel ? text.toLowerCase().indexOf(sel.toLowerCase()) : -1
  if (i < 0) return text.length <= max ? text : text.slice(0, max).trimEnd()
  let start = 0
  for (let k = i - 1; k > 0; k--) {
    if (text[k] === ' ') {
      let j = k - 1
      while (j >= 0 && CLOSERS.test(text[j])) j--
      if (j >= 0 && ENDERS.test(text[j])) { start = k + 1; break }
    }
  }
  const from = i + sel.length
  let end = text.length
  for (let k = from; k < text.length; k++) {
    if (ENDERS.test(text[k])) {
      let j = k + 1
      while (j < text.length && CLOSERS.test(text[j])) j++
      if (j >= text.length || text[j] === ' ') { end = j; break }
    }
  }
  i -= start
  let s = text.slice(start, end)
  if (s.length > max) {
    const pad = Math.max(0, Math.floor((max - sel.length) / 2))
    const a = Math.max(0, Math.min(i - pad, s.length - max))
    s = s.slice(a, a + max)
  }
  return s.trim()
}

export interface Segment { text: string; hit: boolean }

const SUFFIXES = ['ing', 'ed', 'es', 's', 'e', 'y']
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function stem(term: string): string {
  const t = term.toLowerCase().trim()
  for (const suf of SUFFIXES) if (t.endsWith(suf) && t.length - suf.length >= 4) return t.slice(0, -suf.length)
  return t
}

// Splits a sentence into plain and emphasised parts; a word matches when it starts with the stem of any term.
export function emphasize(sentence: string, terms: Array<string | null | undefined>): Segment[] {
  const stems = [...new Set(terms.map(t => (t ? stem(collapse(t)) : '')).filter(s => s.length >= 2))]
  if (!stems.length || !sentence) return [{ text: sentence, hit: false }]
  const alt = stems.map(s => escapeRe(s).replace(/ /g, '\\s+')).join('|')
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})[\\p{L}\\p{N}]*`, 'giu')
  const out: Segment[] = []
  let last = 0
  for (const m of sentence.matchAll(re)) {
    if (m.index > last) out.push({ text: sentence.slice(last, m.index), hit: false })
    out.push({ text: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last < sentence.length) out.push({ text: sentence.slice(last), hit: false })
  return out
}
