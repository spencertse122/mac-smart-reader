import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Vfs } from '../../src/web/vfs/vfs'
import { setVfs } from '../../src/web/vfs/vfs'
import * as fs from '../../src/web/vfs/fsPromises'
import { watchFile, unwatchFile } from '../../src/web/vfs/fs'

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
})
