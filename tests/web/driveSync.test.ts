import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FakeDrive } from './fakeDrive'
import { seedFake, type SeedSummary } from './mirror'
import { Vfs, setVfs } from '../../src/web/vfs/vfs'
import * as fs from '../../src/web/vfs/fsPromises'
import { writeJson } from '../../src/main/store/atomic'
import { createDriveClient, DriveAuthError, type DriveClient } from '../../src/web/drive/client'
import { DriveSync } from '../../src/web/sync/driveSync'
import { idbOutbox, type OutboxStore } from '../../src/web/sync/outbox'
import { isPushable, shouldIndex } from '../../src/web/sync/pathRules'

const L = '/library'
const SR = `${L}/.smartreader`
const dec = (b: Uint8Array) => new TextDecoder().decode(b)
const remoteJson = (fake: FakeDrive, p: string) => JSON.parse(dec(fake.readFile(p)))

let fake: FakeDrive
let seed: SeedSummary
let vfs: Vfs
let drive: DriveClient
let outbox: OutboxStore
let n = 0

function makeClient(f: FakeDrive['fetch'] = fake.fetch): DriveClient {
  return createDriveClient({ fetch: f, getToken: () => 'test-token', sleep: async () => {} })
}

async function mounted(opts: { drive?: DriveClient; vfs?: Vfs } = {}): Promise<DriveSync> {
  const s = new DriveSync(opts.vfs ?? vfs, opts.drive ?? drive, outbox, fake.rootId)
  await s.mount()
  return s
}

const media = () => fake.requests.filter(r => r.includes('alt=media'))

beforeEach(() => {
  fake = new FakeDrive()
  seed = seedFake(fake)
  vfs = new Vfs()
  setVfs(vfs)
  drive = makeClient()
  outbox = idbOutbox(`test-outbox-${n++}`)
})

describe('pathRules', () => {
  it('isPushable and shouldIndex', () => {
    expect(isPushable('/library/.smartreader/library.json')).toBe(true)
    expect(isPushable('/library/.smartreader/library.json.tmp-1-2-x')).toBe(false)
    expect(isPushable('/library/.smartreader/library.json.bak')).toBe(false)
    expect(isPushable('/library/.smartreader/library.json.corrupt-123')).toBe(true)
    expect(shouldIndex('.smartreader/books/x/highlights.json', false)).toBe(true)
    expect(shouldIndex('knowledge', true)).toBe(true)
    expect(shouldIndex('knowledge/prompts.jsonl', false)).toBe(true)
    expect(shouldIndex('knowledge/concepts', true)).toBe(false)
    expect(shouldIndex('.claude', true)).toBe(false)
    expect(shouldIndex('shelf/node_modules', true)).toBe(false)
    expect(shouldIndex('shelf/a.epub', false)).toBe(true)
    expect(shouldIndex('.DS_Store', false)).toBe(false)
  })
})

describe('DriveSync', () => {
  it('mount indexes books, .smartreader and knowledge/prompts.jsonl but not knowledge/concepts', async () => {
    await mounted()
    for (const b of seed.books) expect(vfs.entry(`${L}/${b.path}`)?.kind).toBe('file')
    expect(vfs.entry(`${SR}/library.json`)?.size).toBeGreaterThan(0)
    expect(vfs.entry(`${SR}/books/${seed.books.find(b => b.id === seed.epubId)!.slug}/highlights.json`)).toBeTruthy()
    expect(vfs.entry(`${L}/knowledge/prompts.jsonl`)).toBeTruthy()
    expect(vfs.entry(`${L}/knowledge/concepts`)).toBeUndefined()
    expect(vfs.entry(`${L}/knowledge/concepts/README.md`)).toBeUndefined()
    expect(vfs.entry(`${L}/.claude`)).toBeUndefined()
    expect(vfs.entry(`${SR}/library.json`)?.md5).toMatch(/^[0-9a-f]{32}$/)
    expect(media()).toEqual([])
  })

  it('lazy read downloads once', async () => {
    await mounted()
    const raw = await fs.readFile(`${SR}/library.json`, 'utf8')
    expect(JSON.parse(raw).books[seed.epubId].location).toBe(seed.location)
    await fs.readFile(`${SR}/library.json`, 'utf8')
    expect(media()).toHaveLength(1)
    expect(vfs.entry(`${SR}/library.json`)?.data).toBeTruthy()
    // a header sniff on a book is a Range request, not a full download
    const fh = await fs.open(`${L}/art-of-war.epub`, 'r')
    const head = new Uint8Array(4)
    await fh.read(head, 0, 4, 0)
    expect(dec(head.subarray(0, 2))).toBe('PK')
    expect(media()).toHaveLength(2)
  })

  it('write pushes and the echoed change is ignored', async () => {
    const sync = await mounted()
    const changed = vi.fn()
    sync.onChange(changed)
    const lib = JSON.parse(await fs.readFile(`${SR}/library.json`, 'utf8'))
    lib.books[seed.epubId].progress = 0.5
    await writeJson(`${SR}/library.json`, lib)
    expect(sync.pending()).toBeGreaterThan(0)
    await sync.flush()
    expect(sync.pending()).toBe(0)
    expect(remoteJson(fake, '.smartreader/library.json').books[seed.epubId].progress).toBe(0.5)
    expect(await outbox.all()).toEqual([])
    const before = vfs.entry(`${SR}/library.json`)!.mtimeMs
    expect(await sync.pull()).toBe(false)
    expect(changed).not.toHaveBeenCalled()
    expect(vfs.entry(`${SR}/library.json`)!.mtimeMs).toBe(before)
    expect(vfs.entry(`${SR}/library.json`)!.data).toBeTruthy()
  })

  it('tmp and .bak never reach Drive', async () => {
    const sync = await mounted()
    // read first, as the services do: a write over never-loaded bytes is merged instead (I1)
    await fs.readFile(`${SR}/library.json`)
    await writeJson(`${SR}/library.json`, { version: 1, books: {} })
    await writeJson(`${SR}/fresh.json`, { a: 1 })
    await sync.flush()
    expect(vfs.list().some(e => e.path.endsWith('.bak'))).toBe(true)
    const uploads = fake.requests.filter(r => r.includes('/upload/'))
    expect(uploads).toHaveLength(2)
    expect(remoteJson(fake, '.smartreader/fresh.json')).toEqual({ a: 1 })
    const all = await sync.pull()
    expect(all).toBe(false)
    expect(() => fake.readFile('.smartreader/library.json.bak')).not.toThrow() // seeded by the Mac, untouched
    expect(JSON.parse(dec(fake.readFile('.smartreader/library.json.bak'))).books[seed.epubId]).toBeTruthy()
    for (const r of fake.requests) expect(decodeURIComponent(r)).not.toMatch(/tmp-/)
  })

  it('new nested dir creates Drive folders', async () => {
    const sync = await mounted()
    await fs.mkdir(`${SR}/books/new-book-abc/deeper`, { recursive: true })
    await writeJson(`${SR}/books/new-book-abc/deeper/highlights.json`, { version: 1, highlights: [] })
    await fs.mkdir(`${L}/empty-shelf`)
    await sync.flush()
    expect(remoteJson(fake, '.smartreader/books/new-book-abc/deeper/highlights.json')).toEqual({ version: 1, highlights: [] })
    const folderCreates = fake.requests.filter(r => r.startsWith('POST /drive/v3/files'))
    expect(folderCreates).toHaveLength(3) // new-book-abc, deeper, empty-shelf
    await sync.pull()
    await writeJson(`${SR}/books/new-book-abc/deeper/highlights.json`, { version: 1, highlights: [1] })
    await sync.flush()
    expect(fake.requests.filter(r => r.startsWith('POST /drive/v3/files'))).toHaveLength(3)
  })

  it('remote change updates stat and fires onChange', async () => {
    const sync = await mounted()
    const changed = vi.fn()
    sync.onChange(changed)
    const p = `${L}/knowledge/prompts.jsonl`
    await fs.readFile(p)
    const st1 = await fs.stat(p)
    const line = JSON.stringify({ highlightId: seed.highlightId, question: 'Q?' }) + '\n'
    fake.putFile('knowledge/prompts.jsonl', new TextEncoder().encode(line))
    fake.putFile('new-shelf/new.epub', new TextEncoder().encode('PKbook'))
    expect(await sync.pull()).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed.mock.calls[0][0]).toEqual(expect.arrayContaining([p, `${L}/new-shelf/new.epub`]))
    const st2 = await fs.stat(p)
    expect(st2.mtimeMs).not.toBe(st1.mtimeMs)
    expect(st2.size).toBe(line.length)
    expect(await fs.readFile(p, 'utf8')).toBe(line)
    expect(await fs.readFile(`${L}/new-shelf/new.epub`, 'utf8')).toBe('PKbook')
    // same size, new content: stat still moves
    fake.putFile('knowledge/prompts.jsonl', new TextEncoder().encode(line.replace('Q?', 'R?')))
    await sync.pull()
    expect((await fs.stat(p)).mtimeMs).toBeGreaterThan(st2.mtimeMs)
    expect(await fs.readFile(p, 'utf8')).toContain('R?')
  })

  it('outbox replays after restart', async () => {
    const s1 = await mounted()
    fake.expireToken()
    await writeJson(`${SR}/fresh.json`, { from: 'closed tab' })
    await expect(s1.flush()).rejects.toBeInstanceOf(DriveAuthError)
    expect((await outbox.all()).map(i => i.path)).toEqual([`${SR}/fresh.json`])
    // "restart": a fresh VFS and DriveSync on the same persistent outbox
    fake.setToken('test-token')
    const vfs2 = new Vfs()
    setVfs(vfs2)
    const s2 = await mounted({ vfs: vfs2 })
    expect(JSON.parse(await fs.readFile(`${SR}/fresh.json`, 'utf8'))).toEqual({ from: 'closed tab' })
    await s2.flush()
    expect(remoteJson(fake, '.smartreader/fresh.json')).toEqual({ from: 'closed tab' })
    expect(await outbox.all()).toEqual([])
  })

  it('outbox replay merges when Drive moved on meanwhile', async () => {
    const s1 = await mounted()
    const p = `${SR}/review-log.jsonl`
    const remoteBefore = dec(fake.readFile('.smartreader/review-log.jsonl'))
    await fs.readFile(p)
    fake.expireToken()
    await fs.appendFile(p, '{"web":1}\n')
    await expect(s1.flush()).rejects.toBeInstanceOf(DriveAuthError)
    fake.setToken('test-token')
    fake.putFile('.smartreader/review-log.jsonl', new TextEncoder().encode(remoteBefore + '{"mac":1}\n'))
    const vfs2 = new Vfs()
    setVfs(vfs2)
    const s2 = await mounted({ vfs: vfs2 })
    await s2.flush()
    expect(dec(fake.readFile('.smartreader/review-log.jsonl'))).toBe(remoteBefore + '{"mac":1}\n{"web":1}\n')
    expect(await fs.readFile(p, 'utf8')).toBe(remoteBefore + '{"mac":1}\n{"web":1}\n')
  })

  it('401 pauses pushes, keeps outbox, resumes after token returns', async () => {
    const sync = await mounted()
    const authErr = vi.fn()
    sync.onAuthError(authErr)
    fake.expireToken()
    await writeJson(`${SR}/a.json`, { a: 1 })
    await expect(sync.flush()).rejects.toBeInstanceOf(DriveAuthError)
    await writeJson(`${SR}/b.json`, { b: 1 })
    await sync.pullIfStale(0) // swallowed
    await new Promise(r => setTimeout(r, 10))
    expect(authErr).toHaveBeenCalledTimes(1)
    expect(sync.pending()).toBe(2)
    expect((await outbox.all()).map(i => i.path).sort()).toEqual([`${SR}/a.json`, `${SR}/b.json`])
    fake.setToken('test-token')
    await sync.flush()
    expect(remoteJson(fake, '.smartreader/a.json')).toEqual({ a: 1 })
    expect(remoteJson(fake, '.smartreader/b.json')).toEqual({ b: 1 })
    expect(await outbox.all()).toEqual([])
    // a second expiry is a new pause and is reported again
    fake.expireToken()
    await writeJson(`${SR}/a.json`, { a: 2 })
    await expect(sync.flush()).rejects.toBeInstanceOf(DriveAuthError)
    expect(authErr).toHaveBeenCalledTimes(2)
    fake.setToken('test-token')
    await sync.pull() // a successful pull resumes pushes too
    await sync.flush()
    expect(remoteJson(fake, '.smartreader/a.json')).toEqual({ a: 2 })
  })

  it('merge keeps both sides\' highlights and review cards', async () => {
    const sync = await mounted()
    const slug = seed.books.find(b => b.id === seed.epubId)!.slug
    const hp = `${SR}/books/${slug}/highlights.json`
    const rp = `${SR}/review-state.json`
    const hl = JSON.parse(await fs.readFile(hp, 'utf8'))
    const rs = JSON.parse(await fs.readFile(rp, 'utf8'))
    const proto = hl.highlights[0]
    const mk = (id: string) => ({ ...proto, id, updatedAt: new Date().toISOString() })
    const card = rs.cards[seed.highlightId]

    fake.expireToken() // keep the local edits pending
    await writeJson(hp, { ...hl, highlights: [...hl.highlights, mk('h_web')] })
    await writeJson(rp, { ...rs, cards: { ...rs.cards, h_web: { ...card, reps: 0, last_review: null } } })
    await expect(sync.flush()).rejects.toBeInstanceOf(DriveAuthError)

    fake.setToken('test-token')
    const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2) + '\n')
    fake.putFile(`.smartreader/books/${slug}/highlights.json`, enc({ ...hl, highlights: [...hl.highlights, mk('h_mac')] }))
    fake.putFile('.smartreader/review-state.json', enc({ ...rs, cards: { ...rs.cards, [seed.wordId]: { ...rs.cards[seed.wordId], reps: 7, last_review: new Date().toISOString() } } }))

    expect(await sync.pull()).toBe(true)
    // the services see the merged data as soon as the pull returns
    expect(JSON.parse(await fs.readFile(hp, 'utf8')).highlights.map((h: { id: string }) => h.id)).toEqual(expect.arrayContaining(['h_web', 'h_mac']))
    expect(JSON.parse(await fs.readFile(rp, 'utf8')).cards[seed.wordId].reps).toBe(7)
    await sync.flush()
    const ids = remoteJson(fake, `.smartreader/books/${slug}/highlights.json`).highlights.map((h: { id: string }) => h.id)
    expect(ids).toEqual(expect.arrayContaining([seed.highlightId, 'h_web', 'h_mac']))
    const cards = remoteJson(fake, '.smartreader/review-state.json').cards
    expect(cards.h_web).toBeTruthy()
    expect(cards[seed.wordId].reps).toBe(7)
    expect(cards[seed.highlightId].reps).toBe(card.reps)
    // local VFS has the merged content too
    expect(JSON.parse(await fs.readFile(hp, 'utf8')).highlights.map((h: { id: string }) => h.id)).toEqual(expect.arrayContaining(['h_web', 'h_mac']))
  })

  it('unicode and quote names round-trip', async () => {
    const name = "Ünïcode 'q' #1.epub"
    const bytes = new Uint8Array(readFileSync(join(__dirname, '../fixtures/books/art-of-war.epub')))
    fake.putFile(name, bytes)
    const sync = await mounted()
    expect(vfs.entry(`${L}/${name}`)?.size).toBe(bytes.length)
    expect(Buffer.from(await fs.readFile(`${L}/${name}`)).equals(Buffer.from(bytes))).toBe(true)
    const dir = `${SR}/books/Ünïcode 'q' #1`
    await fs.mkdir(dir, { recursive: true })
    await writeJson(`${dir}/highlights.json`, { name })
    await sync.flush()
    expect(remoteJson(fake, `.smartreader/books/${"Ünïcode 'q' #1"}/highlights.json`)).toEqual({ name })
    fake.putFile(`.smartreader/books/Ünïcode 'q' #1/highlights.json`, new TextEncoder().encode('{"v":2}'))
    await sync.pull()
    expect(await fs.readFile(`${dir}/highlights.json`, 'utf8')).toBe('{"v":2}')
  })

  it('a JSON file that fails to parse is downloaded once more (BC9)', async () => {
    let served = 0
    const flaky: FakeDrive['fetch'] = async (input, init) => {
      const res = await fake.fetch(input, init)
      if (String(input).includes('alt=media') && served++ === 0) return new Response('{"trunc', { status: 200 })
      return res
    }
    await mounted({ drive: makeClient(flaky) })
    expect(JSON.parse(await fs.readFile(`${SR}/vocab.json`, 'utf8')).words).toHaveLength(1)
    expect(served).toBe(2)
  })

  it('a directory rename trashes the old files on Drive', async () => {
    const sync = await mounted()
    const slug = seed.books.find(b => b.id === seed.epubId)!.slug
    await fs.rename(`${SR}/books/${slug}`, `${SR}/books/renamed-slug`)
    await sync.flush()
    expect(remoteJson(fake, '.smartreader/books/renamed-slug/highlights.json').highlights[0].id).toBe(seed.highlightId)
    expect(() => fake.readFile(`.smartreader/books/${slug}/highlights.json`)).toThrow()
    expect(await sync.pull()).toBe(false)
    expect(vfs.entry(`${SR}/books/renamed-slug/highlights.json`)).toBeTruthy()
  })

  it('pushes are coalesced to the latest bytes', async () => {
    const sync = await mounted()
    for (let i = 0; i < 5; i++) await fs.writeFile(`${SR}/fresh.json`, JSON.stringify({ i }))
    await sync.flush()
    expect(remoteJson(fake, '.smartreader/fresh.json')).toEqual({ i: 4 })
    expect(fake.requests.filter(r => r.includes('/upload/')).length).toBeLessThanOrEqual(2)
  })

  it('an edit queued during an upload is based on that upload', async () => {
    let hook: (() => void) | null = null
    const hooked: FakeDrive['fetch'] = async (input, init) => {
      if (String(input).includes('/upload/') && hook) {
        const h = hook
        hook = null
        h()
      }
      return fake.fetch(input, init)
    }
    const sync = await mounted({ drive: makeClient(hooked) })
    const p = `${SR}/vocab.json`
    const v0 = JSON.parse(await fs.readFile(p, 'utf8'))
    const extra = { ...v0.words[0], id: 'w_tmp', updatedAt: new Date().toISOString() }
    // v1 adds a word; while v1 uploads, v2 removes it again
    hook = () => vfs.writeLocal(p, new TextEncoder().encode(JSON.stringify(v0)))
    vfs.writeLocal(p, new TextEncoder().encode(JSON.stringify({ ...v0, words: [...v0.words, extra] })))
    await sync.flush()
    expect(remoteJson(fake, '.smartreader/vocab.json').words.map((w: { id: string }) => w.id)).toEqual([seed.wordId])
    expect(JSON.parse(await fs.readFile(p, 'utf8')).words).toHaveLength(1)
  })

  it('remote trash drops the entry; a pending local edit survives and is recreated', async () => {
    const sync = await mounted()
    const api = makeClient()
    const kids = async (folder: string) => api.listChildren((await api.listChildren(fake.rootId)).find(f => f.name === folder)!.id)
    const prompts = (await kids('knowledge')).find(f => f.name === 'prompts.jsonl')!
    await api.trash(prompts.id)
    expect(await sync.pull()).toBe(true)
    expect(vfs.entry(`${L}/knowledge/prompts.jsonl`)).toBeUndefined()

    const vocab = (await kids('.smartreader')).find(f => f.name === 'vocab.json')!
    await fs.readFile(`${SR}/vocab.json`)
    fake.expireToken()
    await fs.writeFile(`${SR}/vocab.json`, '{"version":1,"words":[]}')
    await expect(sync.flush()).rejects.toBeInstanceOf(DriveAuthError)
    fake.setToken('test-token')
    // deleted for good (not trashed) on the other device: the update 404s and the file is created afresh
    await fake.fetch(`https://www.googleapis.com/drive/v3/files/${vocab.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer test-token' } })
    await sync.flush()
    expect(remoteJson(fake, '.smartreader/vocab.json')).toEqual({ version: 1, words: [] })
  })

  describe('no edit is lost around a merge', () => {
    const P = `${SR}/vocab.json`
    const encJ = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2) + '\n')
    const ids = (v: { words: Array<{ id: string }> }) => v.words.map(w => w.id).sort()
    const addWord = async (id: string) => {
      const v = JSON.parse(await fs.readFile(P, 'utf8'))
      v.words.push({ ...v.words[0], id, updatedAt: new Date().toISOString() })
      await writeJson(P, v)
    }

    // A local edit A is pending; Drive gets edit R from the "Mac" after our last pull.
    // `onMedia` runs on the first download after the setup, before its bytes are returned.
    async function setup(onMedia?: () => Promise<void>): Promise<DriveSync> {
      let hook: (() => Promise<void>) | undefined
      const hooked: FakeDrive['fetch'] = async (input, init) => {
        const res = await fake.fetch(input, init)
        if (hook && String(input).includes('alt=media')) {
          const h = hook
          hook = undefined
          await h()
        }
        return res
      }
      const sync = await mounted({ drive: makeClient(hooked) })
      const v0 = JSON.parse(await fs.readFile(P, 'utf8'))
      fake.expireToken()
      await addWord('w_A')
      await expect(sync.flush()).rejects.toBeInstanceOf(DriveAuthError)
      fake.setToken('test-token')
      fake.putFile('.smartreader/vocab.json', encJ({ ...v0, words: [...v0.words, { ...v0.words[0], id: 'w_R' }] }))
      hook = onMedia
      return sync
    }

    it('a remote edit made after the last pull is merged, not overwritten, by the push', async () => {
      const sync = await setup()
      await sync.flush()
      expect(ids(remoteJson(fake, '.smartreader/vocab.json'))).toEqual(['w_A', 'w_R', seed.wordId].sort())
      expect(await sync.pull()).toBe(false)
    })

    it('a local write during the merge download (push path) survives', async () => {
      const sync = await setup(() => addWord('w_B'))
      await sync.flush()
      expect(ids(remoteJson(fake, '.smartreader/vocab.json'))).toEqual(['w_A', 'w_B', 'w_R', seed.wordId].sort())
      expect(ids(JSON.parse(await fs.readFile(P, 'utf8')))).toEqual(['w_A', 'w_B', 'w_R', seed.wordId].sort())
    })

    it('a local write during the merge download (pull path) survives', async () => {
      const sync = await setup(() => addWord('w_B'))
      expect(await sync.pull()).toBe(true)
      await sync.flush()
      expect(ids(remoteJson(fake, '.smartreader/vocab.json'))).toEqual(['w_A', 'w_B', 'w_R', seed.wordId].sort())
      expect(ids(JSON.parse(await fs.readFile(P, 'utf8')))).toEqual(['w_A', 'w_B', 'w_R', seed.wordId].sort())
    })

    it('a failed merge download does not make the remote version look like our echo', async () => {
      const sync = await setup(async () => {
        throw new Error('download dropped')
      })
      await expect(sync.pull()).rejects.toThrow('download dropped')
      expect(await sync.pull()).toBe(true)
      expect(ids(JSON.parse(await fs.readFile(P, 'utf8')))).toEqual(['w_A', 'w_R', seed.wordId].sort())
    })
    // I1: a pull lands while a service is still downloading the version it is about to edit.
    async function racingPull(): Promise<DriveSync> {
      let hook: (() => Promise<void>) | undefined
      const hooked: FakeDrive['fetch'] = async (input, init) => {
        const res = await fake.fetch(input, init)
        if (hook && String(input).includes('alt=media')) {
          const h = hook
          hook = undefined
          await h()
        }
        return res
      }
      const sync = await mounted({ drive: makeClient(hooked) })
      const v0 = remoteJson(fake, '.smartreader/vocab.json')
      hook = async () => {
        fake.putFile('.smartreader/vocab.json', encJ({ ...v0, words: [...v0.words, { ...v0.words[0], id: 'w_R' }] }))
        expect(await sync.pull()).toBe(true)
      }
      return sync
    }

    it('an edit of bytes a racing pull replaced is merged, not pushed over the newer version', async () => {
      const sync = await racingPull()
      await addWord('w_A')
      await sync.flush()
      expect(ids(remoteJson(fake, '.smartreader/vocab.json'))).toEqual(['w_A', 'w_R', seed.wordId].sort())
      expect(ids(JSON.parse(await fs.readFile(P, 'utf8')))).toEqual(['w_A', 'w_R', seed.wordId].sort())
    })

    it('the same holds when another reader cached the newer version before the stale write', async () => {
      const sync = await racingPull()
      const stale = JSON.parse(await fs.readFile(P, 'utf8'))
      await fs.readFile(P) // someone else reads (and caches) the newer version
      stale.words.push({ ...stale.words[0], id: 'w_A', updatedAt: new Date().toISOString() })
      await writeJson(P, stale)
      await sync.flush()
      expect(ids(remoteJson(fake, '.smartreader/vocab.json'))).toEqual(['w_A', 'w_R', seed.wordId].sort())
    })
  })

  describe('twin names on Drive (I6b)', () => {
    const V = '.smartreader/vocab.json'
    const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))
    const local = async (p: string) => JSON.parse(await fs.readFile(`${L}/${p}`, 'utf8'))

    it('mount takes the newest of two same-name files, whichever is listed first', async () => {
      fake.addTwin(V, enc({ twin: 'newer' }), '2099-01-01T00:00:00.000Z')
      fake.addTwin('.smartreader/other.json', enc({ twin: 'newer' }), '2099-01-01T00:00:00.000Z')
      fake.addTwin('.smartreader/other.json', enc({ twin: 'older' }), '2000-01-01T00:00:00.000Z')
      await mounted()
      expect(await local(V)).toEqual({ twin: 'newer' })
      expect(await local('.smartreader/other.json')).toEqual({ twin: 'newer' })
    })

    it('a change to an older twin never replaces the newer one we use; a newer twin does', async () => {
      const sync = await mounted()
      const before = await local(V)
      fake.addTwin(V, enc({ twin: 'older' }), '2000-01-01T00:00:00.000Z')
      await sync.pull()
      expect(await local(V)).toEqual(before)
      fake.addTwin(V, enc({ twin: 'newer' }), '2099-01-01T00:00:00.000Z')
      await sync.pull()
      expect(await local(V)).toEqual({ twin: 'newer' })
    })

    it('when the file we use is trashed, a twin we passed over takes its place', async () => {
      const sync = await mounted()
      const ours = (await drive.listChildren((await drive.listChildren(fake.rootId)).find(f => f.name === '.smartreader')!.id)).find(f => f.name === 'vocab.json')!
      fake.addTwin(V, enc({ twin: 'older' }), '2000-01-01T00:00:00.000Z')
      await sync.pull()
      await drive.trash(ours.id)
      expect(await sync.pull()).toBe(true)
      expect(await local(V)).toEqual({ twin: 'older' })
    })

    it('a push of a file new here adopts the newest twin on Drive', async () => {
      const sync = await mounted()
      fake.addTwin('.smartreader/x.json', enc({ older: 1 }), '2000-01-01T00:00:00.000Z')
      fake.addTwin('.smartreader/x.json', enc({ newer: 1 }), '2099-01-01T00:00:00.000Z')
      await writeJson(`${SR}/x.json`, { a: 1 })
      await sync.flush()
      expect(await local('.smartreader/x.json')).toEqual({ a: 1, newer: 1 })
    })
  })

  it('a push to a file trashed on Drive since the last pull recreates it instead of editing the trashed copy', async () => {
    const sync = await mounted()
    const sr = (await drive.listChildren(fake.rootId)).find(f => f.name === '.smartreader')!
    const vocab = (await drive.listChildren(sr.id)).find(f => f.name === 'vocab.json')!
    await fs.readFile(`${SR}/vocab.json`)
    await drive.trash(vocab.id)
    await writeJson(`${SR}/vocab.json`, { version: 1, words: [] })
    await sync.flush()
    expect(remoteJson(fake, '.smartreader/vocab.json')).toEqual({ version: 1, words: [] })
  })

  it('a non-auth push failure keeps the outbox, is reported, and flush rejects instead of hanging', async () => {
    const sync = await mounted()
    const errs = vi.fn()
    sync.onSyncError(errs)
    fake.failNext(400)
    await writeJson(`${SR}/fresh.json`, { a: 1 })
    await expect(sync.flush()).rejects.toMatchObject({ status: 400 })
    expect(errs).toHaveBeenCalledTimes(1)
    expect((await outbox.all()).map(i => i.path)).toEqual([`${SR}/fresh.json`])
    await sync.flush() // retries at once
    expect(remoteJson(fake, '.smartreader/fresh.json')).toEqual({ a: 1 })
    expect(await outbox.all()).toEqual([])
  })

  it('pullIfStale swallows Drive errors but not programming errors', async () => {
    const sync = await mounted()
    fake.failNext(400)
    await expect(sync.pullIfStale(0)).resolves.toBeUndefined()
    const unmounted = new DriveSync(vfs, drive, outbox, fake.rootId)
    await expect(unmounted.pullIfStale(0)).rejects.toThrow(/before mount/)
  })
})
