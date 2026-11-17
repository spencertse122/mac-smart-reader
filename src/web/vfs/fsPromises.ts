import { getVfs, type VfsEntry } from './vfs'

type Enc = BufferEncoding | { encoding?: BufferEncoding | null } | null | undefined
const wantsString = (o: Enc): boolean => !!(typeof o === 'string' ? o : o?.encoding)
const bytes = (d: string | Uint8Array): Uint8Array => (typeof d === 'string' ? new TextEncoder().encode(d) : d)
const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

export class Stats {
  readonly ino = 1
  constructor(private e: VfsEntry) {}
  get size(): number { return this.e.size }
  get mtimeMs(): number { return this.e.mtimeMs }
  isFile(): boolean { return this.e.kind === 'file' }
  isDirectory(): boolean { return this.e.kind === 'dir' }
}

export class Dirent {
  constructor(private e: VfsEntry) {}
  get name(): string { return this.e.path.slice(this.e.path.lastIndexOf('/') + 1) }
  isFile(): boolean { return this.e.kind === 'file' }
  isDirectory(): boolean { return this.e.kind === 'dir' }
}

export function readFile(path: string): Promise<Buffer>
export function readFile(path: string, opts: BufferEncoding | { encoding: BufferEncoding }): Promise<string>
export async function readFile(path: string, opts?: Enc): Promise<Buffer | string> {
  const data = await getVfs().read(path)
  // Copy: callers may mutate the result, and the VFS bytes must stay intact.
  const buf = Buffer.from(data)
  return wantsString(opts) ? buf.toString('utf8') : buf
}

export async function writeFile(path: string, data: string | Uint8Array, _opts?: Enc): Promise<void> {
  getVfs().writeLocal(path, bytes(data))
}

export async function appendFile(path: string, data: string | Uint8Array, _opts?: Enc): Promise<void> {
  const vfs = getVfs()
  const prev = vfs.entry(path) ? await vfs.read(path) : new Uint8Array(0)
  vfs.writeLocal(path, concat(prev, bytes(data)))
}

export async function mkdir(path: string, opts: { recursive?: boolean } = {}): Promise<void> {
  getVfs().mkdir(path, opts)
}

export function readdir(path: string): Promise<string[]>
export function readdir(path: string, opts: { withFileTypes: true }): Promise<Dirent[]>
export async function readdir(path: string, opts?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]> {
  const ents = getVfs().readdir(path)
  return opts?.withFileTypes ? ents.map(e => new Dirent(e)) : ents.map(e => new Dirent(e).name)
}

export async function stat(path: string): Promise<Stats> {
  return new Stats(getVfs().stat(path))
}

export async function access(path: string, _mode?: number): Promise<void> {
  getVfs().stat(path, 'access')
}

export async function unlink(path: string): Promise<void> {
  getVfs().remove(path)
}

export async function rename(from: string, to: string): Promise<void> {
  await getVfs().rename(from, to)
}

export async function copyFile(from: string, to: string): Promise<void> {
  const vfs = getVfs()
  vfs.writeLocal(to, await vfs.read(from))
}

export class FileHandle {
  constructor(private path: string, private writable: boolean) {}

  async read(buf: Uint8Array, offset = 0, length = buf.length - offset, position: number | null = 0): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    const vfs = getVfs()
    const size = vfs.stat(this.path).size
    // position null means 'current position' in Node; handles here are stateless, so that reads from 0.
    const start = Math.min(position ?? 0, size)
    const end = Math.min(start + length, size)
    // Ranged so a remote book is not downloaded whole just to sniff its header.
    const chunk = end > start ? await vfs.read(this.path, [start, end]) : new Uint8Array(0)
    buf.set(chunk, offset)
    return { bytesRead: chunk.length, buffer: buf }
  }

  async stat(): Promise<Stats> {
    return stat(this.path)
  }

  async writeFile(data: string | Uint8Array): Promise<void> {
    if (!this.writable) throw new Error('EBADF: file not open for writing')
    await writeFile(this.path, data)
  }

  async sync(): Promise<void> {}

  async close(): Promise<void> {}
}

export async function open(path: string, flags: string = 'r'): Promise<FileHandle> {
  const vfs = getVfs()
  if (flags.startsWith('r')) {
    vfs.stat(path, 'open')
    return new FileHandle(path, flags.includes('+'))
  }
  // 'w' creates/truncates immediately, as Node does.
  if (flags.startsWith('w') || !vfs.entry(path)) vfs.writeLocal(path, new Uint8Array(0))
  return new FileHandle(path, true)
}
