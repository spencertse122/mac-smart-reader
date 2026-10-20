import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppStateProvider } from './state/appState'
import './styles/tokens.css'
import './styles/global.css'

// Dropping a file on the window would navigate to it; the main process blocks that too.
for (const type of ['dragover', 'drop'] as const) window.addEventListener(type, e => e.preventDefault())

if (navigator.userAgent.includes('Macintosh')) document.documentElement.classList.add('platform-mac')

createRoot(document.getElementById('root')!).render(
  <AppStateProvider>
    <App />
  </AppStateProvider>
)
