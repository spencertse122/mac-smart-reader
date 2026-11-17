import { useSyncExternalStore } from 'react'

// Narrow screens, plus phones held sideways (touch, short). The Mac window is at least 900px wide and has a
// fine pointer, so this only ever matches in a phone browser. mobile.css uses the same query.
export const MOBILE_QUERY = '(max-width: 760px), (pointer: coarse) and (max-height: 500px)'

const media = (): MediaQueryList | null => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null)

function subscribe(cb: () => void): () => void {
  const m = media()
  if (!m) return () => undefined
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false)
}
