import { it, expect } from 'vitest'
import { readerCss, READER_THEMES } from '../../src/renderer/src/reader/readerStyles'

it('emits theme colors, font, size and line height', () => {
  const css = readerCss({ readerTheme: 'sepia', fontFamily: 'serif', fontSize: 20, lineHeight: 1.6 })
  expect(css).toContain(READER_THEMES.sepia.bg)
  expect(css).toContain(READER_THEMES.sepia.fg)
  expect(css).toContain('font-size: 20px')
  expect(css).toContain('line-height: 1.6')
  expect(css).toContain('New York')
  expect(readerCss({ readerTheme: 'night', fontFamily: 'sans', fontSize: 18, lineHeight: 1.5 })).toContain('color-scheme: dark')
})

it('cancels forced page breaks at the start and end of a section', () => {
  const css = readerCss({ readerTheme: 'white', fontFamily: 'serif', fontSize: 18, lineHeight: 1.5 })
  expect(css).toMatch(/body > :first-child[^{]*\{\s*break-before: auto !important; page-break-before: auto !important;/)
  expect(css).toMatch(/body > :last-child[^{]*\{\s*break-after: auto !important; page-break-after: auto !important;/)
})
