import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, readdir, utimes, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeJson, readJson, setRecoveryListener } from '../../src/main/store/atomic'
import { appendJsonl, readJsonl } from '../../src/main/store/jsonl'
import { jsonFile } from '../../src/main/store/jsonFile'

const reads = vi.hoisted(() => ({ n: 0, afterRead: null as null | (() => Promise<void>) }))
vi.mock('../../src/main/store/atomic', async orig => {
  const m = await orig<typeof import('../../src/main/store/atomic')>()
  return { ...m, readJson: async (...a: Parameters<typeof m.readJson>) => {
      reads.n++
      const v = await m.readJson(...a)
      await reads.afterRead?.()
      return v
    } }
})

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'sr-store-')) })

describe('atomic json', () => {
  it('writes and reads back, creating parent dirs', async () => {
    const p = join(dir, 'a', 'b.json')
    await writeJson(p, { x: 1 })
    expect(await readJson(p, () => ({ x: 0 }))).toEqual({ x: 1 })
  })

  it('returns fallback when missing', async () => {
    expect(await readJson(join(dir, 'nope.json'), () => ({ d: true }))).toEqual({ d: true })
  })

  it('keeps a .bak of the previous version and leaves no temp files', async () => {
    const p = join(dir, 'c.json')
    await writeJson(p, { v: 1 })
    await writeJson(p, { v: 2 })
    expect(JSON.parse(await readFile(`${p}.bak`, 'utf8'))).toEqual({ v: 1 })
    expect((await readdir(dir)).filter(f => f.includes('.tmp-'))).toEqual([])
  })

  it('recovers from corrupt json using .bak and reports it', async () => {
    const p = join(dir, 'd.json')
    await writeJson(p, { v: 1 })
    await writeJson(p, { v: 2 })
    await writeFile(p, '{ broken')
    const events: unknown[] = []
    setRecoveryListener(e => events.push(e))
    expect(await readJson(p, () => ({ v: 0 }))).toEqual({ v: 1 })
    expect(events).toHaveLength(1)
    expect((await readdir(dir)).some(f => f.startsWith('d.json.corrupt-'))).toBe(true)
    setRecoveryListener(null)
  })

  it('falls back when corrupt and no backup exists', async () => {
    const p = join(dir, 'e.json')
    await writeFile(p, 'nope')
    expect(await readJson(p, () => ({ v: 9 }))).toEqual({ v: 9 })
  })
})

describe('jsonl', () => {
  it('appends and reads, skipping bad lines', async () => {
    const p = join(dir, 'log.jsonl')
    await appendJsonl(p, { a: 1 })
    await writeFile(p, (await readFile(p, 'utf8')) + 'garbage\n\n{"a":2}\n{"a":3')
    const r = await readJsonl<{ a: number }>(p)
    expect(r.items).toEqual([{ a: 1 }, { a: 2 }])
    expect(r.skipped).toBe(2)
  })

  it('missing file reads as empty', async () => {
    expect(await readJsonl(join(dir, 'x.jsonl'))).toEqual({ items: [], skipped: 0 })
  })
})

describe('jsonFile', () => {
  it('serializes concurrent updates without losing writes', async () => {
    const f = jsonFile(join(dir, 'n.json'), () => ({ n: 0 }))
    await Promise.all(Array.from({ length: 20 }, () => f.update(d => { d.n++ })))
    expect((await f.read()).n).toBe(20)
    expect(JSON.parse(await readFile(join(dir, 'n.json'), 'utf8')).n).toBe(20)
  })

  it('runs afterWrite inside the write chain', async () => {
    const seen: number[] = []
    const f = jsonFile(join(dir, 'm.json'), () => ({ n: 0 }), { afterWrite: async v => { seen.push(v.n) } })
    await Promise.all([f.update(d => { d.n = 1 }), f.update(d => { d.n = 2 })])
    expect(seen).toEqual([1, 2])
  })

  it('a failing update rejects but later updates still run', async () => {
    const f = jsonFile(join(dir, 'k.json'), () => ({ n: 0 }))
    await expect(f.update(() => { throw new Error('boom') })).rejects.toThrow('boom')
    await f.update(d => { d.n = 5 })
    expect((await f.read()).n).toBe(5)
  })
})

describe('jsonFile external changes', () => {
  it('reloads when the file changed on disk', async () => {
    const p = join(dir, 'ext.json')
    const f = jsonFile(p, () => ({ n: 0 }))
    await f.update(d => { d.n = 1 })
    expect(await f.read()).toEqual({ n: 1 })
    await writeFile(p, JSON.stringify({ n: 10 }))
    const t = new Date((await stat(p)).mtimeMs + 2000)
    await utimes(p, t, t)
    expect(await f.read()).toEqual({ n: 10 })
    await f.update(d => { d.n++ })
    expect(JSON.parse(await readFile(p, 'utf8'))).toEqual({ n: 11 })
  })

  it('skips writing when nothing changed', async () => {
    const p = join(dir, 'noop.json')
    const afterWrite = vi.fn(async () => undefined)
    const f = jsonFile(p, () => ({ n: 0 }), { afterWrite })
    await f.update(d => { d.n = 1 })
    afterWrite.mockClear()
    const before = (await stat(p)).mtimeMs
    await f.update(() => {})
    expect((await stat(p)).mtimeMs).toBe(before)
    expect(afterWrite).not.toHaveBeenCalled()
  })

  it('does not reload its own write', async () => {
    const f = jsonFile(join(dir, 'own.json'), () => ({ n: 0 }))
    await f.update(d => { d.n = 1 })
    const before = reads.n
    await f.read()
    expect(reads.n).toBe(before)
  })
})

describe('jsonFile swap during read', () => {
  it('reloads content swapped on disk while a read was in flight', async () => {
    const p = join(dir, 'race.json')
    await writeFile(p, JSON.stringify({ n: 1 }))
    const f = jsonFile(p, () => ({ n: 0 }))
    reads.afterRead = async () => {
      reads.afterRead = null
      await writeFile(p, JSON.stringify({ n: 2 }))
      const t = new Date((await stat(p)).mtimeMs + 2000)
      await utimes(p, t, t)
    }
    expect(await f.read()).toEqual({ n: 1 })
    expect(await f.read()).toEqual({ n: 2 })
  })
})
