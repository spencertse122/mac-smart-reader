import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { SmartReaderApi } from '../shared/api'
import { IPC } from '../shared/ipc'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}

const api: SmartReaderApi = {
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: patch => invoke(IPC.settingsUpdate, patch)
  },
  library: {
    chooseFolder: () => invoke(IPC.libraryChooseFolder),
    open: root => invoke(IPC.libraryOpen, root),
    current: () => invoke(IPC.libraryCurrent),
    list: () => invoke(IPC.libraryList),
    rescan: () => invoke(IPC.libraryRescan),
    readBook: id => invoke(IPC.libraryReadBook, id),
    getCover: id => invoke(IPC.libraryGetCover, id),
    saveMetadata: (id, meta) => invoke(IPC.librarySaveMetadata, id, meta),
    saveProgress: (id, location, progress) => invoke(IPC.librarySaveProgress, id, location, progress),
    markOpened: id => invoke(IPC.libraryMarkOpened, id),
    setStatus: (id, status, reason) => invoke(IPC.librarySetStatus, id, status, reason)
  },
  highlights: {
    list: bookId => invoke(IPC.highlightsList, bookId),
    add: (bookId, h) => invoke(IPC.highlightsAdd, bookId, h),
    addNote: (bookId, n) => invoke(IPC.highlightsAddNote, bookId, n),
    update: (bookId, id, patch) => invoke(IPC.highlightsUpdate, bookId, id, patch),
    remove: (bookId, id) => invoke(IPC.highlightsRemove, bookId, id)
  },
  vocab: {
    lookup: term => invoke(IPC.vocabLookup, term),
    save: input => invoke(IPC.vocabSave, input),
    list: () => invoke(IPC.vocabList),
    remove: id => invoke(IPC.vocabRemove, id)
  },
  review: {
    queue: () => invoke(IPC.reviewQueue),
    rate: (highlightId, rating, durationMs, promptType) =>
      invoke(IPC.reviewRate, highlightId, rating, durationMs, promptType),
    dueCount: () => invoke(IPC.reviewDueCount),
    promptIssues: () => invoke(IPC.reviewPromptIssues)
  },
  sessions: { log: entry => invoke(IPC.sessionsLog, entry) },
  stats: { get: () => invoke(IPC.statsGet) },
  pty: {
    create: (cols, rows) => invoke(IPC.ptyCreate, cols, rows),
    write: (id, data) => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: id => ipcRenderer.send(IPC.ptyKill, id),
    onData: cb => listen(IPC.ptyData, cb),
    onExit: cb => listen(IPC.ptyExit, cb)
  },
  on: {
    reviewChanged: cb => listen(IPC.eventReviewChanged, cb),
    libraryChanged: cb => listen(IPC.eventLibraryChanged, cb),
    toast: cb => listen(IPC.eventToast, cb),
    menu: cb => listen(IPC.eventMenu, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
