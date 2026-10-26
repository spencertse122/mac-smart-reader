import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDefinition } from '../../src/main/dictionary/parse'
import { DictionaryService, type HelperRunner } from '../../src/main/dictionary/dictionaryService'

const SERENDIPITY = 'serendipity ser·en·dip·i·ty | ˌserənˈdipədē | noun the occurrence and development of events by chance in a happy or beneficial way: a fortunate stroke of serendipity | a series of small serendipities. ORIGIN 1754: coined by Horace Walpole, from Serendip.'
const RUNNING = 'running run·ning | ˈrəniNG | noun 1 the action or movement of a runner: he accounted for 31 touchdowns with his running and passing. • the sport of racing on foot: marathon running. 2 the management of a business. adjective [attributive] 1 (of water) flowing.'
const EPHEMERAL = 'ephemeral e·phem·er·al | əˈfem(ə)rəl | adjective lasting for a very short time: fashions are ephemeral. • (chiefly of plants) having a very short life cycle: ephemeral flowers. noun an ephemeral plant: spring ephemerals. DERIVATIVES ephemerality | əˌfem(ə)ˈralədē | noun ephemerally adverb'

describe('parseDefinition', () => {
  it('parses serendipity', () => {
    const e = parseDefinition(SERENDIPITY)
    expect(e.headword).toBe('serendipity')
    expect(e.pronunciation).toBe('ˌserənˈdipədē')
    expect(e.text.startsWith('noun the occurrence')).toBe(true)
    expect(e.text).toContain('a series of small serendipities.')
    expect(e.text).not.toContain('ORIGIN')
    expect(e.raw).toBe(SERENDIPITY)
  })
  it('parses running with sense and bullet breaks', () => {
    const e = parseDefinition(RUNNING)
    expect(e.headword).toBe('running')
    expect(e.pronunciation).toBe('ˈrəniNG')
    expect(e.text).toContain('passing.\n• the sport')
    expect(e.text).toContain('marathon running.\n2 the management')
    expect(e.text).toContain('business.\nadjective [attributive]')
  })
  it('parses ephemeral and cuts at DERIVATIVES (whose pipes are not the pronunciation)', () => {
    const e = parseDefinition(EPHEMERAL)
    expect(e.pronunciation).toBe('əˈfem(ə)rəl')
    expect(e.text).not.toContain('DERIVATIVES')
    expect(e.text).not.toContain('ephemerality')
    expect(e.text).toContain('ephemeral.\n• (chiefly')
    expect(e.text).toContain('flowers.\nnoun an ephemeral plant')
  })
  it('handles text without pipes', () => {
    const e = parseDefinition('hello  int. a greeting\n used often', 'hello')
    expect(e).toMatchObject({ headword: 'hello', pronunciation: null, text: 'int. a greeting used often' })
  })
  it('never throws on garbage', () => {
    for (const g of ['', '   ', '|', ' | | ', '\u0000\ud800', 'ORIGIN', 'a | b', 'x'.repeat(100000)]) {
      expect(() => parseDefinition(g, 'q')).not.toThrow()
    }
    expect(parseDefinition('', 'q').headword).toBe('q')
    expect(parseDefinition('onlyword', 'q')).toMatchObject({ headword: 'onlyword', text: 'onlyword' })
  })
})

describe('DictionaryService', () => {
  const helper = process.execPath // exists and is executable on every platform running tests
  const mk = (runner: HelperRunner, extra = {}) =>
    new DictionaryService({ helperPath: helper, platform: 'darwin', runner, env: {}, ...extra })

  it('reads the SR_DICT_STUB file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sr-dict-'))
    const stub = join(dir, 'stub.json')
    await writeFile(stub, JSON.stringify({ serendipity: SERENDIPITY }))
    const s = new DictionaryService({ helperPath: '/nope', env: { SR_DICT_STUB: stub } })
    const r = await s.lookup(' Serendipity ')
    expect(r.ok && r.entry.headword).toBe('serendipity')
    expect(await s.lookup('zzz')).toEqual({ ok: false, reason: 'not-found' })
    const bad = new DictionaryService({ helperPath: '/nope', env: { SR_DICT_STUB: join(dir, 'missing.json') } })
    expect(await bad.lookup('x')).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('is unavailable off macOS or without the helper', async () => {
    const never: HelperRunner = async () => { throw new Error('should not run') }
    expect(await mk(never, { platform: 'linux' }).lookup('word')).toEqual({ ok: false, reason: 'unavailable' })
    expect(await mk(never, { helperPath: '/definitely/missing/dict-lookup' }).lookup('word')).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('trims, limits the term, and passes it as a single argument', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const s = mk(async (file, args) => { calls.push({ file, args }); return { code: 0, stdout: SERENDIPITY } })
    expect((await s.lookup('  hello   world; rm -rf / ')).ok).toBe(true)
    await s.lookup('x'.repeat(200))
    const en = calls.filter(c => c.args[0] !== '--zh')
    expect(en[0].args).toEqual(['hello world; rm -rf /'])
    expect(en[1].args[0]).toHaveLength(64)
    expect(await s.lookup('   ')).toEqual({ ok: false, reason: 'not-found' })
    expect(en).toHaveLength(2)
    expect(calls.filter(c => c.args[0] === '--zh').every(c => c.args.length === 2)).toBe(true)
  })

  it('maps exit codes, caches, and never caches unavailable', async () => {
    let n = 0
    const s = mk(async () => { n++; return { code: 1, stdout: '' } })
    expect(await s.lookup('qqq')).toEqual({ ok: false, reason: 'not-found' })
    await s.lookup('QQQ')
    expect(n).toBe(1)
    const crash = mk(async () => ({ code: 2, stdout: '' }))
    expect(await crash.lookup('a')).toEqual({ ok: false, reason: 'unavailable' })
    const boom = mk(async () => { throw new Error('timeout') })
    expect(await boom.lookup('a')).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('DictionaryService Chinese', () => {
  const helper = process.execPath
  const OCD = 'mitigate | BrE ˈmɪtɪɡeɪt | transitive verb 缓和 huǎnhé ‹suffering›; 减轻 jiǎnqīng ‹effects›'
  const mk = (runner: HelperRunner, extra = {}) =>
    new DictionaryService({ helperPath: helper, platform: 'darwin', runner, env: {}, ...extra })
  const en = (head: string) => `${head} | ˈx | verb to lessen`

  it('adds zh to lookup and tries the headword before the queried term', async () => {
    const zhCalls: string[] = []
    const s = mk(async (_f, args) => {
      if (args[0] !== '--zh') return { code: 0, stdout: en('mitigate') }
      zhCalls.push(args[1])
      return args[1] === 'mitigate' ? { code: 0, stdout: OCD } : { code: 1, stdout: '' }
    })
    const r = await s.lookup('Mitigating')
    expect(r.ok && r.zh).toMatchObject({ status: 'ok', gloss: '缓和；减轻' })
    expect(zhCalls).toEqual(['mitigate'])
    const t = mk(async (_f, args) => {
      if (args[0] !== '--zh') return { code: 0, stdout: en('mitigate') }
      zhCalls.push(args[1])
      return args[1] === 'mitigating' ? { code: 0, stdout: OCD } : { code: 1, stdout: '' }
    })
    zhCalls.length = 0
    const r2 = await t.lookup('mitigating')
    expect(r2.ok && r2.zh.status).toBe('ok')
    expect(zhCalls).toEqual(['mitigate', 'mitigating'])
  })

  it('keeps a capitalised headword as is', async () => {
    const zhCalls: string[] = []
    const s = mk(async (_f, args) => {
      if (args[0] !== '--zh') return { code: 0, stdout: en('Paris') }
      zhCalls.push(args[1])
      return { code: 1, stdout: '' }
    })
    const r = await s.lookup('paris')
    expect(r.ok && r.zh).toEqual({ status: 'not-found' })
    expect(zhCalls).toEqual(['Paris', 'paris'])
  })

  it('follows a cross-reference once', async () => {
    const calls: string[] = []
    const s = mk(async (_f, args) => {
      calls.push(args[1])
      if (args[1] === 'nonetheless') return { code: 0, stdout: 'nonetheless | BrE x | adverb = nevertheless' }
      if (args[1] === 'nevertheless') return { code: 0, stdout: 'nevertheless | BrE x | adverb 然而 rán\'ér' }
      return { code: 1, stdout: '' }
    })
    expect(await s.lookupZh('nonetheless')).toMatchObject({ status: 'ok', gloss: '然而' })
    const loop = mk(async (_f, args) => ({ code: 0, stdout: `${args[1]} | BrE x | adverb = ${args[1] === 'a' ? 'b' : 'a'}` }))
    expect(await loop.lookupZh('a')).toEqual({ status: 'not-found' })
  })

  it('maps zh exit codes; caches ok and not-found only', async () => {
    let n = 0
    const nf = mk(async () => { n++; return { code: 1, stdout: '' } })
    expect(await nf.lookupZh('qqq')).toEqual({ status: 'not-found' })
    await nf.lookupZh('qqq')
    expect(n).toBe(1)
    let m = 0
    const un = mk(async () => { m++; return { code: 3, stdout: '' } })
    expect(await un.lookupZh('a')).toEqual({ status: 'unavailable' })
    await un.lookupZh('a')
    expect(m).toBe(2)
    expect(await mk(async () => ({ code: 2, stdout: '' })).lookupZh('a')).toEqual({ status: 'unavailable' })
    expect(await mk(async () => { throw new Error('x') }).lookupZh('a')).toEqual({ status: 'unavailable' })
    const never: HelperRunner = async () => { throw new Error('no') }
    expect(await mk(never, { platform: 'linux' }).lookupZh('a')).toEqual({ status: 'unavailable' })
    expect(await mk(never, { helperPath: '/missing/x' }).lookupZh('a')).toEqual({ status: 'unavailable' })
    const uz = mk(async (_f, a) => (a[0] === '--zh' ? { code: 3, stdout: '' } : { code: 0, stdout: en('word') }))
    const r = await uz.lookup('word')
    expect(r.ok && r.zh).toEqual({ status: 'unavailable' })
  })

  it('supports zh: stub keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sr-dict-'))
    const stub = join(dir, 'stub.json')
    await writeFile(stub, JSON.stringify({ mitigate: en('mitigate'), 'zh:mitigate': OCD }))
    const s = new DictionaryService({ helperPath: '/nope', env: { SR_DICT_STUB: stub } })
    const r = await s.lookup('Mitigate')
    expect(r.ok && r.zh).toMatchObject({ status: 'ok', gloss: '缓和；减轻' })
    expect(await s.lookupZh('Mitigate')).toMatchObject({ status: 'ok' })
    expect(await s.lookupZh('zzz')).toEqual({ status: 'not-found' })
    const off = join(dir, 'off.json')
    await writeFile(off, JSON.stringify({ mitigate: en('mitigate'), 'zh:mitigate': OCD, 'zh:__unavailable__': true }))
    const u = new DictionaryService({ helperPath: '/nope', env: { SR_DICT_STUB: off } })
    const r2 = await u.lookup('mitigate')
    expect(r2.ok && r2.zh).toEqual({ status: 'unavailable' })
  })
})
