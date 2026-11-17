import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createDriveClient } from '../../src/web/drive/client'
import { DriveAuthError, FOLDER_MIME } from '../../src/web/drive/types'
import { FakeDrive } from './fakeDrive'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

function setup() {
  const drive = new FakeDrive()
  const client = createDriveClient({ fetch: drive.fetch, getToken: () => 'test-token', sleep: async () => {} })
  return { drive, client }
}

describe('drive client', () => {
  it('lists all pages', async () => {
    const { drive, client } = setup()
    for (let i = 0; i < 250; i++) drive.putFile(`f${i}.txt`, enc(String(i)))
    const files = await client.listChildren(drive.rootId)
    expect(files).toHaveLength(250)
    expect(new Set(files.map((f) => f.id)).size).toBe(250)
  })

  it('escapes quotes in q', async () => {
    const { drive, client } = setup()
    const f = await client.createFolder(`Spencer's "Books"`, drive.rootId)
    await client.createFolder('Other', drive.rootId)
    const found = await client.findFoldersNamed(`Spencer's "Books"`)
    expect(found.map((x) => x.id)).toEqual([f.id])
    const back = await client.createFolder('a\\b', drive.rootId)
    expect((await client.findFoldersNamed('a\\b')).map((x) => x.id)).toEqual([back.id])
  })

  it('download honours Range', async () => {
    const { drive, client } = setup()
    const local = readFileSync(join(__dirname, '..', '..', 'package.json'))
    drive.putFile('book.bin', local)
    const [file] = await client.listChildren(drive.rootId)
    const part = await client.download(file.id, [0, 9])
    expect(Buffer.from(part)).toEqual(local.subarray(0, 10))
    expect(drive.requests.some((r) => r.includes('alt=media'))).toBe(true)
  })

  it('create then update changes md5', async () => {
    const { drive, client } = setup()
    const a = await client.createFile('a.txt', drive.rootId, enc('one'))
    expect(a.md5Checksum).toMatch(/^[0-9a-f]{32}$/)
    expect(a.size).toBe('3')
    const b = await client.updateFile(a.id, enc('three'))
    expect(b.md5Checksum).not.toBe(a.md5Checksum)
    expect(b.size).toBe('5')
    expect(dec(drive.readFile('a.txt'))).toBe('three')
    expect((await client.get(a.id)).md5Checksum).toBe(b.md5Checksum)
  })

  it('401 throws DriveAuthError', async () => {
    const { drive, client } = setup()
    drive.expireToken()
    await expect(client.listChildren(drive.rootId)).rejects.toBeInstanceOf(DriveAuthError)
    drive.setToken('test-token')
    await expect(client.listChildren(drive.rootId)).resolves.toEqual([])
  })

  it('retries 5xx then succeeds, gives up after 4 retries', async () => {
    const { drive } = setup()
    const sleeps: number[] = []
    const client = createDriveClient({ fetch: drive.fetch, getToken: () => 'test-token', sleep: async (ms) => { sleeps.push(ms) } })
    drive.failNext(503)
    await client.listChildren(drive.rootId)
    expect(sleeps).toEqual([250])
    for (let i = 0; i < 5; i++) drive.failNext(500)
    await expect(client.listChildren(drive.rootId)).rejects.toMatchObject({ status: 500 })
    expect(sleeps.slice(1)).toEqual([250, 500, 1000, 2000])
  })

  it('changes reports create/update/trash', async () => {
    const { drive, client } = setup()
    drive.putFile('x.txt', enc('1'))
    const t0 = await client.startPageToken()
    drive.putFile('y/z.txt', enc('2'))
    drive.putFile('x.txt', enc('11'))
    const [x] = (await client.listChildren(drive.rootId)).filter((f) => f.name === 'x.txt')
    await drive.fetch(`https://www.googleapis.com/drive/v3/files/${x.id}`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    })
    const r = await client.changes(t0)
    const names = r.changes.map((c) => `${c.file?.name}:${c.file?.trashed ?? false}`)
    expect(names).toContain('y:false')
    expect(names).toContain('z.txt:false')
    expect(names).toContain('x.txt:true')
    expect(r.changes.every((c) => !c.removed)).toBe(true)
    expect(r.newStartPageToken).not.toBe(t0)
    expect((await client.changes(r.newStartPageToken)).changes).toEqual([])
  })

  it('changes follows nextPageToken', async () => {
    const { drive, client } = setup()
    const t0 = await client.startPageToken()
    for (let i = 0; i < 250; i++) drive.putFile(`f${i}.txt`, enc('x'))
    const r = await client.changes(t0)
    expect(r.changes).toHaveLength(250)
  })

  it('download reports progress', async () => {
    const { drive, client } = setup()
    const data = new Uint8Array(100_000).fill(7)
    drive.putFile('big.bin', data)
    const [f] = await client.listChildren(drive.rootId)
    const calls: Array<[number, number]> = []
    const out = await client.download(f.id, undefined, (l, t) => calls.push([l, t]))
    expect(out).toHaveLength(100_000)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[calls.length - 1]).toEqual([100_000, 100_000])
  })

  it('seedFromDir uploads dot dirs and folders have FOLDER_MIME', async () => {
    const { drive, client } = setup()
    await drive.seedFromDir(join(__dirname, '..', '..', 'docs'))
    const kids = await client.listChildren(drive.rootId)
    expect(kids.some((k) => k.mimeType === FOLDER_MIME)).toBe(true)
  })
})
