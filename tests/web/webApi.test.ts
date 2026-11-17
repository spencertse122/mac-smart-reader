import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FakeDrive } from './fakeDrive'
import { downloadTree, macTool, seedFake, type SeedSummary } from './mirror'
import { createDriveClient } from '../../src/web/drive/client'
import { idbOutbox } from '../../src/web/sync/outbox'
import { idbBookCache } from '../../src/web/bookCache'
import { createWebApi, type WebApi } from '../../src/web/webApi'
import { getVfs } from '../../src/web/vfs/vfs'

type Dump = {
  books: Array<{ id: string; title: string; location: string | null; progress: number }>
  highlights: Record<string, Array<{ id: string; quote?: { exact: string } }>>
  vocab: Array<{ id: string }>
  reviewState: { cards: Record<string, unknown> } & Record<string, unknown>
  reviewLog: Array<{ highlightId: string }>
}

const memStorage = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

let fake: FakeDrive
let seed: SeedSummary
let api: WebApi
let n = 0
let prefix = 0
let folder: { id: string; name: string } | null

function makeApi(storage = memStorage(), now?: () => Date): WebApi {
  return createWebApi({
    drive: createDriveClient({ fetch: fake.fetch, getToken: () => 'test-token', sleep: async () => {} }),
    outboxFor: id => idbOutbox(`webapi-outbox-${prefix}-${id}`),
    pickFolder: async () => ({ id: fake.rootId, name: 'Books' }),
    savedFolder: () => folder,
    rememberFolder: f => void (folder = f),
    cache: idbBookCache(`webapi-books-${n}`),
    storage,
    autoPull: false,
    now
  })
}

function dumpFake(): Dump {
  const dir = mkdtempSync(join(tmpdir(), 'sr-dump-'))
  downloadTree(fake, dir)
  return macTool<Dump>('dump', dir)
}

beforeEach(async () => {
  prefix++
  fake = new FakeDrive()
  seed = seedFake(fake)
  folder = { id: fake.rootId, name: 'Books' }
  api = makeApi()
  const r = await api.library.open('/library')
  expect(JSON.stringify(r).slice(0, 300)).toContain('"ok":true')
})

describe('web api', () => {
  it("open lists the Mac's books with the Mac's ids and saved location", async () => {
    const books = await api.library.list()
    expect(books.map(b => b.id).sort()).toEqual(seed.books.map(b => b.id).sort())
    const epub = books.find(b => b.id === seed.epubId)!
    expect(epub.location).toBe(seed.location)
    expect(epub.progress).toBeCloseTo(0.12)
  })

  it('highlights.list shows the Mac highlight', async () => {
    expect((await api.highlights.list(seed.epubId)).map(h => h.id)).toContain(seed.highlightId)
  })

  it('review.queue includes the Mac highlight and the word card', async () => {
    expect((await api.review.queue()).map(c => c.highlightId)).toContain(seed.wordId)
    // the Mac rated its highlight 'good', so it is scheduled; a month later it is due
    const later = makeApi(memStorage(), () => new Date(Date.now() + 30 * 86_400_000))
    await later.library.open('/library')
    const ids = (await later.review.queue()).map(c => c.highlightId)
    expect(ids).toContain(seed.highlightId)
    expect(ids).toContain(seed.wordId)
    later.dispose()
  })

  it('readBook returns the bytes and caches them by driveId:md5', async () => {
    const b = seed.books.find(x => x.id === seed.epubId)!
    const r = await api.library.readBook(seed.epubId)
    expect(r.data.length).toBeGreaterThan(0)
    const downloads = () => fake.requests.filter(q => q.includes('alt=media')).length
    const before = downloads()
    const r2 = await api.library.readBook(seed.epubId)
    expect(downloads()).toBe(before)
    expect(r2.data.length).toBe(r.data.length)
    expect(r.name).toBe(b.path.split('/').pop())
  })

  it('readBook leaves no book bytes in the VFS (the IndexedDB cache serves repeat opens)', async () => {
    const b = seed.books.find(x => x.id === seed.epubId)!
    n++ // an empty book cache, so the read goes through the VFS
    const fresh = makeApi()
    await fresh.library.open('/library')
    const r = await fresh.library.readBook(seed.epubId)
    expect(r.data.length).toBeGreaterThan(0)
    expect(fake.requests.some(q => q.includes('alt=media'))).toBe(true)
    expect(getVfs().entry(`/library/${b.path}`)?.data).toBeUndefined()
    // .smartreader data is still kept after a read
    expect(getVfs().entry('/library/.smartreader/library.json')?.data).toBeTruthy()
  })

  it('rate on web → Mac services see the review-state change and the log line', async () => {
    const before = dumpFake()
    const events: string[] = []
    api.on.reviewChanged(() => events.push('review'))
    await api.review.rate(seed.highlightId, 'easy', 1500, 'highlight')
    expect(events).toContain('review')
    await api.sync()!.flush()
    const after = dumpFake()
    expect(after.reviewLog.length).toBe(before.reviewLog.length + 1)
    expect(after.reviewLog.at(-1)!.highlightId).toBe(seed.highlightId)
    expect(JSON.stringify(after.reviewState)).not.toBe(JSON.stringify(before.reviewState))
  })

  it('web edits survive a concurrent Mac write to the same file', async () => {
    const slug = seed.books.find(b => b.id === seed.epubId)!.slug
    const path = `.smartreader/books/${slug}/highlights.json`
    const h = await api.highlights.add(seed.epubId, {
      location: 'epubcfi(/6/10!/4/2/1:0)', quote: { exact: 'web quote', prefix: '', suffix: '' }, context: 'web quote',
      chapter: 'c2', position: 0.3, color: 'blue', note: null
    })
    // the Mac appends its own highlight to the same file on Drive before the web push lands
    const remote = JSON.parse(new TextDecoder().decode(fake.readFile(path)))
    remote.highlights.push({ ...remote.highlights[0], id: 'h_mac-second', quote: { ...remote.highlights[0].quote, exact: 'mac second' } })
    fake.putFile(path, new TextEncoder().encode(JSON.stringify(remote, null, 2)))
    await api.sync()!.flush()
    await api.sync()!.pull()
    const ids = (await api.highlights.list(seed.epubId)).map(x => x.id)
    expect(ids).toEqual(expect.arrayContaining([seed.highlightId, h.id, 'h_mac-second']))
    const d = dumpFake()
    expect(d.highlights[seed.epubId].map(x => x.id)).toEqual(expect.arrayContaining([seed.highlightId, h.id, 'h_mac-second']))
  })

  it('quiesce waits until an edit under way is in the persistent outbox (before a redirect sign-in)', async () => {
    const slug = seed.books.find(b => b.id === seed.epubId)!.slug
    fake.expireToken() // offline/expired: the edit stays queued
    void api.highlights.add(seed.epubId, {
      location: 'epubcfi(/6/10!/4/2/1:0)', quote: { exact: 'queued', prefix: '', suffix: '' }, context: 'queued',
      chapter: 'c2', position: 0.3, color: 'blue', note: null
    })
    await api.quiesce()
    const queued = await idbOutbox(`webapi-outbox-${prefix}-${fake.rootId}`).all()
    expect(queued.map(i => i.path)).toContain(`/library/.smartreader/books/${slug}/highlights.json`)
  })

  it('a failed folder switch leaves the previous library working', async () => {
    const b = createWebApi({
      drive: createDriveClient({ fetch: fake.fetch, getToken: () => 'test-token', sleep: async () => {} }),
      outboxFor: id => idbOutbox(`webapi-fail-${prefix}-${id}`),
      pickFolder: async () => ({ id: 'other', name: 'Other' }),
      savedFolder: () => folder,
      rememberFolder: f => void (folder = f),
      cache: idbBookCache(`webapi-books-fail-${prefix}`),
      storage: memStorage(),
      autoPull: false
    })
    expect((await b.library.open('/library')).ok).toBe(true)
    fake.failNext(401)
    await expect(b.library.chooseFolder()).rejects.toThrow()
    expect(folder!.id).toBe(fake.rootId)
    expect((await b.library.list()).length).toBe(seed.books.length)
    const h = await b.highlights.add(seed.epubId, {
      location: 'epubcfi(/6/10!/4/2/1:0)', quote: { exact: 'still works', prefix: '', suffix: '' }, context: 'x',
      chapter: 'c2', position: 0.3, color: 'blue', note: null
    })
    await b.sync()!.flush()
    expect(dumpFake().highlights[seed.epubId].map(x => x.id)).toContain(h.id)
    b.dispose()
  })

  it('pending edits of folder A are not pushed into folder B, and are pushed when A is remounted', async () => {
    const client = createDriveClient({ fetch: fake.fetch, getToken: () => 'test-token', sleep: async () => {} })
    fake.putFile('B/readme.txt', new TextEncoder().encode('b'))
    const bId = (await client.listChildren(fake.rootId)).find(f => f.name === 'B')!.id
    await idbOutbox(`webapi-outbox-${prefix}-${fake.rootId}`).put({ path: '/library/knowledge/pending.txt', data: new TextEncoder().encode('A'), baseMd5: null })
    folder = { id: bId, name: 'B' }
    const b = makeApi()
    expect((await b.library.open('/library')).ok).toBe(true)
    await b.sync()!.flush()
    expect(() => fake.readFile('knowledge/pending.txt')).toThrow()
    expect(() => fake.readFile('B/knowledge/pending.txt')).toThrow()
    b.dispose()
    folder = { id: fake.rootId, name: 'A' }
    const a = makeApi()
    expect((await a.library.open('/library')).ok).toBe(true)
    await a.sync()!.flush()
    expect(new TextDecoder().decode(fake.readFile('knowledge/pending.txt'))).toBe('A')
    a.dispose()
  })

  it('vocab.lookup returns unavailable', async () => {
    expect(await api.vocab.lookup('x')).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('platform is web', () => {
    expect(api.platform).toBe('web')
  })

  it('settings persist in localStorage', async () => {
    const storage = memStorage()
    const a = makeApi(storage)
    expect((await a.settings.update({ fontSize: 22, pomodoro: { workMin: 30 } as never })).fontSize).toBe(22)
    const b = makeApi(storage)
    const s = await b.settings.get()
    expect(s.fontSize).toBe(22)
    expect(s.pomodoro.workMin).toBe(30)
    expect(s.pomodoro.breakMin).toBe(5)
    expect(s.libraryPath).toBe('/library')
    expect(JSON.parse(storage.getItem('sr.web.settings')!).fontSize).toBe(22)
  })

  it('a folder without .smartreader opens and gets .smartreader/ and knowledge/ created', async () => {
    fake = new FakeDrive()
    fake.putFile('only.txt', new TextEncoder().encode('hi'))
    folder = { id: fake.rootId, name: 'Empty' }
    const a = makeApi()
    const r = await a.library.open('/library')
    expect(r.ok).toBe(true)
    await a.sync()!.flush()
    const dir = mkdtempSync(join(tmpdir(), 'sr-empty-'))
    downloadTree(fake, dir)
    expect(existsSync(join(dir, '.smartreader'))).toBe(true)
    expect(existsSync(join(dir, 'knowledge'))).toBe(true)
  })
})
