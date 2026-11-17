// Three-way merge of a file changed on this device and on Drive since the last sync (spec BC3).
// `base` is the last-synced text, or null when unknown (then it is a two-way merge favouring local).

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Obj = { [k: string]: Json }
// `undefined` = the key/item is absent on that side
type V = Json | undefined

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)

const isObj = (v: V): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function eq(a: V, b: V): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined || a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as Json[]
    return a.length === bb.length && a.every((x, i) => eq(x, bb[i]))
  }
  const ao = a as Obj
  const bo = b as Obj
  const ak = Object.keys(ao)
  return ak.length === Object.keys(bo).length && ak.every(k => k in bo && eq(ao[k], bo[k]))
}

// Whole-value pick: one-sided change takes that side; both changed → `tie(local, remote)`.
type Tie = (local: Json, remote: Json) => Json
const preferLocal: Tie = l => l

function pick(b: V, l: V, r: V, both: (l: V, r: V) => V = l => l): V {
  if (eq(l, r)) return l
  if (b !== undefined && eq(l, b)) return r
  if (b !== undefined && eq(r, b)) return l
  if (b === undefined && l === undefined) return r
  if (b === undefined && r === undefined) return l
  return both(l, r)
}

// A record (keyed map or id-array item) taken whole from one side.
const record = (b: V, l: V, r: V, tie: Tie): V =>
  pick(b, l, r, (ll, rr) => (ll === undefined ? rr : rr === undefined ? ll : tie(ll, rr)))

const later = (field: string): Tie => (l, r) => {
  const t = (v: Json) => {
    const x = isObj(v) && typeof v[field] === 'string' ? Date.parse(v[field] as string) : NaN
    return Number.isNaN(x) ? -Infinity : x
  }
  return t(r) > t(l) ? r : l
}

const idItems = (v: V): v is Obj[] => Array.isArray(v) && v.every(x => isObj(x) && typeof x.id === 'string')

function mergeById(b: V, l: Obj[], r: Obj[]): Json[] {
  const index = (v: V) => new Map((Array.isArray(v) ? (v as Obj[]) : []).map(x => [x.id as string, x]))
  const bm = index(b)
  const lm = index(l)
  const rm = index(r)
  const ids = [...lm.keys(), ...[...rm.keys()].filter(id => !lm.has(id))]
  const out: Json[] = []
  for (const id of ids) {
    const v = record(bm.get(id), lm.get(id), rm.get(id), later('updatedAt'))
    if (v !== undefined) out.push(v)
  }
  return out
}

type Rule = (b: V, l: V, r: V) => V

// Generic structural merge: objects key by key, id-arrays by id, other values local-if-changed else remote.
function merge(b: V, l: V, r: V, rules: Record<string, Rule> = {}): V {
  if (eq(l, r)) return l
  if (isObj(l) && isObj(r)) {
    const bo = isObj(b) ? b : undefined
    const out: Obj = {}
    for (const k of [...Object.keys(l), ...Object.keys(r).filter(k => !(k in l))]) {
      const rule = rules[k] ?? ((x: V, y: V, z: V) => merge(x, y, z))
      const v = rule(bo?.[k], l[k], r[k])
      if (v !== undefined) out[k] = v
    }
    return out
  }
  if (idItems(l) && idItems(r) && (l.length > 0 || r.length > 0)) return mergeById(b, l, r)
  return pick(b, l, r)
}

// Keyed map whose values are taken whole (e.g. review cards).
const keyedRecords = (tie: Tie): Rule => (b, l, r) => {
  if (!isObj(l) || !isObj(r)) return pick(b, l, r)
  const bo = isObj(b) ? b : undefined
  const out: Obj = {}
  for (const k of [...Object.keys(l), ...Object.keys(r).filter(k => !(k in l))]) {
    const v = record(bo?.[k], l[k], r[k], tie)
    if (v !== undefined) out[k] = v
  }
  return out
}

// A library book merges per field, with location+progress as one unit (a position is a pair).
const POS = '\u0000pos'
function mergeBook(b: V, l: V, r: V): V {
  if (!isObj(l) || !isObj(r)) return record(b, l, r, preferLocal)
  const fold = (v: V): V => {
    if (!isObj(v)) return v
    const { location, progress, ...rest } = v
    return { ...rest, [POS]: [location ?? null, progress ?? null] }
  }
  const merged = merge(fold(b), fold(l), fold(r)) as Obj
  const { [POS]: pos, ...rest } = merged
  const [location, progress] = pos as Json[]
  return { ...rest, location, progress }
}
const libraryBooks: Rule = (b, l, r) => {
  if (!isObj(l) || !isObj(r)) return pick(b, l, r)
  const bo = isObj(b) ? b : undefined
  const out: Obj = {}
  for (const k of [...Object.keys(l), ...Object.keys(r).filter(k => !(k in l))]) {
    const v = pick(bo?.[k], l[k], r[k], (ll, rr) => (ll === undefined ? rr : rr === undefined ? ll : mergeBook(bo?.[k], ll, rr)))
    if (v !== undefined) out[k] = v
  }
  return out
}

const RULES: Record<string, Record<string, Rule>> = {
  'review-state.json': { cards: keyedRecords(later('last_review')) },
  'library.json': { books: libraryBooks }
}

function parse(text: string | null): Json | undefined {
  if (text === null) return undefined
  try {
    return JSON.parse(text) as Json
  } catch {
    return undefined
  }
}

function mergeJsonl(base: string | null, local: string, remote: string): string {
  const lines = (s: string) => s.split('\n').filter(x => x.trim() !== '')
  const baseSet = new Set(base === null ? [] : lines(base))
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of [...lines(remote), ...lines(local).filter(x => !baseSet.has(x))]) {
    if (seen.has(x)) continue
    seen.add(x)
    out.push(x)
  }
  return out.length ? out.join('\n') + '\n' : ''
}

export function mergeFile(path: string, base: string | null, local: string, remote: string): string {
  const name = basename(path)
  if (name === 'highlights.md' || name === 'vocab.md') return local
  if (name.endsWith('.jsonl')) return mergeJsonl(base, local, remote)
  if (!name.endsWith('.json')) return base !== null && local === base ? remote : local
  const r = parse(remote)
  if (r === undefined) return local
  const l = parse(local)
  if (l === undefined) return remote
  const merged = merge(parse(base), l, r, RULES[name])
  if (eq(merged, l)) return local
  if (eq(merged, r)) return remote
  return JSON.stringify(merged, null, 2) + '\n'
}
