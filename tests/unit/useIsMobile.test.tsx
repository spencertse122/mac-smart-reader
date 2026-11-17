// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useIsMobile, MOBILE_QUERY } from '../../src/renderer/src/components/useIsMobile'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let width = 1280
const listeners = new Set<() => void>()
// A matchMedia that understands the one query the hook uses, against a settable viewport width.
window.matchMedia = (query: string) => {
  const m = /\(max-width:\s*(\d+)px\)/.exec(query)
  return {
    get matches() { return m ? width <= Number(m[1]) : false },
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

it('uses the 760px breakpoint', () => {
  expect(MOBILE_QUERY).toBe('(max-width: 760px)')
})

it('is true on a 390px phone', () => {
  width = 390
  mount()
  expect(seen.at(-1)).toBe(true)
})

it('is false on a 1280px desktop window', () => {
  width = 1280
  mount()
  expect(seen.at(-1)).toBe(false)
})

it('follows viewport changes', () => {
  width = 1280
  mount()
  width = 390
  act(() => listeners.forEach(cb => cb()))
  expect(seen.at(-1)).toBe(true)
})
