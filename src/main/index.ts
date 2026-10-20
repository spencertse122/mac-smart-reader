import { app, BrowserWindow, Menu, net, protocol, shell } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '../shared/ipc'
import { SettingsStore } from './settings'
import { PtyService } from './pty/ptyService'
import { registerIpc, type IpcHandle } from './ipc'
import { buildMenu } from './menu'
import { DictionaryService } from './dictionary/dictionaryService'
import { setRecoveryListener } from './store/atomic'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])
if (process.env.SR_USER_DATA) app.setPath('userData', process.env.SR_USER_DATA)

const RENDERER_DIR = join(__dirname, '../renderer')
const APP_URL = process.env.ELECTRON_RENDERER_URL ?? 'app://bundle/index.html'

// Only the app's own pages may load in the window: a dropped file or a stray link would otherwise
// replace the UI, and a dropped .html would run with the preload's window.api.
function isAppUrl(url: string): boolean {
  if (url.startsWith('app://bundle/')) return true
  const dev = process.env.ELECTRON_RENDERER_URL
  return !!dev && url.startsWith(new URL('/', dev).href)
}
const CSP = [
  "default-src 'self' app: blob: data:",
  // no blob: here: foliate turns an EPUB's <script src> into a blob: URL in a same-origin iframe
  "script-src 'self' app:",
  "style-src 'self' 'unsafe-inline' app: blob:",
  "img-src 'self' app: blob: data:",
  "font-src 'self' app: blob: data:",
  "worker-src 'self' app: blob:",
  "connect-src 'self' app: blob: data:"
].join('; ')

function registerAppProtocol(): void {
  protocol.handle('app', async request => {
    const { pathname } = new URL(request.url)
    const filePath = normalize(join(RENDERER_DIR, decodeURIComponent(pathname)))
    if (!filePath.startsWith(RENDERER_DIR + sep)) return new Response('Forbidden', { status: 403 })
    const res = await net.fetch(pathToFileURL(filePath).toString())
    const headers = new Headers(res.headers)
    if (/\.html?$/.test(filePath)) headers.set('Content-Security-Policy', CSP)
    if (/\.m?js$/.test(filePath)) headers.set('Content-Type', 'text/javascript')
    return new Response(res.body, { status: res.status, headers })
  })
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Smart Reader',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
  void win.loadURL(APP_URL)
  return win
}

let mainWindow: BrowserWindow | null = null

function templateDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'workspace-template') : join(app.getAppPath(), 'resources', 'workspace-template')
}

function dictHelperPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'bin', 'dict-lookup') : join(app.getAppPath(), 'resources', 'bin', 'dict-lookup')
}

let ipcHandle: IpcHandle | null = null
let draining = false

async function bootstrap(): Promise<void> {
  registerAppProtocol()
  const send = (channel: string, ...args: unknown[]): void => mainWindow?.webContents.send(channel, ...args)
  const settings = new SettingsStore(app.getPath('userData'))
  const pty = new PtyService(send)
  const setMenu = (recent: string[]): void => Menu.setApplicationMenu(buildMenu(a => send(IPC.eventMenu, a), recent))
  const ipc = (ipcHandle = registerIpc({
    getWindow: () => mainWindow,
    settings,
    templateDir: templateDir(),
    pty,
    dictionary: new DictionaryService({ helperPath: dictHelperPath() }),
    onSettingsChanged: s => setMenu(s.recentLibraries)
  }))
  setRecoveryListener(e =>
    send(IPC.eventToast, {
      kind: 'warning',
      message: e.restoredFromBackup
        ? `A data file was damaged and restored from backup (${e.path}).`
        : `A data file was damaged and reset (${e.path}). The damaged copy was kept.`
    })
  )
  setMenu((await settings.get()).recentLibraries)
  mainWindow = createMainWindow()
  const wc = mainWindow.webContents
  const releasePtys = (): void => pty.killOwnedBy(wc.id)
  // did-navigate fires when a main-frame navigation (e.g. ⌘R) commits, never for one will-navigate blocked
  wc.on('did-navigate', releasePtys)
  wc.on('render-process-gone', releasePtys)
  wc.on('destroyed', releasePtys)
  mainWindow.on('closed', () => {
    ipc.closeAll()
    mainWindow = null
  })
}

// One instance per data dir (the lock lives in userData, set above): two writers would race on .smartreader/.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.whenReady().then(bootstrap)
}

app.on('window-all-closed', () => app.quit())

// Let writes the closing window just requested (its last reading position) finish before exiting.
app.on('will-quit', e => {
  if (draining || !ipcHandle?.busy()) return
  e.preventDefault()
  draining = true
  void ipcHandle.drain().finally(() => app.quit())
})
