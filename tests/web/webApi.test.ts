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
let folder: { id: string; name: string } | null

function makeApi(storage = memStorage()): WebApi {
  return createWebApi({
    drive: createDriveClient({ fetch: fake.fetch, getToken: () => 'test-token', sleep: async () => {} }),
    outbox: idbOutbox(`webapi-outbox-${n++}`),
    pickFolder: async () => ({ id: fake.rootId, name: 'Books' }),
    savedFolder: () => folder,
    rememberFolder: f => void (folder = f),
    cache: idbBookCache(`webapi-books-${n}`),
    storage,
    autoPull: false
  })
}

function dumpFake(): Dump {
  const dir = mkdtempSync(join(tmpdir(), 'sr-dump-'))
  downloadTree(fake, dir)
  return macTool<Dump>('dump', dir)
}

beforeEach(async () => {
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
    const ids = (await api.review.queue()).map(c => c.highlightId)
    expect(ids).toContain(seed.wordId)
    // the Mac already rated its highlight 'good', so it is scheduled, not due; a fresh web highlight is queued
    expect(ids).not.toContain(seed.highlightId)
    const h = await api.highlights.add(seed.epubId, {
      location: 'epubcfi(/6/12!/4/2/1:0)', quote: { exact: 'fresh', prefix: '', suffix: '' }, context: 'fresh',
      chapter: 'c3', position: 0.4, color: 'green', note: null
    })
    expect((await api.review.queue()).map(c => c.highlightId)).toContain(h.id)
  })

  it('readBook returns the bytes and caches them by driveId:md5', async () => {
    const b = seed.books.find(x => x.id === seed.epubId)!
    const r = await api.library.readBook(seed.epubId)
    expect(r.data.length).toBeGreaterThan(0)
    const r2 = await api.library.readBook(seed.epubId)
    expect(r2.data.length).toBe(r.data.length)
    expect(r.name).toBe(b.path.split('/').pop())
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

  it('web edits survive a concurrent Mac write', async () => {
    const h = await api.highlights.add(seed.epubId, {
      location: 'epubcfi(/6/10!/4/2/1:0)', quote: { exact: 'web quote', prefix: '', suffix: '' }, context: 'web quote',
      chapter: 'c2', position: 0.3, color: 'blue', note: null
    })
    // Mac side rewrites review-state.json on Drive before the web push
    const path = '.smartreader/review-state.json'
    const state = JSON.parse(new TextDecoder().decode(fake.readFile(path)))
    state.cards = { ...state.cards, 'mac-card': { macOnly: true } }
    fake.putFile(path, new TextEncoder().encode(JSON.stringify(state)))
    await api.sync()!.flush()
    await api.sync()!.pull()
    const d = dumpFake()
    expect(d.highlights[seed.epubId].map(x => x.id)).toEqual(expect.arrayContaining([seed.highlightId, h.id]))
    expect(JSON.stringify(d.reviewState)).toContain('mac-card')
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
