import { BrowserWindow, dialog, ipcMain } from 'electron'
import { homedir } from 'node:os'
import { IPC } from '../shared/ipc'
import type { OpenLibraryResult } from '../shared/api'
import type { Settings } from '../shared/types'
import { Workspace } from './workspace'
import type { SettingsStore } from './settings'
import type { PtyService } from './pty/ptyService'
import type { DictionaryService } from './dictionary/dictionaryService'

export interface IpcContext {
  getWindow: () => BrowserWindow | null
  settings: SettingsStore
  templateDir: string
  pty: PtyService
  dictionary: DictionaryService
  onSettingsChanged: (s: Settings) => void
}

export interface IpcHandle {
  current(): Workspace | null
  closeAll(): void
  busy(): boolean
  drain(): Promise<void>
}

export function registerIpc(ctx: IpcContext): IpcHandle {
  let ws: Workspace | null = null
  const send = (channel: string, ...args: unknown[]): void => ctx.getWindow()?.webContents.send(channel, ...args)
  const need = (): Workspace => {
    if (!ws) throw new Error('No library is open')
    return ws
  }
  const reviewChanged = (): void => send(IPC.eventReviewChanged)
  // Fill in Chinese glosses for saved words in the background; never rejects.
  const backfillZh = (): void => {
    const w = ws
    if (!w) return
    void w.vocab
      .backfillZh(t => ctx.dictionary.lookupZh(t))
      .then(changed => {
        if (changed && ws === w) reviewChanged()
      })
      .catch(() => undefined)
  }
  // Calls still running (e.g. the reader's last saveProgress sent while the window closes); quit waits for them.
  const inflight = new Set<Promise<unknown>>()
  const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (_e, ...args) => {
      const p = Promise.resolve().then(() => fn(...args))
      inflight.add(p)
      void p.catch(() => undefined).finally(() => inflight.delete(p))
      return p
    })
  }

  handle(IPC.settingsGet, () => ctx.settings.get())
  handle(IPC.settingsUpdate, async (patch: Partial<Settings>) => {
    const s = await ctx.settings.update(patch)
    ctx.onSettingsChanged(s)
    return s
  })

  handle(IPC.libraryChooseFolder, async () => {
    const win = ctx.getWindow()
    const opts = { title: 'Choose your books folder', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  handle(IPC.libraryOpen, async (root: string): Promise<OpenLibraryResult> => {
    try {
      const next = await Workspace.open(root, {
        templateDir: ctx.templateDir,
        newCardsPerDay: async () => (await ctx.settings.get()).newCardsPerDay,
        onReviewChanged: reviewChanged
      })
      ws?.close()
      ctx.pty.killAll()
      ws = next
      backfillZh()
      ctx.onSettingsChanged(await ctx.settings.rememberLibrary(root))
      return { ok: true, root, books: await ws.library.list() }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  handle(IPC.libraryCurrent, () => ws?.root ?? null)
  handle(IPC.libraryList, () => need().library.list())
  handle(IPC.libraryRescan, () => need().library.scan())
  handle(IPC.libraryReadBook, (id: string) => need().library.readBook(id))
  handle(IPC.libraryGetCover, (id: string) => need().library.getCover(id))
  handle(IPC.librarySaveMetadata, async (id: string, meta: { title: string; author: string; cover: Uint8Array | null }) => {
    const b = await need().library.saveMetadata(id, meta)
    send(IPC.eventLibraryChanged)
    return b
  })
  handle(IPC.librarySaveProgress, (id: string, loc: string, p: number) => need().library.saveProgress(id, loc, p))
  handle(IPC.libraryMarkOpened, (id: string) => need().library.markOpened(id))
  handle(IPC.librarySetStatus, async (id: string, status, reason) => {
    await need().library.setStatus(id, status, reason)
    send(IPC.eventLibraryChanged)
  })

  handle(IPC.highlightsList, (bookId: string) => need().highlights.list(bookId))
  handle(IPC.highlightsAdd, async (bookId: string, h) => {
    const r = await need().highlights.add(bookId, h)
    reviewChanged()
    return r
  })
  handle(IPC.highlightsAddNote, async (bookId: string, n) => {
    const r = await need().highlights.addNote(bookId, n)
    reviewChanged()
    return r
  })
  handle(IPC.highlightsUpdate, async (bookId: string, id: string, patch) => {
    const r = await need().highlights.update(bookId, id, patch)
    reviewChanged()
    return r
  })
  handle(IPC.highlightsRemove, async (bookId: string, id: string) => {
    await need().highlights.remove(bookId, id)
    reviewChanged()
  })

  handle(IPC.vocabLookup, async (term: string) => {
    const r = await ctx.dictionary.lookup(String(term ?? ''))
    if (r.ok && r.zh.status === 'ok') backfillZh()
    return r
  })
  handle(IPC.vocabSave, async input => {
    const r = await need().vocab.save(input)
    reviewChanged()
    return r
  })
  handle(IPC.vocabList, () => need().vocab.list())
  handle(IPC.vocabRemove, async (id: string) => {
    await need().vocab.remove(id)
    reviewChanged()
  })

  handle(IPC.reviewQueue, () => need().review.queue())
  handle(IPC.reviewRate, async (id: string, rating, ms: number, type) => {
    const r = await need().review.rate(id, rating, ms, type)
    reviewChanged()
    return r
  })
  handle(IPC.reviewDueCount, () => (ws ? ws.review.dueCount() : 0))
  handle(IPC.reviewPromptIssues, () => need().review.promptIssues())
  handle(IPC.sessionsLog, async entry => {
    await need().sessions.append(entry)
  })
  handle(IPC.statsGet, () => need().stats.get())

  ipcMain.handle(IPC.ptyCreate, (e, cols: number, rows: number) => ctx.pty.create(ws?.root ?? homedir(), cols, rows, e.sender.id))
  ipcMain.on(IPC.ptyWrite, (_e, id: string, data: string) => ctx.pty.write(id, data))
  ipcMain.on(IPC.ptyResize, (_e, id: string, cols: number, rows: number) => ctx.pty.resize(id, cols, rows))
  ipcMain.on(IPC.ptyKill, (_e, id: string) => ctx.pty.kill(id))

  return {
    current: () => ws,
    closeAll: () => {
      ws?.close()
      ctx.pty.killAll()
    },
    busy: () => inflight.size > 0,
    drain: async () => {
      while (inflight.size) await Promise.allSettled([...inflight])
    }
  }
}
