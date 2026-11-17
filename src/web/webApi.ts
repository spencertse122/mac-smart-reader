import { basename } from 'node:path'
import type { MenuAction, OpenLibraryResult, SmartReaderApi } from '../shared/api'
import type { Toast } from '../shared/types'
import type { DriveClient } from './drive/client'
import type { BookCache } from './bookCache'
import { DriveSync } from './sync/driveSync'
import type { OutboxStore } from './sync/outbox'
import { Vfs, getVfs, setVfs } from './vfs/vfs'
import { openWebWorkspace, type WebWorkspace } from './webWorkspace'
import { webSettings } from './webSettings'

type Folder = { id: string; name: string }

export interface WebApiDeps {
  drive: DriveClient
  // One outbox per Drive folder: queued paths from folder A must never replay into folder B.
  outboxFor: (folderId: string) => OutboxStore
  pickFolder: () => Promise<Folder | null>
  savedFolder: () => Folder | null
  rememberFolder: (f: Folder) => void
  cache: BookCache
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  // Poll every 30 s while visible and on becoming visible. Off in tests.
  autoPull?: boolean
  now?: () => Date
  // Subscribes to raw Drive download progress (the app wraps the client's download to feed it).
  downloadProgress?: (cb: (driveId: string, loaded: number, total: number) => void) => () => void
}

export type WebApi = SmartReaderApi & {
  sync(): DriveSync | null
  // Survives folder switches, unlike DriveSync.onAuthError.
  onAuthError(cb: () => void): () => void
  dispose(): void
}

const PULL_INTERVAL_MS = 30_000

export function createWebApi(deps: WebApiDeps): WebApi {
  let ws: WebWorkspace | null = null
  let sync: DriveSync | null = null
  let mountedId: string | null = null
  let unsubSync: (() => void) | null = null
  let unsubErr: (() => void) | null = null
  let unsubAuth: (() => void) | null = null
  const subs = {
    review: new Set<() => void>(),
    library: new Set<() => void>(),
    toast: new Set<(t: Toast) => void>(),
    auth: new Set<() => void>(),
    read: new Set<(loaded: number, total: number) => void>()
  }
  let readingId: string | null = null
  const emit = (set: Set<() => void>): void => {
    for (const cb of [...set]) cb()
  }
  const reviewChanged = (): void => emit(subs.review)
  const libraryChanged = (): void => emit(subs.library)
  const settings = webSettings(() => deps.savedFolder() !== null, deps.storage)

  const need = (): WebWorkspace => {
    if (!ws) throw new Error('No library is open')
    return ws
  }
  // BC4: a failed pull never blocks the edit; the sync layer already swallows network/auth errors.
  const mutating = async <T>(fn: (w: WebWorkspace) => Promise<T>): Promise<T> => {
    const w = need()
    await sync?.pullIfStale()
    return fn(w)
  }

  const pullNow = (): void => {
    void sync?.pull().catch(() => undefined)
  }
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') pullNow()
  }
  const timer =
    deps.autoPull !== false && typeof document !== 'undefined'
      ? setInterval(() => {
          if (document.visibilityState === 'visible') pullNow()
        }, PULL_INTERVAL_MS)
      : null
  if (timer) document.addEventListener('visibilitychange', onVisibility)

  // Builds and mounts the new sync completely before touching live state, so a failure leaves the old library working.
  async function mount(f: Folder): Promise<void> {
    const vfs = new Vfs()
    const next = new DriveSync(vfs, deps.drive, deps.outboxFor(f.id), f.id)
    try {
      await next.mount()
    } catch (e) {
      next.stop()
      throw e
    }
    setVfs(vfs)
    ws?.close()
    ws = null
    unsubSync?.()
    unsubErr?.()
    unsubAuth?.()
    sync?.stop()
    sync = next
    mountedId = f.id
    unsubSync = next.onChange(() => {
      reviewChanged()
      libraryChanged()
    })
    unsubAuth = next.onAuthError(() => emit(subs.auth))
    unsubErr = next.onSyncError(() => {
      for (const cb of [...subs.toast]) cb({ kind: 'warning', message: "Couldn't sync to Google Drive — will retry." })
    })
  }

  const api: WebApi = {
    platform: 'web',
    sync: () => sync,
    onAuthError: cb => (subs.auth.add(cb), () => void subs.auth.delete(cb)),
    dispose() {
      if (timer) {
        clearInterval(timer)
        document.removeEventListener('visibilitychange', onVisibility)
      }
      unsubSync?.()
      unsubErr?.()
      unsubAuth?.()
      sync?.stop()
      ws?.close()
    },
    settings: {
      get: () => settings.get(),
      update: patch => settings.update(patch)
    },
    library: {
      async chooseFolder() {
        const f = await deps.pickFolder()
        if (!f) return null
        await mount(f)
        deps.rememberFolder(f)
        return '/library'
      },
      async open(_root: string): Promise<OpenLibraryResult> {
        try {
          const f = deps.savedFolder()
          if (!f) return { ok: false, error: 'No Drive folder chosen' }
          if (mountedId !== f.id || !sync) await mount(f)
          const next = await openWebWorkspace('/library', {
            newCardsPerDay: async () => (await settings.get()).newCardsPerDay,
            onReviewChanged: reviewChanged,
            now: deps.now
          })
          ws?.close()
          ws = next
          return { ok: true, root: '/library', books: await ws.library.list() }
        } catch (e) {
          return { ok: false, error: (e as Error).message }
        }
      },
      current: async () => (ws ? ws.root : null),
      list: async () => need().library.list(),
      rescan: async () => need().library.scan(),
      async readBook(id) {
        const w = need()
        const b = await w.library.get(id)
        const e = getVfs().entry(`/library/${b.path}`)
        const key = e?.driveId && e.md5 ? `${e.driveId}:${e.md5}` : null
        if (key) {
          const hit = await deps.cache.get(key)
          if (hit) return { name: basename(b.path), data: hit }
        }
        // Only the book's own download counts, not background sync traffic.
        const off = deps.downloadProgress?.((did, l, t) => {
          if (did === readingId) for (const cb of [...subs.read]) cb(l, t)
        })
        readingId = e?.driveId ?? null
        let r: { name: string; data: Uint8Array | Buffer }
        try {
          r = await w.library.readBook(id)
        } finally {
          readingId = null
          off?.()
        }
        const data = new Uint8Array(r.data)
        if (key) await deps.cache.put(key, data)
        return { name: r.name, data }
      },
      onReadProgress: cb => (subs.read.add(cb), () => void subs.read.delete(cb)),
      getCover: async id => {
        const c = await need().library.getCover(id)
        return c ? new Uint8Array(c) : null
      },
      saveMetadata: (id, meta) =>
        mutating(async w => {
          const b = await w.library.saveMetadata(id, meta)
          libraryChanged()
          return b
        }),
      saveProgress: (id, loc, p) => mutating(w => w.library.saveProgress(id, loc, p)),
      markOpened: id => mutating(w => w.library.markOpened(id)),
      setStatus: (id, status, reason) =>
        mutating(async w => {
          await w.library.setStatus(id, status, reason)
          libraryChanged()
        })
    },
    highlights: {
      list: async bookId => need().highlights.list(bookId),
      add: (bookId, h) =>
        mutating(async w => {
          const r = await w.highlights.add(bookId, h)
          reviewChanged()
          return r
        }),
      addNote: (bookId, n) =>
        mutating(async w => {
          const r = await w.highlights.addNote(bookId, n)
          reviewChanged()
          return r
        }),
      update: (bookId, id, patch) =>
        mutating(async w => {
          const r = await w.highlights.update(bookId, id, patch)
          reviewChanged()
          return r
        }),
      remove: (bookId, id) =>
        mutating(async w => {
          await w.highlights.remove(bookId, id)
          reviewChanged()
        })
    },
    vocab: {
      lookup: async () => ({ ok: false, reason: 'unavailable' }),
      save: input =>
        mutating(async w => {
          const r = await w.vocab.save(input)
          reviewChanged()
          return r
        }),
      list: async () => need().vocab.list(),
      remove: id =>
        mutating(async w => {
          await w.vocab.remove(id)
          reviewChanged()
        })
    },
    review: {
      queue: async () => need().review.queue(),
      rate: (id, rating, ms, type) =>
        mutating(async w => {
          const r = await w.review.rate(id, rating, ms, type)
          reviewChanged()
          return r
        }),
      dueCount: async () => (ws ? ws.review.dueCount() : 0),
      promptIssues: async () => need().review.promptIssues()
    },
    sessions: {
      log: entry =>
        mutating(async w => {
          await w.sessions.append(entry)
        })
    },
    stats: { get: async () => need().stats.get() },
    pty: {
      create: async () => '',
      write: () => undefined,
      resize: () => undefined,
      kill: () => undefined,
      onData: () => () => undefined,
      onExit: () => () => undefined
    },
    on: {
      reviewChanged: cb => (subs.review.add(cb), () => void subs.review.delete(cb)),
      libraryChanged: cb => (subs.library.add(cb), () => void subs.library.delete(cb)),
      toast: cb => (subs.toast.add(cb), () => void subs.toast.delete(cb)),
      menu: (_cb: (a: MenuAction) => void) => () => undefined
    }
  }
  return api
}
