import { DriveAuthError, DriveError, FOLDER_MIME, type DriveFile } from './types'

export { DriveAuthError, DriveError, FOLDER_MIME }
export type { DriveFile }

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type DriveChange = { fileId: string; removed: boolean; file?: DriveFile }

export type DriveClient = {
  listChildren(folderId: string): Promise<DriveFile[]>
  get(id: string): Promise<DriveFile>
  download(id: string, range?: [number, number], onProgress?: (loaded: number, total: number) => void): Promise<Uint8Array>
  createFolder(name: string, parentId: string): Promise<DriveFile>
  createFile(name: string, parentId: string, data: Uint8Array): Promise<DriveFile>
  updateFile(id: string, data: Uint8Array): Promise<DriveFile>
  findFoldersNamed(name: string): Promise<DriveFile[]>
  startPageToken(): Promise<string>
  changes(token: string): Promise<{ changes: DriveChange[]; newStartPageToken: string }>
}

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
// Exported so the fake Drive can reject any request that deviates from these exact strings.
export const FILE_FIELDS = 'id,name,mimeType,size,md5Checksum,modifiedTime,version,parents'
export const LIST_FIELDS = `nextPageToken,files(${FILE_FIELDS})`
export const CHANGE_FILE_FIELDS = 'id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed'
export const CHANGES_FIELDS = `newStartPageToken,nextPageToken,changes(fileId,removed,file(${CHANGE_FILE_FIELDS}))`
const MAX_RETRIES = 4

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function createDriveClient(opts: {
  fetch: FetchFn
  getToken: () => string | Promise<string>
  sleep?: (ms: number) => Promise<void>
}): DriveClient {
  const sleep = opts.sleep ?? defaultSleep

  async function isRateLimit403(res: Response): Promise<boolean> {
    if (res.status !== 403) return false
    try {
      const body = (await res.clone().json()) as { error?: { errors?: Array<{ reason?: string }> } }
      return !!body.error?.errors?.some((e) => e.reason === 'rateLimitExceeded' || e.reason === 'userRateLimitExceeded')
    } catch {
      return false
    }
  }

  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const headers = { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${await opts.getToken()}` }
      let res: Response
      try {
        res = await opts.fetch(url, { ...init, headers })
      } catch (e) {
        // fetch rejects with TypeError when the network drops (common on mobile)
        if (!(e instanceof TypeError) || attempt >= MAX_RETRIES) throw e
        await sleep(Math.min(250 * 2 ** attempt, 30_000))
        continue
      }
      if (res.status === 401) throw new DriveAuthError()
      if (res.ok) return res
      const retryable = res.status === 429 || res.status >= 500 || (await isRateLimit403(res))
      if (!retryable || attempt >= MAX_RETRIES) throw new DriveError(res.status)
      await sleep(Math.min(250 * 2 ** attempt, 30_000))
    }
  }

  const json = async <T>(url: string, init?: RequestInit): Promise<T> => (await request(url, init)).json() as Promise<T>

  const qs = (p: Record<string, string>) => new URLSearchParams(p).toString()

  async function listAll(q: string): Promise<DriveFile[]> {
    const out: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const params: Record<string, string> = {
        q,
        fields: LIST_FIELDS,
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true'
      }
      if (pageToken) params.pageToken = pageToken
      const page = await json<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files?${qs(params)}`)
      out.push(...page.files)
      pageToken = page.nextPageToken
    } while (pageToken)
    return out
  }

  const fileQs = qs({ fields: FILE_FIELDS, supportsAllDrives: 'true' })

  return {
    listChildren: (folderId) => listAll(`'${esc(folderId)}' in parents and trashed=false`),

    findFoldersNamed: (name) => listAll(`name='${esc(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`),

    get: (id) => json<DriveFile>(`${API}/files/${encodeURIComponent(id)}?${fileQs}`),

    async download(id, range, onProgress) {
      const headers: Record<string, string> = {}
      if (range) headers.Range = `bytes=${range[0]}-${range[1]}`
      const res = await request(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers })
      const total = Number(res.headers.get('content-length') ?? 0)
      if (!onProgress || !res.body) {
        const buf = new Uint8Array(await res.arrayBuffer())
        onProgress?.(buf.length, total || buf.length)
        return buf
      }
      const chunks: Uint8Array[] = []
      let loaded = 0
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.length
        onProgress(loaded, total || loaded)
      }
      const out = new Uint8Array(loaded)
      let off = 0
      for (const c of chunks) {
        out.set(c, off)
        off += c.length
      }
      return out
    },

    createFolder: (name, parentId) =>
      json<DriveFile>(`${API}/files?${fileQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] })
      }),

    createFile(name, parentId, data) {
      const boundary = `sr-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
      const enc = new TextEncoder()
      const head = enc.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${JSON.stringify({ name, parents: [parentId] })}\r\n` +
          `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`
      )
      const tail = enc.encode(`\r\n--${boundary}--`)
      const body = new Uint8Array(head.length + data.length + tail.length)
      body.set(head, 0)
      body.set(data, head.length)
      body.set(tail, head.length + data.length)
      return json<DriveFile>(`${UPLOAD}/files?${qs({ uploadType: 'multipart', fields: FILE_FIELDS, supportsAllDrives: 'true' })}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: body as BodyInit
      })
    },

    updateFile: (id, data) =>
      json<DriveFile>(
        `${UPLOAD}/files/${encodeURIComponent(id)}?${qs({ uploadType: 'media', fields: FILE_FIELDS, supportsAllDrives: 'true' })}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: data as BodyInit }
      ),

    async startPageToken() {
      const r = await json<{ startPageToken: string }>(`${API}/changes/startPageToken?${qs({ supportsAllDrives: 'true' })}`)
      return r.startPageToken
    },

    async changes(token) {
      const out: DriveChange[] = []
      let pageToken = token
      for (;;) {
        const params = qs({
          pageToken,
          fields: CHANGES_FIELDS,
          includeRemoved: 'true',
          restrictToMyDrive: 'false',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
          pageSize: '1000'
        })
        const page = await json<{ changes: DriveChange[]; nextPageToken?: string; newStartPageToken?: string }>(`${API}/changes?${params}`)
        // shared-drive change entries can lack fileId; nothing to apply for them
        out.push(...page.changes.filter((c) => c.fileId))
        if (page.nextPageToken) pageToken = page.nextPageToken
        else return { changes: out, newStartPageToken: page.newStartPageToken ?? pageToken }
      }
    }
  }
}
