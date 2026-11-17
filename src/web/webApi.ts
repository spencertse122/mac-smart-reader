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
  outbox: OutboxStore
  pickFolder: () => Promise<Folder | null>
  savedFolder: () => Folder | null
  rememberFolder: (f: Folder) => void
  cache: BookCache
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  // Poll every 30 s while visible and on becoming visible. Off in tests.
  autoPull?: boolean
}

export type WebApi = SmartReaderApi & { sync(): DriveSync | null; dispose(): void }

const PULL_INTERVAL_MS = 30_000

export function createWebApi(deps: WebApiDeps): WebApi {
  let ws: WebWorkspace | null = null
  let sync: DriveSync | null = null
  let mountedId: string | null = null
  let unsubSync: (() => void) | null = null
  const subs = {
    review: new Set<() => void>(),
    library: new Set<() => void>(),
    toast: new Set<(t: Toast) => void>()
  }
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

  async function mount(f: Folder): Promise<void> {
    ws?.close()
    ws = null
    unsubSync?.()
    const vfs = new Vfs()
    setVfs(vfs)
    const next = new DriveSync(vfs, deps.drive, deps.outbox, f.id)
    await next.mount()
    sync = next
    mountedId = f.id
    unsubSync = next.onChange(() => {
      reviewChanged()
      libraryChanged()
    })
  }

  const api: WebApi = {
    platform: 'web',
    sync: () => sync,
    dispose() {
      if (timer) {
        clearInterval(timer)
        document.removeEventListener('visibilitychange', onVisibility)
      }
      unsubSync?.()
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
            onReviewChanged: reviewChanged
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
        const r = await w.library.readBook(id)
        const data = new Uint8Array(r.data)
        if (key) await deps.cache.put(key, data)
        return { name: r.name, data }
      },
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
