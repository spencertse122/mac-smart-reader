import type { Book } from '../../../shared/types'
import { formatContributor, formatLanguageMap } from '../reader/foliate'

export function normalizeMetadata(meta: { title?: unknown; author?: unknown } | undefined, fallbackTitle: string): { title: string; author: string } {
  const title = formatLanguageMap(meta?.title).trim() || fallbackTitle
  const author = formatContributor(meta?.author).trim()
  return { title, author }
}

export function coverHue(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 360
}

export function filterAndSort(books: Book[], query: string, sort: 'recent' | 'title' | 'author'): Book[] {
  const q = query.trim().toLowerCase()
  const list = q ? books.filter(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)) : [...books]
  const byTitle = (a: Book, b: Book): number => a.title.localeCompare(b.title)
  if (sort === 'title') return list.sort(byTitle)
  if (sort === 'author') return list.sort((a, b) => (a.author || '￿').localeCompare(b.author || '￿') || byTitle(a, b))
  return list.sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? '') || byTitle(a, b))
}

/** The most recently opened book that can still be opened (the "Continue Reading" target). */
export function latestOpenedBook(books: Book[]): Book | null {
  let best: Book | null = null
  for (const b of books) {
    if (!b.lastOpenedAt || b.missing || b.status !== 'ok') continue
    if (!best || b.lastOpenedAt > (best.lastOpenedAt as string)) best = b
  }
  return best
}
