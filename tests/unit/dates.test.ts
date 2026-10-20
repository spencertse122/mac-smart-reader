import { it, expect } from 'vitest'
import { localDay, addDays } from '../../src/shared/dates'

it('formats local day and adds days across month end', () => {
  const d = new Date(2026, 9, 31, 23, 30)
  expect(localDay(d)).toBe('2026-10-31')
  expect(localDay(addDays(d, 1))).toBe('2026-11-01')
})
