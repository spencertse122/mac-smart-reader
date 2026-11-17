import './shims/buffer'
import { createRoot } from 'react-dom/client'
import type { SmartReaderApi } from '../shared/api'
import { App } from '../renderer/src/App'
import { AppStateProvider } from '../renderer/src/state/appState'
import '../renderer/src/styles/tokens.css'
import '../renderer/src/styles/global.css'

// Placeholder so the shared renderer can mount; the real VFS-backed api replaces it.
const unsupported = (): never => {
  throw new Error('Not implemented on web yet')
}
const off = (): (() => void) => () => undefined
const stub = new Proxy({}, { get: () => unsupported }) as never
window.api = {
  platform: 'web',
  settings: stub,
  library: stub,
  highlights: stub,
  vocab: stub,
  review: stub,
  sessions: stub,
  stats: stub,
  pty: stub,
  on: { reviewChanged: off, libraryChanged: off, toast: off, menu: off }
} satisfies SmartReaderApi

createRoot(document.getElementById('root')!).render(
  <AppStateProvider>
    <App />
  </AppStateProvider>
)
