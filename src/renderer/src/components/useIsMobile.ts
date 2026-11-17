import { useSyncExternalStore } from 'react'

export const MOBILE_QUERY = '(max-width: 760px)'

// The Mac window is at least 900px wide, so this only ever matches in a phone browser.
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
