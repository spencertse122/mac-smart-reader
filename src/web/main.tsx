import './shims/buffer'
import { createRoot } from 'react-dom/client'
import { createDriveClient, DriveAuthError } from './drive/client'
import { idbOutbox } from './sync/outbox'
import { idbBookCache } from './bookCache'
import { createWebApi } from './webApi'
import { App } from '../renderer/src/App'
import { AppStateProvider } from '../renderer/src/state/appState'
import '../renderer/src/styles/tokens.css'
import '../renderer/src/styles/global.css'

// Auth and the folder picker arrive with the Connect flow; until then there is no token and no folder.
const FOLDER_KEY = 'sr.web.folder'
type Folder = { id: string; name: string }
const savedFolder = (): Folder | null => {
  try {
    return JSON.parse(localStorage.getItem(FOLDER_KEY) ?? 'null') as Folder | null
  } catch {
    return null
  }
}

window.api = createWebApi({
  drive: createDriveClient({ fetch: (i, init) => fetch(i, init), getToken: () => { throw new DriveAuthError('Not signed in') } }),
  outbox: idbOutbox(),
  pickFolder: async () => null,
  savedFolder,
  rememberFolder: f => {
    try {
      localStorage.setItem(FOLDER_KEY, JSON.stringify(f))
    } catch {
      // storage unavailable
    }
  },
  cache: idbBookCache()
})

createRoot(document.getElementById('root')!).render(
  <AppStateProvider>
    <App />
  </AppStateProvider>
)
