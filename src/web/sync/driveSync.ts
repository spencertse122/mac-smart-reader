import { posix } from 'path-browserify'
import { DriveAuthError, DriveError, FOLDER_MIME, type DriveClient, type DriveFile } from '../drive/client'
import type { DriveChange } from '../drive/client'
import type { Vfs, VfsEntry, VfsOp } from '../vfs/vfs'
import { mergeFile } from './merge'
import type { OutboxItem, OutboxStore } from './outbox'
import { isPushable, shouldIndex } from './pathRules'
import { dec, enc, isMergeable, md5hex, parsesAsJson, pool } from './util'

// What Drive holds for a path as of the last sync (pull or push).
type Meta = { id: string; kind: 'file' | 'dir'; md5: string | null }
// A queued upload. `mkdir` items (empty folders) are not persisted: a child push recreates them anyway.
type Pending = OutboxItem & { mkdir?: boolean }

const INDEX_CONCURRENCY = 8
const MAX_BACKOFF_MS = 30_000

/**
 * Mirrors a Drive folder into the VFS at `mount` and keeps both sides in step:
 * - reads are lazy (remote loader), bytes are kept after the first download;
 * - local writes go to a persistent outbox first, then upload, one at a time, latest bytes per path;
 * - pulls apply the Drive changes feed; a remote change to a path with an unpushed local edit is
 *   three-way merged against the version that edit started from.
 * Pulls and pushes share one lock, so a pull never sees a half-applied push.
 */
export class DriveSync {
  private readonly mountPath: string
  private readonly now: () => number
  private meta = new Map<string, Meta>()
  private byId = new Map<string, string>()
  // Text of the last-synced version of each mergeable file we have seen the bytes of.
  private baseText = new Map<string, string>()
  private dirty = new Map<string, Pending>()
  private inflight: string | null = null
  private persisting = new Map<string, Promise<void>>()
  private loads = new WeakMap<VfsEntry, Promise<Uint8Array>>()
  private lock: Promise<unknown> = Promise.resolve()
  private token: string | null = null
  private lastPull = -Infinity
  private pulling: Promise<boolean> | null = null
  private running = false
  private paused: DriveAuthError | null = null
  private authNotified = false
  private failures = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = []
  private changeCbs = new Set<(paths: string[]) => void>()
  private authCbs = new Set<(e: DriveAuthError) => void>()
  private syncCbs = new Set<(e: Error) => void>()
  private syncError: Error | null = null
  private syncNotified = false
  private unsubscribe: (() => void) | null = null

  constructor(
    private vfs: Vfs,
    private drive: DriveClient,
    private outbox: OutboxStore,
    private rootId: string,
    opts: { mount?: string; now?: () => number } = {}
  ) {
    this.mountPath = opts.mount ?? '/library'
    this.now = opts.now ?? Date.now
  }

  onChange(cb: (paths: string[]) => void): () => void {
    this.changeCbs.add(cb)
    return () => this.changeCbs.delete(cb)
  }

  onAuthError(cb: (e: DriveAuthError) => void): () => void {
    this.authCbs.add(cb)
    return () => this.authCbs.delete(cb)
  }

  // Pushes failing for a reason other than auth (after the client's own retries). Fired once until a success.
  onSyncError(cb: (e: Error) => void): () => void {
    this.syncCbs.add(cb)
    return () => this.syncCbs.delete(cb)
  }

  // Detaches from the VFS and cancels the retry timer; pending edits stay in the outbox for the next mount.
  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.paused = new DriveAuthError('stopped')
    this.changeCbs.clear()
    this.authCbs.clear()
    this.syncCbs.clear()
  }

  pending(): number {
    return this.dirty.size + (this.inflight && !this.dirty.has(this.inflight) ? 1 : 0)
  }

  async mount(): Promise<void> {
    // Token first: anything that changes while we index is replayed by the first pull.
    this.token = await this.drive.startPageToken()
    this.vfs.mkdir(this.mountPath, { recursive: true })
    this.register(this.mountPath, { id: this.rootId, mimeType: FOLDER_MIME })
    await this.indexFolder(this.rootId, this.mountPath)
    this.vfs.setRemoteLoader((e, range) => this.load(e, range))
    this.unsubscribe?.()
    this.unsubscribe = this.vfs.onLocalChange(op => this.onLocal(op))
    await this.replay()
    this.lastPull = this.now()
    this.kick()
  }

  async pull(): Promise<boolean> {
    if (this.pulling) return this.pulling
    this.pulling = this.locked(async () => {
      if (this.token === null) throw new Error('DriveSync.pull before mount')
      let res: { changes: DriveChange[]; newStartPageToken: string }
      try {
        res = await this.drive.changes(this.token)
      } catch (e) {
        if (e instanceof DriveAuthError) this.pause(e)
        throw e
      }
      const changed = new Set<string>()
      for (const c of res.changes) await this.applyChange(c, changed)
      this.token = res.newStartPageToken
      this.lastPull = this.now()
      return [...changed]
    })
      .then(changed => {
        this.succeeded()
        this.resume()
        if (changed.length) for (const cb of [...this.changeCbs]) cb(changed)
        return changed.length > 0
      })
      .finally(() => {
        this.pulling = null
      })
    return this.pulling
  }

  async pullIfStale(maxAgeMs = 3000): Promise<void> {
    if (this.now() - this.lastPull < maxAgeMs) return
    try {
      await this.pull()
    } catch (e) {
      // offline or signed out: the mutation goes ahead on local state and is queued (BC4)
      if (!(e instanceof DriveAuthError || e instanceof DriveError || e instanceof TypeError)) throw e
    }
  }

  flush(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
      // an explicit flush retries now, whatever the backoff
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
      }
      if (this.paused) this.resume()
      else this.kick()
      this.settle()
    })
  }

  // ---- local changes → outbox ----

  private inMount(p: string): boolean {
    return p.startsWith(`${this.mountPath}/`)
  }

  private onLocal(op: VfsOp): void {
    const p = op.path
    if (!this.inMount(p) || !isPushable(p)) return
    const m = this.meta.get(p)
    if (op.type === 'mkdir') {
      if (!m && !this.dirty.has(p)) this.dirty.set(p, { path: p, data: new Uint8Array(0), baseMd5: null, mkdir: true })
    } else if (op.type === 'remove') {
      if (!m && this.inflight !== p) {
        // never reached Drive (e.g. an atomic-write temp): just forget it
        if (this.dirty.delete(p)) this.persist(p, null)
        return
      }
      this.enqueue({ path: p, data: new Uint8Array(0), baseMd5: m?.md5 ?? null, remove: true })
    } else {
      const data = this.vfs.entry(p)?.data
      if (!data) return
      // Keep the base this edit started from if an earlier edit is still queued.
      const prev = this.dirty.get(p)
      const base = prev && !prev.mkdir && !prev.remove ? prev : { baseMd5: m?.md5 ?? null, baseText: this.baseText.get(p) ?? null }
      this.enqueue({ path: p, data, baseMd5: base.baseMd5, baseText: base.baseText ?? null })
    }
    this.kick()
  }

  private enqueue(item: Pending): void {
    this.dirty.set(item.path, item)
    if (!item.mkdir) this.persist(item.path, item)
  }

  // Outbox writes for one path run in order, so a delete never overtakes a newer put.
  private persist(path: string, item: OutboxItem | null): void {
    const prev = this.persisting.get(path) ?? Promise.resolve()
    const next = prev
      .then(() => (item ? this.outbox.put(stripPending(item)) : this.outbox.delete(path)))
      .catch(e => console.error('outbox write failed', path, e))
    this.persisting.set(path, next)
    void next.then(() => {
      if (this.persisting.get(path) === next) this.persisting.delete(path)
    })
  }

  private async replay(): Promise<void> {
    for (const item of await this.outbox.all()) {
      if (!this.inMount(item.path) || this.dirty.has(item.path)) continue
      if (item.remove) {
        if (this.meta.has(item.path)) this.dirty.set(item.path, item)
        else await this.outbox.delete(item.path)
        continue
      }
      // The services must see the queued bytes at once; the push merges if Drive moved on meanwhile.
      try {
        this.vfs.writeLocal(item.path, item.data, { fromRemote: true })
      } catch (e) {
        console.error('outbox item cannot be restored', item.path, e)
        continue
      }
      this.dirty.set(item.path, item)
    }
  }

  // ---- push worker ----

  private kick(): void {
    if (this.running || this.paused || this.retryTimer) return
    this.running = true
    void this.drain()
  }

  private async drain(): Promise<void> {
    try {
      while (!this.paused && !this.retryTimer && this.dirty.size > 0) {
        const path = this.dirty.keys().next().value as string
        await this.locked(() => this.pushOne(path))
      }
    } finally {
      this.running = false
      this.settle()
    }
  }

  private async pushOne(path: string): Promise<void> {
    const item = this.dirty.get(path)
    if (!item) return
    this.dirty.delete(path)
    this.inflight = path
    try {
      await this.persisting.get(path)
      if (item.mkdir) await this.ensureFolder(path)
      else if (item.remove) await this.pushRemove(path)
      else await this.pushWrite(item)
      this.succeeded()
      if (!this.dirty.has(path) && !item.mkdir) this.persist(path, null)
    } catch (e) {
      // A newer edit queued meanwhile supersedes this one.
      if (!this.dirty.has(path)) this.dirty.set(path, item)
      if (e instanceof DriveAuthError) return this.pause(e)
      if (e instanceof DriveError && e.status === 404 && this.failures++ < 3) {
        // Gone on Drive (deleted for good): forget the ids and create it afresh.
        this.forgetChain(path)
        return
      }
      this.syncError = e instanceof Error ? e : new Error(String(e))
      if (!this.syncNotified) {
        this.syncNotified = true
        for (const cb of [...this.syncCbs]) cb(this.syncError)
      }
      this.scheduleRetry()
    } finally {
      this.inflight = null
    }
  }

  private async pushRemove(path: string): Promise<void> {
    const m = this.meta.get(path)
    if (!m) return
    try {
      await this.drive.trash(m.id)
    } catch (e) {
      if (!(e instanceof DriveError && e.status === 404)) throw e
    }
    this.forget(path)
  }

  private async pushWrite(item: Pending): Promise<void> {
    const { path, data } = item
    const hash = md5hex(data)
    const m = this.meta.get(path)
    const startMd5 = m?.md5 ?? null
    let remote: DriveFile
    if (!m) {
      // Not known on Drive. The other device may have created it since our last pull: adopt it.
      const parentId = await this.ensureFolder(posix.dirname(path))
      const name = posix.basename(path)
      const existing = (await this.drive.listChildren(parentId)).find(f => f.name === name && f.mimeType !== FOLDER_MIME)
      if (!existing) return this.pushed(path, data, startMd5, await this.drive.createFile(name, parentId, data))
      remote = existing
    } else {
      // The changes feed may lag: ask Drive for its current version right before overwriting it.
      remote = await this.drive.get(m.id)
    }
    const fresh = remote.md5Checksum ?? null
    if (fresh === hash) {
      this.register(path, remote)
      return this.pushed(path, data, startMd5, null)
    }
    // Drive holds a version this edit did not start from: merge first; the merged bytes requeue.
    if (fresh !== item.baseMd5 && isMergeable(path)) return this.mergeInto(path, item, remote)
    this.pushed(path, data, startMd5, await this.drive.updateFile(remote.id, data))
  }

  private pushed(path: string, data: Uint8Array, startMd5: string | null, res: DriveFile | null): void {
    if (res) this.register(path, { ...res, md5Checksum: res.md5Checksum ?? md5hex(data) })
    const m = this.meta.get(path)!
    const text = isMergeable(path) ? dec(data) : null
    if (text !== null) this.baseText.set(path, text)
    if (this.vfs.entry(path)?.data === data) this.vfs.annotate(path, { driveId: m.id, md5: m.md5 ?? undefined })
    // An edit queued while this upload ran was made on top of these bytes: they are its base now,
    // or a later merge would read our own upload as a remote change.
    const next = this.dirty.get(path)
    if (next && !next.remove && !next.mkdir && next.baseMd5 === startMd5) {
      const rebased = { ...next, baseMd5: m.md5, baseText: text }
      this.dirty.set(path, rebased)
      this.persist(path, rebased)
    }
  }

  // Three-way merge of a queued local edit with Drive's version `remote`. The result is written
  // locally (so services see it) and queued with `remote` as its new base.
  private async mergeInto(path: string, item: Pending, remote: Pick<DriveFile, 'id' | 'mimeType' | 'md5Checksum'>): Promise<void> {
    const bytes = await this.download(remote.id, path)
    // Only a downloaded version becomes the base: after a failed download it must still look new.
    this.register(path, remote)
    const remoteText = dec(bytes)
    this.baseText.set(path, remoteText)
    // Merge what the services hold now: an edit made during the download is part of it.
    const cur = this.vfs.entry(path)
    if (cur?.kind !== 'file' || !cur.data) return // removed meanwhile: the queued remove stands
    const merged = mergeFile(path, item.baseText ?? null, dec(cur.data), remoteText)
    // Any queued item is superseded by the merged bytes, written in this same tick.
    this.dirty.delete(path)
    this.vfs.writeLocal(path, enc(merged))
  }

  private async ensureFolder(path: string): Promise<string> {
    if (path === this.mountPath) return this.rootId
    const m = this.meta.get(path)
    if (m?.kind === 'dir') return m.id
    const parentId = await this.ensureFolder(posix.dirname(path))
    const name = posix.basename(path)
    // Re-list before creating: a retried or concurrent create must not leave twin folders.
    const found = (await this.drive.listChildren(parentId)).find(f => f.name === name && f.mimeType === FOLDER_MIME)
    const f = found ?? (await this.drive.createFolder(name, parentId))
    this.register(path, f)
    this.vfs.annotate(path, { driveId: f.id })
    return f.id
  }

  // Transient failure (network, 5xx after the client's own retries): back off, then drain again.
  private scheduleRetry(): void {
    const delay = Math.min(1000 * 2 ** this.failures++, MAX_BACKOFF_MS)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.kick()
    }, delay)
  }

  private pause(e: DriveAuthError): void {
    this.paused = e
    if (!this.authNotified) {
      this.authNotified = true
      for (const cb of [...this.authCbs]) cb(e)
    }
    this.settle()
  }

  private resume(): void {
    this.paused = null
    this.kick()
  }

  private succeeded(): void {
    this.authNotified = false
    this.syncNotified = false
    this.syncError = null
    this.failures = 0
  }

  private settle(): void {
    if (this.running || this.waiters.length === 0) return
    if (this.paused) {
      const err = this.paused
      for (const w of this.waiters.splice(0)) w.reject(err)
      return
    }
    if (this.dirty.size > 0) {
      // backing off after a failure: report it rather than hang
      if (this.retryTimer && this.syncError) {
        const err = this.syncError
        for (const w of this.waiters.splice(0)) w.reject(err)
      }
      return
    }
    const ws = this.waiters.splice(0)
    void Promise.all([...this.persisting.values()]).then(() => ws.forEach(w => w.resolve()))
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.lock.then(fn)
    this.lock = p.catch(() => undefined)
    return p
  }

  // ---- index and pulls ----

  private rel(path: string): string {
    return path.slice(this.mountPath.length + 1)
  }

  private register(path: string, f: Pick<DriveFile, 'id' | 'mimeType'> & { md5Checksum?: string }): void {
    const old = this.meta.get(path)
    if (old && old.id !== f.id && this.byId.get(old.id) === path) this.byId.delete(old.id)
    this.meta.set(path, { id: f.id, kind: f.mimeType === FOLDER_MIME ? 'dir' : 'file', md5: f.md5Checksum ?? null })
    this.byId.set(f.id, path)
  }

  private forget(path: string): void {
    for (const p of [...this.meta.keys()]) {
      if (p !== path && !p.startsWith(`${path}/`)) continue
      const m = this.meta.get(p)!
      if (this.byId.get(m.id) === p) this.byId.delete(m.id)
      this.meta.delete(p)
      this.baseText.delete(p)
    }
  }

  // A 404 may mean a whole folder chain is gone: forget the path and its ancestors (they are re-found by name).
  private forgetChain(path: string): void {
    for (let p = path; p !== this.mountPath && this.inMount(p); p = posix.dirname(p)) {
      const m = this.meta.get(p)
      if (!m) continue
      if (this.byId.get(m.id) === p) this.byId.delete(m.id)
      this.meta.delete(p)
    }
  }

  private childPath(parent: string, f: DriveFile): string | null {
    // Names that cannot be a path segment are skipped.
    if (!f.name || f.name === '.' || f.name === '..' || f.name.includes('/')) return null
    const p = `${parent}/${f.name}`
    return shouldIndex(this.rel(p), f.mimeType === FOLDER_MIME) ? p : null
  }

  private addRemote(path: string, f: DriveFile, prev?: VfsEntry): void {
    this.register(path, f)
    this.baseText.delete(path)
    const remoteMtime = Date.parse(f.modifiedTime) || this.now()
    if (f.mimeType === FOLDER_MIME) {
      this.vfs.putRemote({ path, kind: 'dir', size: 0, mtimeMs: remoteMtime })
      this.vfs.annotate(path, { driveId: f.id })
      return
    }
    // A new version must move mtime even if Drive's clock disagrees, or jsonFile keeps its cache.
    const mtimeMs = prev ? Math.max(remoteMtime, prev.mtimeMs + 1) : remoteMtime
    this.vfs.putRemote({ path, kind: 'file', driveId: f.id, size: Number(f.size), md5: f.md5Checksum, mtimeMs })
  }

  // Breadth-first listing of a Drive folder into the VFS. Google-native docs (no size) are skipped.
  private async indexFolder(id: string, path: string, changed?: Set<string>): Promise<void> {
    let level: Array<[string, string]> = [[id, path]]
    while (level.length) {
      const next: Array<[string, string]> = []
      await pool(level, INDEX_CONCURRENCY, async ([fid, fpath]) => {
        for (const f of await this.drive.listChildren(fid)) {
          const p = this.childPath(fpath, f)
          if (!p || this.dirty.has(p)) continue
          const isDir = f.mimeType === FOLDER_MIME
          if (!isDir && f.size === undefined) continue
          const cur = this.meta.get(p)
          // Twin names on Drive: the first one listed wins. Same id and md5: already up to date.
          if (cur && (cur.id !== f.id || cur.md5 === (f.md5Checksum ?? null))) {
            if (isDir && cur.id === f.id) next.push([f.id, p])
            continue
          }
          this.addRemote(p, f, this.vfs.entry(p))
          changed?.add(p)
          if (isDir) next.push([f.id, p])
        }
      })
      level = next
    }
  }

  private async applyChange(c: DriveChange, changed: Set<string>): Promise<void> {
    const f = c.file
    const knownPath = this.byId.get(c.fileId)
    // Only the id currently mapped at that path counts: Drive may replace a file with a new id.
    const known = knownPath && this.meta.get(knownPath)?.id === c.fileId ? knownPath : undefined
    if (c.removed || !f || f.trashed) {
      if (known) this.removeRemote(known, changed)
      return
    }
    const parentId = f.parents?.[0]
    const parent = parentId === this.rootId ? this.mountPath : parentId ? this.byId.get(parentId) : undefined
    const isDir = f.mimeType === FOLDER_MIME
    const path = parent && this.meta.get(parent)?.kind === 'dir' ? this.childPath(parent, f) : null
    if (!path || (!isDir && f.size === undefined)) {
      if (known) this.removeRemote(known, changed)
      return
    }
    if (known && known !== path) this.removeRemote(known, changed)
    const m = this.meta.get(path)
    if (isDir) {
      if (m?.id === f.id) return
      this.addRemote(path, f)
      changed.add(path)
      // moved in from elsewhere or renamed: its children send no changes of their own
      await this.indexFolder(f.id, path, changed)
      return
    }
    const md5 = f.md5Checksum ?? null
    if (m && m.md5 === md5) {
      if (m.id !== f.id) this.register(path, f)
      return // our own push echoing back, or nothing new
    }
    const pending = this.dirty.get(path)
    if (pending?.remove) {
      // edited on the other device after we deleted it here: keep their edit
      this.dirty.delete(path)
      this.persist(path, null)
    } else if (pending && !pending.mkdir) {
      if (isMergeable(path)) await this.mergeInto(path, pending, f)
      else this.register(path, f) // not mergeable: the local edit wins when it is pushed
      changed.add(path)
      return
    }
    this.addRemote(path, f, this.vfs.entry(path))
    changed.add(path)
  }

  // Drop a path deleted (or moved away) on Drive, keeping any local edit still waiting to upload.
  private removeRemote(path: string, changed: Set<string>): void {
    const keep = (p: string) => [...this.dirty.keys()].some(d => d === p || d.startsWith(`${p}/`))
    const under = this.vfs
      .list()
      .filter(e => e.path === path || e.path.startsWith(`${path}/`))
      .sort((a, b) => (a.path < b.path ? 1 : -1))
    for (const e of under) if (!keep(e.path)) this.vfs.dropRemote(e.path)
    this.forget(path)
    changed.add(path)
  }

  // ---- reads ----

  private async download(id: string, path: string): Promise<Uint8Array> {
    let data = await this.drive.download(id)
    // A half-synced JSON file is fetched once more before the services' recovery kicks in (BC9).
    if (path.endsWith('.json') && !parsesAsJson(data)) data = await this.drive.download(id)
    return data
  }

  private async load(e: VfsEntry, range?: [number, number]): Promise<Uint8Array> {
    const id = e.driveId ?? this.meta.get(e.path)?.id
    if (!id) throw new Error(`${e.path} is not on Drive`)
    try {
      if (range) return range[1] > range[0] ? await this.drive.download(id, [range[0], range[1] - 1]) : new Uint8Array(0)
      let p = this.loads.get(e)
      if (!p) {
        p = this.download(id, e.path).then(data => {
          if (this.vfs.cacheRemote(e, data) && isMergeable(e.path) && this.meta.get(e.path)?.md5 === (e.md5 ?? null)) {
            this.baseText.set(e.path, dec(data))
          }
          // a download that works proves the token again
          if (this.paused) {
            this.succeeded()
            this.resume()
          }
          return data
        })
        this.loads.set(e, p)
        p.catch(() => this.loads.delete(e))
      }
      return await p
    } catch (err) {
      if (err instanceof DriveAuthError) this.pause(err)
      throw err
    }
  }
}

const stripPending = ({ mkdir: _m, ...item }: Pending): OutboxItem => item
