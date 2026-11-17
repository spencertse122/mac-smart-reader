// In-memory Google Drive v3 stand-in. Plain Node/TS: used by vitest and by Playwright (via page.route).
import { createHash } from 'crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { CHANGES_FIELDS, FILE_FIELDS, LIST_FIELDS } from '../../src/web/drive/client'

const FOLDER = 'application/vnd.google-apps.folder'
const PAGE = 100

type Meta = {
  id: string
  name: string
  mimeType: string
  size?: string
  md5Checksum?: string
  modifiedTime: string
  version: string
  parents: string[]
  trashed: boolean
}
type Entry = { meta: Meta; data?: Uint8Array }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const unq = (s: string) => s.replace(/\\(.)/g, '$1')

export class FakeDrive {
  rootId = 'root-folder'
  requests: string[] = []
  private entries = new Map<string, Entry>()
  private log: string[] = []
  private nextId = 1
  private token: string | null = 'test-token'
  private failures: Array<{ status: number; reason?: string }> = []

  constructor() {
    this.entries.set(this.rootId, { meta: this.mk('My Drive', FOLDER, []) })
    this.entries.get(this.rootId)!.meta.id = this.rootId
  }

  failNext(status: number, reason?: string) { this.failures.push({ status, reason }) }
  expireToken() { this.token = null }
  setToken(t: string) { this.token = t }

  private mk(name: string, mimeType: string, parents: string[]): Meta {
    return { id: `id${this.nextId++}`, name, mimeType, modifiedTime: new Date().toISOString(), version: '1', parents, trashed: false }
  }

  private setData(e: Entry, data: Uint8Array) {
    e.data = data
    e.meta.size = String(data.length)
    e.meta.md5Checksum = createHash('md5').update(data).digest('hex')
    e.meta.modifiedTime = new Date().toISOString()
    e.meta.version = String(Number(e.meta.version) + 1)
  }

  private child(parentId: string, name: string, folder?: boolean): Entry | undefined {
    for (const e of this.entries.values()) {
      if (e.meta.parents[0] === parentId && e.meta.name === name && !e.meta.trashed && (folder === undefined || (e.meta.mimeType === FOLDER) === folder)) return e
    }
  }

  private addFolder(name: string, parentId: string): Entry {
    const e: Entry = { meta: this.mk(name, FOLDER, [parentId]) }
    this.entries.set(e.meta.id, e)
    this.log.push(e.meta.id)
    return e
  }

  private ensureDir(parts: string[], parentId: string): string {
    let id = parentId
    for (const p of parts) id = (this.child(id, p, true) ?? this.addFolder(p, id)).meta.id
    return id
  }

  putFile(path: string, data: Uint8Array) {
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()!
    const parent = this.ensureDir(parts, this.rootId)
    const existing = this.child(parent, name, false)
    if (existing) {
      this.setData(existing, data)
      this.log.push(existing.meta.id)
      return
    }
    const e: Entry = { meta: this.mk(name, 'application/octet-stream', [parent]) }
    this.setData(e, data)
    this.entries.set(e.meta.id, e)
    this.log.push(e.meta.id)
  }

  // A second file of the same name in the same folder (Drive allows it), optionally with a set modifiedTime.
  addTwin(path: string, data: Uint8Array, modifiedTime?: string): string {
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()!
    const e: Entry = { meta: this.mk(name, 'application/octet-stream', [this.ensureDir(parts, this.rootId)]) }
    this.setData(e, data)
    if (modifiedTime) e.meta.modifiedTime = modifiedTime
    this.entries.set(e.meta.id, e)
    this.log.push(e.meta.id)
    return e.meta.id
  }

  readFile(path: string): Uint8Array {
    const parts = path.split('/').filter(Boolean)
    let id = this.rootId
    let e: Entry | undefined
    for (const p of parts) {
      e = this.child(id, p)
      if (!e) throw new Error(`FakeDrive: no such path ${path}`)
      id = e.meta.id
    }
    if (!e?.data) throw new Error(`FakeDrive: not a file ${path}`)
    return e.data
  }

  seedFromDir(localDir: string, parentId: string = this.rootId) {
    for (const name of readdirSync(localDir)) {
      const p = join(localDir, name)
      if (statSync(p).isDirectory()) {
        const dir = this.child(parentId, name, true) ?? this.addFolder(name, parentId)
        this.seedFromDir(p, dir.meta.id)
      } else {
        const e: Entry = { meta: this.mk(name, 'application/octet-stream', [parentId]) }
        this.setData(e, readFileSync(p))
        this.entries.set(e.meta.id, e)
        this.log.push(e.meta.id)
      }
    }
  }

  // Writes the live (non-trashed) tree under the root into a real directory.
  writeTree(dir: string, parentId: string = this.rootId) {
    mkdirSync(dir, { recursive: true })
    for (const e of this.entries.values()) {
      if (e.meta.parents[0] !== parentId || e.meta.trashed) continue
      if (e.meta.mimeType === FOLDER) this.writeTree(join(dir, e.meta.name), e.meta.id)
      else writeFileSync(join(dir, e.meta.name), e.data ?? new Uint8Array())
    }
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : undefined
    const url = new URL(req ? req.url : String(input))
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers ?? req?.headers)
    let body: Uint8Array | undefined
    if (init?.body != null) body = typeof init.body === 'string' ? new TextEncoder().encode(init.body) : new Uint8Array(init.body as ArrayBufferLike)
    else if (req && method !== 'GET') body = new Uint8Array(await req.arrayBuffer())
    this.requests.push(`${method} ${url.pathname}${url.search}`)

    const fail = this.failures.shift()
    if (fail) return json(fail.status, { error: { code: fail.status, ...(fail.reason ? { errors: [{ reason: fail.reason }] } : {}) } })
    if (this.token === null || headers.get('Authorization') !== `Bearer ${this.token}`) return json(401, { error: { code: 401 } })

    const path = url.pathname
    const sp = url.searchParams
    let m: RegExpMatchArray | null

    const bad = this.validate(method, path, sp)
    if (bad) return json(400, { error: { code: 400, message: `FakeDrive: ${bad}` } })

    if (method === 'GET' && path === '/drive/v3/files') return this.list(sp)
    if (method === 'GET' && path === '/drive/v3/changes/startPageToken') return json(200, { startPageToken: String(this.log.length) })
    if (method === 'GET' && path === '/drive/v3/changes') return this.changes(sp)
    if (method === 'POST' && path === '/drive/v3/files') {
      const md = JSON.parse(new TextDecoder().decode(body))
      // like real Drive: only an explicit folder mimeType makes a folder; otherwise an empty plain file
      let e: Entry
      if (md.mimeType === FOLDER) e = this.addFolder(md.name, md.parents?.[0] ?? this.rootId)
      else {
        e = { meta: this.mk(md.name, md.mimeType ?? 'application/octet-stream', [md.parents?.[0] ?? this.rootId]) }
        this.setData(e, new Uint8Array())
        this.entries.set(e.meta.id, e)
        this.log.push(e.meta.id)
      }
      return json(200, e.meta)
    }
    if (method === 'POST' && path === '/upload/drive/v3/files') {
      const { md, media } = parseMultipart(body!, headers.get('Content-Type') ?? '')
      const e: Entry = { meta: this.mk(md.name, md.mimeType ?? 'application/octet-stream', [md.parents?.[0] ?? this.rootId]) }
      this.setData(e, media)
      this.entries.set(e.meta.id, e)
      this.log.push(e.meta.id)
      return json(200, e.meta)
    }
    if ((m = path.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)) && method === 'PATCH') {
      const e = this.entries.get(decodeURIComponent(m[1]))
      if (!e) return json(404, { error: { code: 404 } })
      this.setData(e, body ?? new Uint8Array())
      this.log.push(e.meta.id)
      return json(200, e.meta)
    }
    if ((m = path.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
      const e = this.entries.get(decodeURIComponent(m[1]))
      if (!e) return json(404, { error: { code: 404 } })
      if (method === 'PATCH') {
        const patch = JSON.parse(new TextDecoder().decode(body))
        if (typeof patch.trashed === 'boolean') e.meta.trashed = patch.trashed
        if (typeof patch.name === 'string') e.meta.name = patch.name
        e.meta.modifiedTime = new Date().toISOString()
        this.log.push(e.meta.id)
        return json(200, e.meta)
      }
      if (method === 'DELETE') {
        this.entries.delete(e.meta.id)
        this.log.push(e.meta.id)
        return new Response(null, { status: 204 })
      }
      if (method === 'GET') {
        if (sp.get('alt') !== 'media') return json(200, e.meta)
        const data = e.data ?? new Uint8Array()
        const r = headers.get('Range')?.match(/^bytes=(\d+)-(\d*)$/)
        if (r) {
          const a = Number(r[1])
          const b = Math.min(r[2] === '' ? data.length - 1 : Number(r[2]), data.length - 1)
          const slice = data.slice(a, b + 1)
          return new Response(slice as BodyInit, {
            status: 206,
            headers: { 'Content-Length': String(slice.length), 'Content-Range': `bytes ${a}-${b}/${data.length}` }
          })
        }
        return new Response(data as BodyInit, { status: 200, headers: { 'Content-Length': String(data.length) } })
      }
    }
    return json(404, { error: { code: 404, message: `FakeDrive: unhandled ${method} ${path}` } })
  }

  // Reject requests that would misbehave on real Drive: wrong fields, missing shared-drive flags, wrong uploadType.
  private validate(method: string, path: string, sp: URLSearchParams): string | null {
    const need = (exp: Record<string, string>) => {
      for (const [k, v] of Object.entries(exp)) if (sp.get(k) !== v) return `${k} must be ${v}, got ${sp.get(k)}`
      return null
    }
    const all = { supportsAllDrives: 'true' }
    if (path === '/drive/v3/files' && method === 'GET') return need({ ...all, includeItemsFromAllDrives: 'true', fields: LIST_FIELDS })
    if (path === '/drive/v3/changes/startPageToken') return need(all)
    if (path === '/drive/v3/changes')
      return need({ ...all, includeItemsFromAllDrives: 'true', includeRemoved: 'true', restrictToMyDrive: 'false', pageSize: '1000', fields: CHANGES_FIELDS })
    if (path === '/drive/v3/files') return need({ ...all, fields: FILE_FIELDS })
    if (path === '/upload/drive/v3/files') return need({ ...all, uploadType: 'multipart', fields: FILE_FIELDS })
    if (path.startsWith('/upload/drive/v3/files/')) return need({ ...all, uploadType: 'media', fields: FILE_FIELDS })
    if (path.startsWith('/drive/v3/files/'))
      return sp.get('alt') === 'media' ? need(all) : need({ ...all, fields: FILE_FIELDS })
    return null
  }

  private list(sp: URLSearchParams): Response {
    const q = sp.get('q') ?? ''
    const Q = "'((?:\\\\.|[^'\\\\])*)'"
    let match: (e: Entry) => boolean
    let m: RegExpMatchArray | null
    if ((m = q.match(new RegExp(`^${Q} in parents and trashed=false$`)))) {
      // like real Drive, 'root' names the top of My Drive
      const id = unq(m[1]) === 'root' ? this.rootId : unq(m[1])
      match = (e) => e.meta.parents[0] === id && !e.meta.trashed
    } else if ((m = q.match(new RegExp(`^name=${Q} and mimeType='${FOLDER}' and trashed=false$`)))) {
      const name = unq(m[1])
      match = (e) => e.meta.name === name && e.meta.mimeType === FOLDER && !e.meta.trashed
    } else return json(400, { error: { code: 400, message: `FakeDrive: unsupported q ${q}` } })
    const all = [...this.entries.values()].filter(match).map((e) => e.meta)
    const start = Number(sp.get('pageToken') ?? 0)
    const page = all.slice(start, start + PAGE)
    const next = start + PAGE < all.length ? String(start + PAGE) : undefined
    return json(200, { files: page, ...(next ? { nextPageToken: next } : {}) })
  }

  private changes(sp: URLSearchParams): Response {
    const start = Number(sp.get('pageToken'))
    const end = Math.min(start + PAGE, this.log.length)
    const changes = this.log.slice(start, end).map((fileId) => {
      const e = this.entries.get(fileId)
      return e ? { fileId, removed: false, file: e.meta } : { fileId, removed: true }
    })
    return json(200, end < this.log.length ? { changes, nextPageToken: String(end) } : { changes, newStartPageToken: String(end) })
  }
}

function parseMultipart(body: Uint8Array, contentType: string): { md: any; media: Uint8Array } {
  const boundary = contentType.match(/boundary=(.+)$/)![1]
  const buf = Buffer.from(body)
  const delim = Buffer.from(`--${boundary}`)
  const parts: Buffer[] = []
  let pos = buf.indexOf(delim)
  while (pos !== -1) {
    const from = pos + delim.length
    const next = buf.indexOf(delim, from)
    if (next === -1) break
    // each part is "\r\n<headers>\r\n\r\n<content>\r\n" up to the next delimiter
    const part = buf.subarray(from + 2, next - 2)
    parts.push(part)
    pos = next
  }
  const split = (p: Buffer) => p.subarray(p.indexOf('\r\n\r\n') + 4)
  return { md: JSON.parse(split(parts[0]).toString('utf8')), media: new Uint8Array(split(parts[1])) }
}
