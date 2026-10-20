import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rename, readFile, copyFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeBookId, slugify, formatFromPath, titleFromFilename } from '../../src/main/library/ids'
import { scanFolder } from '../../src/main/library/scan'
import { LibraryService } from '../../src/main/library/libraryService'

let root: string
const fixed = () => new Date('2026-10-20T10:00:00Z')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sr-lib-'))
})

async function put(rel: string, content: string | Buffer): Promise<void> {
  await mkdir(join(root, rel, '..'), { recursive: true })
  await writeFile(join(root, rel), content)
}

describe('ids', () => {
  it('id is stable, content-based, 16 hex chars', async () => {
    await put('a.epub', 'hello')
    await put('b.epub', 'hello')
    await put('c.epub', 'world')
    const [a, b, c] = await Promise.all(['a.epub', 'b.epub', 'c.epub'].map(f => computeBookId(join(root, f))))
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('only hashes the first MiB (same head + same size => same id)', async () => {
    const head = Buffer.alloc(1024 * 1024, 7)
    await put('x.pdf', Buffer.concat([head, Buffer.from('AAAA')]))
    await put('y.pdf', Buffer.concat([head, Buffer.from('BBBB')]))
    expect(await computeBookId(join(root, 'x.pdf'))).toBe(await computeBookId(join(root, 'y.pdf')))
  })

  it('slugify handles punctuation, accents, non-latin and length', () => {
    expect(slugify('Thinking, Fast and Slow', 'abcdef1234567890')).toBe('thinking-fast-and-slow-abcdef')
    expect(slugify('Café Society', '1234567890abcdef')).toBe('cafe-society-123456')
    expect(slugify('思考的艺术', 'ffffff0000000000')).toBe('book-ffffff')
    const long = slugify('a'.repeat(30) + ' ' + 'b'.repeat(30), '0000001111111111')
    expect(long.length).toBeLessThanOrEqual(50 + 7)
    expect(long.endsWith('-000000')).toBe(true)
  })

  it('formatFromPath maps known extensions case-insensitively', () => {
    expect(formatFromPath('x/Book.EPUB')).toBe('epub')
    expect(formatFromPath('a.azw3')).toBe('azw3')
    expect(formatFromPath('a.azw')).toBe('azw')
    expect(formatFromPath('a.mobi')).toBe('mobi')
    expect(formatFromPath('a.fb2')).toBe('fb2')
    expect(formatFromPath('a.cbz')).toBe('cbz')
    expect(formatFromPath('a.pdf')).toBe('pdf')
    expect(formatFromPath('notes.txt')).toBeNull()
  })

  it('titleFromFilename strips extension and underscores', () => {
    expect(titleFromFilename('sub/The_Art_of_War.epub')).toBe('The Art of War')
  })
})

describe('scanFolder', () => {
  it('finds supported books recursively and skips app/agent dirs and hidden files', async () => {
    await put('a.epub', 'x')
    await put('sub/deeper/b.pdf', 'x')
    await put('notes.txt', 'x')
    await put('.hidden.epub', 'x')
    await put('.smartreader/c.epub', 'x')
    await put('knowledge/d.epub', 'x')
    await put('.claude/e.epub', 'x')
    expect(await scanFolder(root)).toEqual(['a.epub', 'sub/deeper/b.pdf'])
  })

  it('skips macOS system folders when the chosen folder is the home directory', async () => {
    for (const d of ['Library', 'Applications', 'Pictures', 'Music', 'Movies']) await put(`${d}/x.epub`, 'x')
    await put('Documents/Books/a.epub', 'x')
    await put('sub/Library/b.epub', 'x') // only the home's own top-level folders are skipped
    expect(await scanFolder(root, root)).toEqual(['Documents/Books/a.epub', 'sub/Library/b.epub'])
    // any other folder is scanned in full
    expect(await scanFolder(root, '/somewhere/else')).toContain('Library/x.epub')
  })
})

describe('LibraryService', () => {
  it('scan creates books with defaults and persists library.json', async () => {
    await put('The_Art_of_War.epub', 'book-one')
    const lib = new LibraryService(root, fixed)
    const books = await lib.scan()
    expect(books).toHaveLength(1)
    const b = books[0]
    expect(b).toMatchObject({
      path: 'The_Art_of_War.epub', format: 'epub', title: 'The Art of War', author: '',
      status: 'ok', progress: 0, location: null, metadataExtracted: false, hasCover: false, missing: false,
      addedAt: '2026-10-20T10:00:00.000Z'
    })
    expect(b.slug).toBe(`the-art-of-war-${b.id.slice(0, 6)}`)
    const saved = JSON.parse(await readFile(join(root, '.smartreader/library.json'), 'utf8'))
    expect(saved.version).toBe(1)
    expect(Object.keys(saved.books)).toEqual([b.id])
  })

  it('renamed file keeps id and its data', async () => {
    await put('old.epub', 'same-content')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    await lib.saveProgress(b.id, 'epubcfi(/6/4)', 0.5)
    await mkdir(join(root, 'moved'))
    await rename(join(root, 'old.epub'), join(root, 'moved/new name.epub'))
    const lib2 = new LibraryService(root, fixed)
    const [b2] = await lib2.scan()
    expect(b2.id).toBe(b.id)
    expect(b2.path).toBe('moved/new name.epub')
    expect(b2.progress).toBe(0.5)
  })

  it('duplicate copy keeps original path and lists once', async () => {
    await put('z-original.epub', 'dup')
    const lib = new LibraryService(root, fixed)
    await lib.scan()
    await copyFile(join(root, 'z-original.epub'), join(root, 'a-copy.epub'))
    const books = await lib.scan()
    expect(books).toHaveLength(1)
    expect(books[0].path).toBe('z-original.epub')
  })

  it('missing files are kept but hidden from list', async () => {
    await put('gone.epub', 'gone')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    await rm(join(root, 'gone.epub'))
    expect(await lib.scan()).toEqual([])
    expect((await lib.get(b.id)).missing).toBe(true)
  })

  it('second scan does not rehash unchanged files', async () => {
    await put('a.epub', 'aaa')
    await put('b.pdf', 'bbb')
    let calls = 0
    const counting = async (p: string) => { calls++; return computeBookId(p) }
    const lib = new LibraryService(root, fixed, counting)
    await lib.scan()
    expect(calls).toBe(2)
    await lib.scan()
    expect(calls).toBe(2)
    await writeFile(join(root, 'a.epub'), 'changed-content')
    await lib.scan()
    expect(calls).toBe(3)
  })

  it('list sorts recently opened first, then title', async () => {
    await put('b.epub', 'b')
    await put('a.epub', 'a')
    await put('c.epub', 'c')
    let t = 0
    const lib = new LibraryService(root, () => new Date(Date.UTC(2026, 9, 20, 10, 0, t++)))
    const books = await lib.scan()
    const c = books.find(x => x.path === 'c.epub')!
    await lib.markOpened(c.id)
    expect((await lib.list()).map(x => x.path)).toEqual(['c.epub', 'a.epub', 'b.epub'])
  })

  it('saveMetadata sets title/author/cover and renames slug dir when there are no highlights', async () => {
    await put('ugly (z-lib).epub', 'meta')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    const oldDir = await lib.bookDir(b.id)
    await mkdir(oldDir, { recursive: true })
    const updated = await lib.saveMetadata(b.id, { title: 'Deep Work', author: 'Cal Newport', cover: new Uint8Array([1, 2, 3]) })
    expect(updated).toMatchObject({ title: 'Deep Work', author: 'Cal Newport', metadataExtracted: true, hasCover: true })
    expect(updated.slug).toBe(`deep-work-${b.id.slice(0, 6)}`)
    expect(existsSync(oldDir)).toBe(false)
    expect([...(await lib.getCover(b.id))!]).toEqual([1, 2, 3])
  })

  it('saveMetadata keeps slug when highlights already exist', async () => {
    await put('x.epub', 'has-highlights')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    const dir = await lib.bookDir(b.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'highlights.json'), '{"version":1,"bookId":"x","highlights":[]}')
    const updated = await lib.saveMetadata(b.id, { title: 'Other Title', author: '', cover: null })
    expect(updated.slug).toBe(b.slug)
    expect(updated.title).toBe('Other Title')
    expect(updated.hasCover).toBe(false)
  })

  it('saveMetadata keeps old title when given blank', async () => {
    await put('Keep_Me.epub', 'k')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    expect((await lib.saveMetadata(b.id, { title: '  ', author: 'A', cover: null })).title).toBe('Keep Me')
  })

  it('saveProgress clamps, setStatus records reason, readBook returns bytes', async () => {
    await put('p.epub', 'bytes!')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    await lib.saveProgress(b.id, 'cfi', 1.7)
    await lib.setStatus(b.id, 'error', 'Bad zip')
    const got = await lib.get(b.id)
    expect(got.progress).toBe(1)
    expect(got.status).toBe('error')
    expect(got.statusReason).toBe('Bad zip')
    const { name, data } = await lib.readBook(b.id)
    expect(name).toBe('p.epub')
    expect(data.toString()).toBe('bytes!')
  })

  it('get throws BookNotFoundError for unknown id', async () => {
    const lib = new LibraryService(root, fixed)
    await expect(lib.get('nope')).rejects.toThrow('Book not found')
  })

  it('flags DRM books at scan time', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const xml = '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>'
    await put('locked.epub', Buffer.from(zipSync({ mimetype: strToU8('application/epub+zip'), 'META-INF/encryption.xml': strToU8(xml) })))
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    expect(b.status).toBe('drm')
    expect(b.statusReason).toMatch(/DRM/)
    expect((await stat(join(root, 'locked.epub'))).size).toBeGreaterThan(0)
  })
})
