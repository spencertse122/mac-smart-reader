import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { DictLookupResult } from '../../shared/types'
import { parseDefinition } from './parse'

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

export class DictionaryService {
  private cache = new Map<string, DictLookupResult>()
  constructor(private opts: DictionaryOptions) {}

  async lookup(input: string): Promise<DictLookupResult> {
    const term = input.replace(/\s+/g, ' ').trim().slice(0, TERM_MAX).trim()
    if (!term) return { ok: false, reason: 'not-found' }
    const key = term.toLowerCase()
    const stub = (this.opts.env ?? process.env).SR_DICT_STUB
    if (stub) return this.fromStub(stub, term)
    const hit = this.cache.get(key)
    if (hit) return hit
    const platform = this.opts.platform ?? process.platform
    if (platform !== 'darwin') return { ok: false, reason: 'unavailable' }
    try {
      await access(this.opts.helperPath, constants.X_OK)
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
    let result: DictLookupResult
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

  private async fromStub(path: string, term: string): Promise<DictLookupResult> {
    try {
      const map = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
      const raw = [term, term.toLowerCase()].map(k => map[k]).find(v => typeof v === 'string') as string | undefined
      return raw ? { ok: true, entry: parseDefinition(raw, term) } : { ok: false, reason: 'not-found' }
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
  }
}
