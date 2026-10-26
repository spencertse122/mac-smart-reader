import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { DictEntry, DictLookupResult, ZhResult } from '../../shared/types'
import { parseDefinition } from './parse'
import { parseZh, zhCrossRef } from './parseZh'

export const TERM_MAX = 64
export const HELPER_TIMEOUT_MS = 5000

export type HelperRunner = (file: string, args: string[], opts: { timeout: number }) => Promise<{ code: number; stdout: string }>

// execFile with an argument array: the term never reaches a shell.
export const execRunner: HelperRunner = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: opts.timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      if (!err) return resolve({ code: 0, stdout })
      const code = (err as NodeJS.ErrnoException & { code?: unknown }).code
      if (typeof code === 'number') return resolve({ code, stdout: stdout ?? '' })
      reject(err)
    })
  })

export interface DictionaryOptions {
  helperPath: string
  platform?: NodeJS.Platform
  runner?: HelperRunner
  env?: NodeJS.ProcessEnv
}

type EnResult = { ok: true; entry: DictEntry } | { ok: false; reason: 'not-found' | 'unavailable' }
const UNAVAILABLE: ZhResult = { status: 'unavailable' }
const NOT_FOUND: ZhResult = { status: 'not-found' }

export class DictionaryService {
  private cache = new Map<string, EnResult>()
  private zhCache = new Map<string, ZhResult>()
  constructor(private opts: DictionaryOptions) {}

  private stubPath(): string | undefined {
    return (this.opts.env ?? process.env).SR_DICT_STUB || undefined
  }

  private clean(input: string): string {
    return input.replace(/\s+/g, ' ').trim().slice(0, TERM_MAX).trim()
  }

  async lookup(input: string): Promise<DictLookupResult> {
    const term = this.clean(input)
    if (!term) return { ok: false, reason: 'not-found' }
    const en = await this.lookupEn(term)
    if (!en.ok) return en
    const head = en.entry.headword.trim()
    const cand = head && /^\p{Lu}/u.test(head) ? head : head.toLowerCase()
    let zh: ZhResult = cand ? await this.lookupZh(cand) : NOT_FOUND
    if (zh.status === 'not-found' && cand !== term) zh = await this.lookupZh(term)
    return { ok: true, entry: en.entry, zh }
  }

  private async lookupEn(term: string): Promise<EnResult> {
    const key = term.toLowerCase()
    const stub = this.stubPath()
    if (stub) return this.fromStub(stub, term)
    const hit = this.cache.get(key)
    if (hit) return hit
    if (!(await this.helperUsable())) return { ok: false, reason: 'unavailable' }
    let result: EnResult
    try {
      const r = await (this.opts.runner ?? execRunner)(this.opts.helperPath, [term], { timeout: HELPER_TIMEOUT_MS })
      if (r.code === 0 && r.stdout.trim()) result = { ok: true, entry: parseDefinition(r.stdout, term) }
      else if (r.code === 0 || r.code === 1) result = { ok: false, reason: 'not-found' }
      else return { ok: false, reason: 'unavailable' }
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
    this.cache.set(key, result)
    return result
  }

  private async helperUsable(): Promise<boolean> {
    if ((this.opts.platform ?? process.platform) !== 'darwin') return false
    try {
      await access(this.opts.helperPath, constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  // Chinese-only lookup (Oxford Chinese Dictionary). Caches ok and not-found, never unavailable.
  async lookupZh(input: string): Promise<ZhResult> {
    const term = this.clean(input)
    if (!term) return NOT_FOUND
    const stub = this.stubPath()
    if (stub) return this.zhFromStub(stub, term)
    const hit = this.zhCache.get(term)
    if (hit) return hit
    if (!(await this.helperUsable())) return UNAVAILABLE
    const result = await this.zhResolve(term, raw => this.runZh(raw))
    if (result.status !== 'unavailable') this.zhCache.set(term, result)
    return result
  }

  private async runZh(term: string): Promise<string | null | undefined> {
    // string = raw text, null = no entry, undefined = unavailable
    try {
      const r = await (this.opts.runner ?? execRunner)(this.opts.helperPath, ['--zh', term], { timeout: HELPER_TIMEOUT_MS })
      if (r.code === 0) return r.stdout.trim() ? r.stdout : null
      if (r.code === 1) return null
      return undefined
    } catch {
      return undefined
    }
  }

  private async zhResolve(term: string, fetch: (term: string) => Promise<string | null | undefined>): Promise<ZhResult> {
    const once = async (t: string): Promise<{ r: ZhResult; raw: string | null }> => {
      const raw = await fetch(t)
      if (raw === undefined) return { r: UNAVAILABLE, raw: null }
      const p = raw === null ? null : parseZh(raw)
      return { r: p ? { status: 'ok', ...p } : NOT_FOUND, raw }
    }
    const first = await once(term)
    if (first.r.status !== 'not-found' || !first.raw) return first.r
    const target = zhCrossRef(first.raw)
    if (!target || target.toLowerCase() === term.toLowerCase()) return first.r
    return (await once(target)).r // followed once only
  }

  private async readStub(path: string): Promise<Record<string, unknown> | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    } catch {
      return null
    }
  }

  private async zhFromStub(path: string, term: string): Promise<ZhResult> {
    const map = await this.readStub(path)
    if (!map || map['zh:__unavailable__'] === true) return UNAVAILABLE
    return this.zhResolve(term, async t => {
      const v = [t, t.toLowerCase()].map(k => map[`zh:${k}`]).find(x => typeof x === 'string')
      return typeof v === 'string' ? v : null
    })
  }

  private async fromStub(path: string, term: string): Promise<EnResult> {
    const map = await this.readStub(path)
    if (!map) return { ok: false, reason: 'unavailable' }
    const raw = [term, term.toLowerCase()].map(k => map[k]).find(v => typeof v === 'string') as string | undefined
    return raw ? { ok: true, entry: parseDefinition(raw, term) } : { ok: false, reason: 'not-found' }
  }
}
