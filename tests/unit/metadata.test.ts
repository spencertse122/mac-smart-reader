import { it, expect } from 'vitest'
import { normalizeMetadata, coverHue, filterAndSort } from '../../src/renderer/src/library/metadata'
import type { Book } from '../../src/shared/types'

it('normalizes foliate metadata shapes', () => {
  expect(normalizeMetadata({ title: 'Deep Work', author: 'Cal Newport' }, 'file')).toEqual({ title: 'Deep Work', author: 'Cal Newport' })
  expect(normalizeMetadata({ title: { en: 'Map Title' }, author: [{ name: 'A' }, { name: { en: 'B' } }] }, 'file')).toEqual({ title: 'Map Title', author: 'A, B' })
  expect(normalizeMetadata({ title: '  ', author: undefined }, 'Fallback')).toEqual({ title: 'Fallback', author: '' })
  expect(normalizeMetadata(undefined, 'Fallback')).toEqual({ title: 'Fallback', author: '' })
})

it('cover hue is stable and in range', () => {
  expect(coverHue('abc')).toBe(coverHue('abc'))
  expect(coverHue('abc')).toBeGreaterThanOrEqual(0)
  expect(coverHue('abc')).toBeLessThan(360)
})

const book = (id: string, title: string, author: string, lastOpenedAt: string | null): Book => ({
  id, slug: id, path: `${id}.epub`, format: 'epub', title, author, addedAt: '', lastOpenedAt, location: null,
  progress: 0, status: 'ok', statusReason: null, fileSize: 1, mtimeMs: 1, metadataExtracted: true, hasCover: false, missing: false
})

it('filters by title/author and sorts', () => {
  const books = [book('1', 'Zen', 'Bob', null), book('2', 'Atomic Habits', 'James Clear', '2026-10-19'), book('3', 'Deep Work', 'Cal', '2026-10-20')]
  expect(filterAndSort(books, 'clear', 'title').map(b => b.id)).toEqual(['2'])
  expect(filterAndSort(books, '', 'title').map(b => b.id)).toEqual(['2', '3', '1'])
  expect(filterAndSort(books, '', 'recent').map(b => b.id)).toEqual(['3', '2', '1'])
  expect(filterAndSort(books, '', 'author').map(b => b.id)).toEqual(['1', '3', '2'])
})
