import './shims/buffer'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createDriveClient, DriveAuthError } from './drive/client'
import { idbOutbox } from './sync/outbox'
import { idbBookCache } from './bookCache'
import { createWebApi } from './webApi'
import { createAuth } from './auth/gis'
import { onFolderRequest, requestFolder, type PickedFolder } from './ui/folderBus'
import { SignIn } from './ui/SignIn'
import { FolderPicker } from './ui/FolderPicker'
import { ReconnectBanner } from './ui/ReconnectBanner'
import { WebMenu } from './ui/WebMenu'
import { App } from '../renderer/src/App'
import { AppStateProvider } from '../renderer/src/state/appState'
import '../renderer/src/styles/tokens.css'
import '../renderer/src/styles/global.css'
import './ui/web.css'

const FOLDER_KEY = 'sr.web.folder'
const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
const savedFolder = (): PickedFolder | null => {
  try {
    return JSON.parse(localStorage.getItem(FOLDER_KEY) ?? 'null') as PickedFolder | null
  } catch {
    return null
  }
}

const auth = createAuth(clientId)
const cache = idbBookCache()
const rawDrive = createDriveClient({
  fetch: (i, init) => fetch(i, init),
  getToken: () => {
    const t = auth.token()
    // Throwing pauses sync and raises the reconnect banner instead of sending a doomed request.
    if (!t) throw new DriveAuthError('Not signed in')
    return t
  }
})
const progress = new Set<(loaded: number, total: number) => void>()
const drive: typeof rawDrive = {
  ...rawDrive,
  download: (id, range, onProgress) =>
    rawDrive.download(id, range, (l, t) => {
      onProgress?.(l, t)
      for (const cb of [...progress]) cb(l, t)
    })
}

const api = createWebApi({
  drive,
  outboxFor: id => idbOutbox(`sr.outbox.${id}`),
  pickFolder: requestFolder,
  savedFolder,
  rememberFolder: f => {
    try {
      localStorage.setItem(FOLDER_KEY, JSON.stringify(f))
    } catch {
      // storage unavailable
    }
  },
  cache,
  downloadProgress: cb => (progress.add(cb), () => void progress.delete(cb))
})
window.api = api

async function signOut(): Promise<void> {
  // The outbox is kept on purpose: unsynced edits replay when the same folder is mounted again.
  try {
    localStorage.removeItem(FOLDER_KEY)
  } catch {
    // storage unavailable
  }
  await cache.clear().catch(() => undefined)
  api.dispose()
  auth.signOut()
}

function WebRoot() {
  const [signedIn, setSignedIn] = useState(() => auth.token() !== null)
  const [pick, setPick] = useState<((f: PickedFolder | null) => void) | null>(null)
  useEffect(() => auth.onChange(() => auth.token() && setSignedIn(true)), [])
  useEffect(() => onFolderRequest(resolve => setPick(() => resolve)), [])
  if (!signedIn) return <SignIn auth={auth} clientId={clientId} />
  return (
    <AppStateProvider>
      <App />
      <ReconnectBanner api={api} auth={auth} />
      <WebMenu api={api} onSignOut={() => void signOut().then(() => location.reload())} />
      {pick && (
        <FolderPicker
          drive={drive}
          onDone={f => {
            pick(f)
            setPick(null)
          }}
        />
      )}
    </AppStateProvider>
  )
}

createRoot(document.getElementById('root')!).render(<WebRoot />)
