import { posix } from 'path-browserify'
import { fsError } from './errors'

export type VfsEntry = {
  path: string
  kind: 'file' | 'dir'
  driveId?: string
  size: number
  mtimeMs: number
  md5?: string
  data?: Uint8Array
}
export type VfsOp = { type: 'write' | 'mkdir' | 'remove'; path: string }
export type RemoteLoader = (e: VfsEntry, range?: [number, number]) => Promise<Uint8Array>

export const norm = (p: string): string => {
  const n = posix.normalize(p.startsWith('/') ? p : `/${p}`)
  return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n
}

// In-memory tree the Node-style fs shims run against. File bytes live here; Drive-backed
// entries may have no `data` and are fetched through the remote loader on demand.
export class Vfs {
  private entries = new Map<string, VfsEntry>([['/', { path: '/', kind: 'dir', size: 0, mtimeMs: 0 }]])
  private loader: RemoteLoader | null = null
  private localListeners = new Set<(op: VfsOp) => void>()
  private anyListeners = new Set<(op: VfsOp) => void>()

  setRemoteLoader(fn: RemoteLoader): void {
    this.loader = fn
  }

  // Local-only changes: what the sync layer uploads.
  onLocalChange(cb: (op: VfsOp) => void): () => void {
    this.localListeners.add(cb)
    return () => this.localListeners.delete(cb)
  }

  // Every change, remote included: what watchFile follows.
  onChange(cb: (op: VfsOp) => void): () => void {
    this.anyListeners.add(cb)
    return () => this.anyListeners.delete(cb)
  }

  private emit(op: VfsOp, remote: boolean): void {
    if (!remote) for (const cb of [...this.localListeners]) cb(op)
    for (const cb of [...this.anyListeners]) cb(op)
  }

  entry(path: string): VfsEntry | undefined {
    return this.entries.get(norm(path))
  }

  list(): VfsEntry[] {
    return [...this.entries.values()]
  }

  private mkdirs(path: string, remote: boolean): void {
    const missing: string[] = []
    for (let p = path; ; p = posix.dirname(p)) {
      const e = this.entries.get(p)
      if (e) {
        if (e.kind === 'file') throw fsError('ENOTDIR', 'mkdir', p)
        break
      }
      missing.push(p)
    }
    for (const p of missing.reverse()) {
      this.entries.set(p, { path: p, kind: 'dir', size: 0, mtimeMs: Date.now() })
      this.emit({ type: 'mkdir', path: p }, remote)
    }
  }

  mkdir(path: string, opts: { recursive?: boolean } = {}): void {
    const p = norm(path)
    const existing = this.entries.get(p)
    if (opts.recursive) {
      if (existing?.kind === 'file') throw fsError('EEXIST', 'mkdir', p)
      return this.mkdirs(p, false)
    }
    if (existing) throw fsError('EEXIST', 'mkdir', p)
    const parent = this.entries.get(posix.dirname(p))
    if (!parent) throw fsError('ENOENT', 'mkdir', p)
    if (parent.kind === 'file') throw fsError('ENOTDIR', 'mkdir', p)
    this.mkdirs(p, false)
  }

  // Sync layer: record a Drive file/dir (metadata only, bytes load lazily) without emitting a local change.
  putRemote(e: VfsEntry): void {
    const p = norm(e.path)
    if (e.kind === 'dir') return this.mkdirs(p, true)
    this.mkdirs(posix.dirname(p), true)
    const prev = this.entries.get(p)
    this.entries.set(p, { ...e, path: p })
    if (prev && (prev.size !== e.size || prev.mtimeMs !== e.mtimeMs)) this.emit({ type: 'write', path: p }, true)
  }

  writeLocal(path: string, data: Uint8Array, opts: { fromRemote?: boolean; mtimeMs?: number } = {}): void {
    const p = norm(path)
    const prev = this.entries.get(p)
    if (prev?.kind === 'dir') throw fsError('EISDIR', 'write', p)
    this.mkdirs(posix.dirname(p), !!opts.fromRemote)
    const copy = new Uint8Array(data)
    this.entries.set(p, {
      ...(prev?.driveId ? { driveId: prev.driveId } : {}),
      path: p,
      kind: 'file',
      size: copy.length,
      mtimeMs: opts.mtimeMs ?? Math.max(Date.now(), (prev?.mtimeMs ?? 0) + 1),
      data: copy
    })
    this.emit({ type: 'write', path: p }, !!opts.fromRemote)
  }

  private file(path: string, syscall: string): VfsEntry {
    const p = norm(path)
    const e = this.entries.get(p)
    if (!e) throw fsError('ENOENT', syscall, p)
    if (e.kind === 'dir') throw fsError('EISDIR', syscall, p)
    return e
  }

  async read(path: string, range?: [number, number]): Promise<Uint8Array> {
    const e = this.file(path, 'open')
    if (e.data) return range ? e.data.subarray(range[0], range[1]) : e.data
    if (!this.loader) throw new Error(`No remote loader for ${e.path}`)
    return this.loader(e, range)
  }

  stat(path: string, syscall = 'stat'): VfsEntry {
    const p = norm(path)
    const e = this.entries.get(p)
    if (!e) throw fsError('ENOENT', syscall, p)
    return e
  }

  readdir(path: string): VfsEntry[] {
    const p = norm(path)
    const e = this.entries.get(p)
    if (!e) throw fsError('ENOENT', 'scandir', p)
    if (e.kind !== 'dir') throw fsError('ENOTDIR', 'scandir', p)
    const out: VfsEntry[] = []
    for (const c of this.entries.values()) if (c.path !== p && posix.dirname(c.path) === p) out.push(c)
    return out.sort((a, b) => (a.path < b.path ? -1 : 1))
  }

  remove(path: string): void {
    const p = norm(path)
    const e = this.file(p, 'unlink')
    this.entries.delete(e.path)
    this.emit({ type: 'remove', path: p }, false)
  }

  async rename(from: string, to: string): Promise<void> {
    const src = this.file(from, 'rename')
    const dst = norm(to)
    if (this.entries.get(dst)?.kind === 'dir') throw fsError('EISDIR', 'rename', dst)
    const data = await this.read(src.path)
    this.writeLocal(dst, data)
    this.remove(src.path)
  }
}

let current: Vfs | null = null
export const setVfs = (v: Vfs): void => {
  current = v
}
export const getVfs = (): Vfs => {
  if (!current) throw new Error('VFS not initialised')
  return current
}
