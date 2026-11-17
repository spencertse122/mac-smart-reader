// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useIsMobile, MOBILE_QUERY } from '../../src/renderer/src/components/useIsMobile'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let width = 1280
let height = 800
let coarse = false
const listeners = new Set<() => void>()
// A tiny media-query evaluator: comma-separated alternatives of `and`-joined max-width / max-height / pointer features.
const feature = (f: string): boolean => {
  const m = /\(\s*([a-z-]+)\s*:\s*([a-z0-9]+?)(px)?\s*\)/.exec(f.trim())
  if (!m) throw new Error(`unknown media feature ${f}`)
  const [, name, value] = m
  if (name === 'max-width') return width <= Number(value)
  if (name === 'max-height') return height <= Number(value)
  if (name === 'pointer') return (coarse ? 'coarse' : 'fine') === value
  throw new Error(`unknown media feature ${name}`)
}
const evaluate = (query: string): boolean => query.split(',').some(alt => alt.split(/\band\b/).every(feature))
const viewport = (w: number, h: number, touch: boolean): void => {
  width = w
  height = h
  coarse = touch
}
window.matchMedia = (query: string) => {
  return {
    get matches() { return evaluate(query) },
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: () => void) => void listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => void listeners.delete(cb),
    addListener: (cb: () => void) => void listeners.add(cb),
    removeListener: (cb: () => void) => void listeners.delete(cb),
    dispatchEvent: () => true
  } as unknown as MediaQueryList
}

let root: Root | null = null
let seen: boolean[] = []
function Probe() {
  seen.push(useIsMobile())
  return null
}
const mount = (): void => {
  seen = []
  root = createRoot(document.createElement('div'))
  act(() => root!.render(<Probe />))
}
afterEach(() => {
  act(() => root?.unmount())
  root = null
})

it('uses the 760px breakpoint plus short touch screens', () => {
  expect(MOBILE_QUERY).toBe('(max-width: 760px), (pointer: coarse) and (max-height: 500px)')
})

it('is true on a 390px phone', () => {
  viewport(390, 844, true)
  mount()
  expect(seen.at(-1)).toBe(true)
})

it('is true on a phone held sideways (844x390, touch)', () => {
  viewport(844, 390, true)
  mount()
  expect(seen.at(-1)).toBe(true)
})

it('is false on a 1280px desktop window', () => {
  viewport(1280, 800, false)
  mount()
  expect(seen.at(-1)).toBe(false)
})

it('is false on a short but wide mouse-driven window (the Mac at its minimum size)', () => {
  viewport(900, 480, false)
  mount()
  expect(seen.at(-1)).toBe(false)
})

it('is false on a touch tablet in landscape (1180x820)', () => {
  viewport(1180, 820, true)
  mount()
  expect(seen.at(-1)).toBe(false)
})

it('follows viewport changes, e.g. rotating a phone', () => {
  viewport(1280, 800, false)
  mount()
  viewport(390, 844, true)
  act(() => listeners.forEach(cb => cb()))
  expect(seen.at(-1)).toBe(true)
  viewport(844, 390, true)
  act(() => listeners.forEach(cb => cb()))
  expect(seen.at(-1)).toBe(true)
})
