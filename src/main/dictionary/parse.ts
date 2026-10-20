import type { DictEntry } from '../../shared/types'

const SECTION = /\s(?:ORIGIN|DERIVATIVES|PHRASES|PHRASAL VERBS)\s/

// Turns the macOS Dictionary's flat plain text into a DictEntry. Never throws; unknown shapes fall back to text = raw.
export function parseDefinition(raw: string, queried = ''): DictEntry {
  try {
    const flat = raw.replace(/\s+/g, ' ').trim()
    if (!flat) return { headword: queried, pronunciation: null, text: '', raw }
    const headword = flat.split(' ')[0] || queried
    let pronunciation: string | null = null
    let body = flat
    const i = flat.indexOf(' | ')
    const j = i < 0 ? -1 : flat.indexOf(' | ', i + 3)
    if (i >= 0 && j > i && j - i < 120) {
      pronunciation = flat.slice(i + 3, j).trim() || null
      body = flat.slice(j + 3)
    } else if (i >= 0 && i < 80) {
      // single pipe: head line ends there, nothing to treat as pronunciation
      body = flat.slice(i + 3)
    } else {
      const sp = flat.indexOf(' ')
      body = sp < 0 ? '' : flat.slice(sp + 1)
    }
    const cut = body.search(SECTION)
    if (cut >= 0) body = body.slice(0, cut)
    body = body.trim()
    if (!body) return { headword, pronunciation, text: flat, raw }
    const text = body
      .replace(/ • /g, '\n• ')
      .replace(/(?<=[.!?”"')]) (?=(?:[2-9]|1\d) [a-z(\[])/g, '\n')
      .replace(/(?<=\.) (?=(?:noun|verb|adjective|adverb|exclamation|pronoun|preposition|conjunction|determiner|abbreviation|prefix|suffix) )/g, '\n')
    return { headword, pronunciation, text, raw }
  } catch {
    return { headword: queried, pronunciation: null, text: raw, raw }
  }
}
