import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Vfs } from '../../src/web/vfs/vfs'
import { setVfs } from '../../src/web/vfs/vfs'
import * as fs from '../../src/web/vfs/fsPromises'
import { watchFile, unwatchFile } from '../../src/web/vfs/fs'
import { writeFileAtomic } from '../../src/main/store/atomic'

let vfs: Vfs
beforeEach(() => {
  vfs = new Vfs()
  setVfs(vfs)
})

describe('vfs', () => {
  it('readFile of a missing path rejects with ENOENT', async () => {
    await expect(fs.readFile('/nope.txt')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writeFile then readFile round-trips', async () => {
    await fs.mkdir('/a', { recursive: true })
    await fs.writeFile('/a/x.txt', 'héllo')
    expect(await fs.readFile('/a/x.txt', 'utf8')).toBe('héllo')
    expect(Buffer.from(await fs.readFile('/a/x.txt')).toString('utf8')).toBe('héllo')
  })

  it('mkdir recursive creates parents, plain mkdir needs them', async () => {
    await fs.mkdir('/a/b/c', { recursive: true })
    expect((await fs.stat('/a/b')).isDirectory()).toBe(true)
    await expect(fs.mkdir('/x/y')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.mkdir('/a')).rejects.toMatchObject({ code: 'EEXIST' })
  })

  it('readdir withFileTypes reports files and directories', async () => {
    await fs.mkdir('/d/sub', { recursive: true })
    await fs.writeFile('/d/f.txt', 'x')
    const ents = await fs.readdir('/d', { withFileTypes: true })
    const by = Object.fromEntries(ents.map(e => [e.name, e]))
    expect(by['f.txt'].isFile()).toBe(true)
    expect(by['sub'].isDirectory()).toBe(true)
    expect(await fs.readdir('/d')).toEqual(['f.txt', 'sub'])
    await expect(fs.readdir('/d/f.txt')).rejects.toMatchObject({ code: 'ENOTDIR' })
    await expect(fs.readFile('/d')).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('rename replaces the target and removes the tmp', async () => {
    await fs.writeFile('/t.json', 'old')
    await fs.writeFile('/t.json.tmp', 'new')
    await fs.rename('/t.json.tmp', '/t.json')
    expect(await fs.readFile('/t.json', 'utf8')).toBe('new')
    await expect(fs.stat('/t.json.tmp')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rename moves a directory with nested files and emits replayable ops', async () => {
    await fs.mkdir('/books/old/sub', { recursive: true })
    await fs.writeFile('/books/old/a.txt', 'A')
    await fs.writeFile('/books/old/sub/b.txt', 'B')
    const ops: string[] = []
    vfs.onLocalChange(op => ops.push(`${op.type}:${op.path}`))
    await fs.rename('/books/old', '/books/new')
    expect(await fs.readFile('/books/new/sub/b.txt', 'utf8')).toBe('B')
    expect(await fs.readFile('/books/new/a.txt', 'utf8')).toBe('A')
    await expect(fs.stat('/books/old')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(ops).toContain('remove:/books/old/a.txt')
    expect(ops).toContain('remove:/books/old')
    expect(ops).toContain('write:/books/new/sub/b.txt')
    await expect(fs.rename('/books/missing', '/books/x')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rename onto a non-empty directory fails, onto an empty one replaces it', async () => {
    await fs.mkdir('/s', { recursive: true })
    await fs.writeFile('/s/f', 'x')
    await fs.mkdir('/full', { recursive: true })
    await fs.writeFile('/full/g', 'y')
    await fs.mkdir('/empty', { recursive: true })
    await expect(fs.rename('/s', '/full')).rejects.toMatchObject({ code: 'ENOTEMPTY' })
    await fs.rename('/s', '/empty')
    expect(await fs.readFile('/empty/f', 'utf8')).toBe('x')
  })

  it('readFile returns a copy', async () => {
    await fs.writeFile('/c', 'abc')
    const b = await fs.readFile('/c')
    b[0] = 0x7a
    expect(await fs.readFile('/c', 'utf8')).toBe('abc')
  })

  it('appendFile appends', async () => {
    await fs.appendFile('/l.txt', 'a\n')
    await fs.appendFile('/l.txt', 'b\n')
    expect(await fs.readFile('/l.txt', 'utf8')).toBe('a\nb\n')
  })

  it('open().read reads at an offset', async () => {
    await fs.writeFile('/b.bin', 'abcdefgh')
    const fh = await fs.open('/b.bin', 'r')
    const buf = Buffer.alloc(4)
    const r = await fh.read(buf, 0, 4, 2)
    await fh.close()
    expect(r.bytesRead).toBe(4)
    expect(buf.toString()).toBe('cdef')
  })

  it('stat().mtimeMs increases on each write', async () => {
    await fs.writeFile('/m', '1')
    const a = (await fs.stat('/m')).mtimeMs
    await fs.writeFile('/m', '2')
    const b = (await fs.stat('/m')).mtimeMs
    await fs.writeFile('/m', '3')
    const c = (await fs.stat('/m')).mtimeMs
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })

  it('watchFile fires on local and remote writes, and stops after unwatchFile', async () => {
    const cb = vi.fn()
    watchFile('/w', { interval: 1000 }, cb)
    await fs.writeFile('/w', 'x')
    expect(cb).toHaveBeenCalledTimes(1)
    vfs.writeLocal('/w', new TextEncoder().encode('y'), { fromRemote: true })
    expect(cb).toHaveBeenCalledTimes(2)
    const [cur, prev] = cb.mock.calls[1]
    expect(cur.mtimeMs).not.toBe(prev.mtimeMs)
    unwatchFile('/w')
    await fs.writeFile('/w', 'z')
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('onLocalChange skips remote writes', async () => {
    const ops: unknown[] = []
    vfs.onLocalChange(op => ops.push(op))
    await fs.writeFile('/a.txt', 'x')
    vfs.writeLocal('/r.txt', new Uint8Array([1]), { fromRemote: true })
    expect(ops).toEqual([{ type: 'write', path: '/a.txt' }])
  })

  it('a remote entry without data uses the remote loader (ranged for open().read)', async () => {
    const loader = vi.fn(async (_e: unknown, range?: [number, number]) => {
      const all = new TextEncoder().encode('0123456789')
      return range ? all.slice(range[0], range[1]) : all
    })
    vfs.setRemoteLoader(loader)
    vfs.putRemote({ path: '/lib/r.epub', kind: 'file', driveId: 'D1', size: 10, mtimeMs: 5 })
    expect(vfs.entry('/lib/r.epub')?.driveId).toBe('D1')
    expect(await fs.readFile('/lib/r.epub', 'utf8')).toBe('0123456789')
    expect(loader).toHaveBeenLastCalledWith(expect.objectContaining({ driveId: 'D1' }), undefined)
    const fh = await fs.open('/lib/r.epub', 'r')
    const buf = Buffer.alloc(3)
    await fh.read(buf, 0, 3, 4)
    expect(buf.toString()).toBe('456')
    expect(loader).toHaveBeenLastCalledWith(expect.objectContaining({ driveId: 'D1' }), [4, 7])
  })

  it('cacheRemote stores loaded bytes silently; dropRemote removes a subtree as a remote change', async () => {
    const ops: string[] = []
    vfs.onLocalChange(op => ops.push(`local ${op.type} ${op.path}`))
    vfs.onChange(op => ops.push(`any ${op.type} ${op.path}`))
    vfs.putRemote({ path: '/lib/d/r.txt', kind: 'file', driveId: 'D1', size: 2, mtimeMs: 5, md5: 'm' })
    const e = vfs.entry('/lib/d/r.txt')!
    expect(vfs.cacheRemote(e, new TextEncoder().encode('hi'))).toBe(true)
    expect(vfs.entry('/lib/d/r.txt')).toMatchObject({ mtimeMs: 5, md5: 'm', driveId: 'D1' })
    expect(await fs.readFile('/lib/d/r.txt', 'utf8')).toBe('hi')
    // a stale load never replaces a newer local write
    vfs.putRemote({ path: '/lib/d/s.txt', kind: 'file', driveId: 'D2', size: 1, mtimeMs: 5 })
    const stale = vfs.entry('/lib/d/s.txt')!
    vfs.writeLocal('/lib/d/s.txt', new TextEncoder().encode('new'))
    expect(vfs.cacheRemote(stale, new TextEncoder().encode('o'))).toBe(false)
    expect(await fs.readFile('/lib/d/s.txt', 'utf8')).toBe('new')
    ops.length = 0
    vfs.dropRemote('/lib/d')
    expect(vfs.entry('/lib/d')).toBeUndefined()
    expect(vfs.entry('/lib/d/r.txt')).toBeUndefined()
    expect(vfs.entry('/lib')).toBeTruthy()
    expect(ops).toEqual(['any remove /lib/d/s.txt', 'any remove /lib/d/r.txt', 'any remove /lib/d'])
  })

  it('an atomic write over a never-downloaded file needs no download (works with Drive unreachable)', async () => {
    const loader = vi.fn(async () => {
      throw new Error('Drive authorization failed')
    })
    vfs.setRemoteLoader(loader)
    vfs.putRemote({ path: '/lib/h.md', kind: 'file', driveId: 'D1', size: 4, mtimeMs: 5 })
    await writeFileAtomic('/lib/h.md', 'new')
    expect(loader).not.toHaveBeenCalled()
    expect(await fs.readFile('/lib/h.md', 'utf8')).toBe('new')
    expect(vfs.entry('/lib/h.md.bak')).toBeUndefined()
    // a downloaded file is still backed up
    await writeFileAtomic('/lib/h.md', 'newer')
    expect(await fs.readFile('/lib/h.md.bak', 'utf8')).toBe('new')
  })

  it('skipping the .bak of a never-downloaded file removes a stale .bak', async () => {
    vfs.setRemoteLoader(async () => new Uint8Array())
    vfs.putRemote({ path: '/lib/s.md', kind: 'file', driveId: 'D2', size: 4, mtimeMs: 5 })
    await fs.writeFile('/lib/s.md.bak', 'old backup')
    await writeFileAtomic('/lib/s.md', 'new')
    expect(vfs.entry('/lib/s.md.bak')).toBeUndefined()
    expect(await fs.readFile('/lib/s.md', 'utf8')).toBe('new')
  })
})
