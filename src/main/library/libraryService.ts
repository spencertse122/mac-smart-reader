import { mkdir, readFile, rename, stat, writeFile, access } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Book, BookStatus, LibraryFile } from '../../shared/types'
import { jsonFile, type JsonFile } from '../store/jsonFile'
import { computeBookId, formatFromPath, slugify, titleFromFilename } from './ids'
import { scanFolder } from './scan'
import { detectDrm } from './drm'

export class BookNotFoundError extends Error {
  constructor(id: string) {
    super(`Book not found: ${id}`)
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export class LibraryService {
  readonly dataDir: string
  private file: JsonFile<LibraryFile>

  constructor(
    readonly root: string,
    private now: () => Date = () => new Date(),
    private hash: (abs: string) => Promise<string> = computeBookId
  ) {
    this.dataDir = join(root, '.smartreader')
    this.file = jsonFile<LibraryFile>(join(this.dataDir, 'library.json'), () => ({ version: 1, books: {} }))
  }

  async scan(): Promise<Book[]> {
    const rels = await scanFolder(this.root)
    const lib = await this.file.read()
    const byPath = new Map(Object.values(lib.books).map(b => [b.path, b]))
    const found: Array<{ rel: string; id: string; size: number; mtimeMs: number }> = []
    for (const rel of rels) {
      const abs = join(this.root, rel)
      let st
      try {
        st = await stat(abs)
      } catch {
        continue
      }
      const known = byPath.get(rel)
      const unchanged = known && known.fileSize === st.size && known.mtimeMs === st.mtimeMs
      const id = unchanged ? known.id : await this.hash(abs)
      found.push({ rel, id, size: st.size, mtimeMs: st.mtimeMs })
    }
    // Prefer the stored path when a book exists in several places, so duplicates never flip it.
    found.sort((a, b) => Number(lib.books[b.id]?.path === b.rel) - Number(lib.books[a.id]?.path === a.rel))

    const drm = new Map<string, string | null>()
    for (const f of found) {
      if (!lib.books[f.id] && !drm.has(f.id)) drm.set(f.id, await detectDrm(join(this.root, f.rel), formatFromPath(f.rel)!))
    }

    await this.file.update(draft => {
      for (const b of Object.values(draft.books)) b.missing = true
      const seen = new Set<string>()
      for (const f of found) {
        if (seen.has(f.id)) continue
        seen.add(f.id)
        const existing = draft.books[f.id]
        if (existing) {
          Object.assign(existing, { path: f.rel, fileSize: f.size, mtimeMs: f.mtimeMs, missing: false })
          continue
        }
        const title = titleFromFilename(f.rel)
        const reason = drm.get(f.id) ?? null
        draft.books[f.id] = {
          id: f.id,
          slug: slugify(title, f.id),
          path: f.rel,
          format: formatFromPath(f.rel)!,
          title,
          author: '',
          addedAt: this.now().toISOString(),
          lastOpenedAt: null,
          location: null,
          progress: 0,
          status: reason ? 'drm' : 'ok',
          statusReason: reason,
          fileSize: f.size,
          mtimeMs: f.mtimeMs,
          metadataExtracted: false,
          hasCover: false,
          missing: false
        }
      }
    })
    return this.list()
  }

  async list(): Promise<Book[]> {
    const lib = await this.file.read()
    return Object.values(lib.books)
      .filter(b => !b.missing)
      .sort((a, b) => {
        if (a.lastOpenedAt && b.lastOpenedAt) return b.lastOpenedAt.localeCompare(a.lastOpenedAt)
        if (a.lastOpenedAt) return -1
        if (b.lastOpenedAt) return 1
        return a.title.localeCompare(b.title)
      })
  }

  async get(id: string): Promise<Book> {
    const b = (await this.file.read()).books[id]
    if (!b) throw new BookNotFoundError(id)
    return b
  }

  async bookDir(id: string): Promise<string> {
    return join(this.dataDir, 'books', (await this.get(id)).slug)
  }

  async readBook(id: string): Promise<{ name: string; data: Buffer }> {
    const b = await this.get(id)
    return { name: basename(b.path), data: await readFile(join(this.root, b.path)) }
  }

  async getCover(id: string): Promise<Buffer | null> {
    try {
      return await readFile(join(await this.bookDir(id), 'cover.jpg'))
    } catch {
      return null
    }
  }

  async saveMetadata(id: string, meta: { title: string; author: string; cover: Uint8Array | null }): Promise<Book> {
    const book = await this.get(id)
    const title = meta.title.trim() || book.title
    let slug = book.slug
    const oldDir = join(this.dataDir, 'books', book.slug)
    const candidate = slugify(title, id)
    if (candidate !== slug && !(await exists(join(oldDir, 'highlights.json')))) {
      if (await exists(oldDir)) {
        await mkdir(join(this.dataDir, 'books'), { recursive: true })
        await rename(oldDir, join(this.dataDir, 'books', candidate))
      }
      slug = candidate
    }
    if (meta.cover && meta.cover.length > 0) {
      const dir = join(this.dataDir, 'books', slug)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'cover.jpg'), meta.cover)
    }
    const hasCover = book.hasCover || (meta.cover !== null && meta.cover.length > 0)
    await this.file.update(d => {
      Object.assign(d.books[id], { title, author: meta.author.trim(), slug, metadataExtracted: true, hasCover })
    })
    return this.get(id)
  }

  async saveProgress(id: string, location: string, progress: number): Promise<void> {
    await this.get(id)
    const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0))
    await this.file.update(d => {
      Object.assign(d.books[id], { location, progress: p })
    })
  }

  async markOpened(id: string): Promise<void> {
    await this.get(id)
    await this.file.update(d => {
      d.books[id].lastOpenedAt = this.now().toISOString()
    })
  }

  async setStatus(id: string, status: BookStatus, reason: string | null): Promise<void> {
    await this.get(id)
    await this.file.update(d => {
      Object.assign(d.books[id], { status, statusReason: reason })
    })
  }
}
