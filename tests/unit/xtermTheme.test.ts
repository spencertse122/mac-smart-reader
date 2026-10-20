import { it, expect } from 'vitest'
import { xtermTheme, WELCOME_LINE } from '../../src/renderer/src/terminal/xtermTheme'

it('provides distinct light and dark themes and a welcome hint', () => {
  expect(xtermTheme(true).background).not.toBe(xtermTheme(false).background)
  expect(xtermTheme(false).foreground).toBeTruthy()
  expect(WELCOME_LINE).toContain('claude')
  expect(WELCOME_LINE).toContain('codex')
  expect(WELCOME_LINE).toContain('gemini')
})
