import { it, expect } from 'vitest'
import { formatRate, scaleLinear } from '../../src/renderer/src/stats/format'

it('formats knowledge rate', () => {
  expect(formatRate(null)).toBe('—')
  expect(formatRate(2.345)).toBe('2.3 / hr')
  expect(formatRate(-0.5)).toBe('−0.5 / hr')
})

it('linear scale maps and handles flat domains', () => {
  const s = scaleLinear([0, 10], [100, 0])
  expect(s(0)).toBe(100)
  expect(s(5)).toBe(50)
  expect(scaleLinear([3, 3], [0, 10])(3)).toBe(5)
})
