import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppStateProvider } from './state/appState'
import './styles/tokens.css'
import './styles/global.css'

if (navigator.userAgent.includes('Macintosh')) document.documentElement.classList.add('platform-mac')

createRoot(document.getElementById('root')!).render(
  <AppStateProvider>
    <App />
  </AppStateProvider>
)
