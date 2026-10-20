import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { BookFormat } from '../../shared/types'

const HEAD_BYTES = 1024 * 1024

export async function computeBookId(absPath: string): Promise<string> {
  const fh = await open(absPath, 'r')
  try {
    const { size } = await fh.stat()
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, size))
    await fh.read(buf, 0, buf.length, 0)
    return createHash('sha256').update(buf).update(String(size)).digest('hex').slice(0, 16)
  } finally {
    await fh.close()
  }
}

const EXT: Record<string, BookFormat> = {
  '.epub': 'epub', '.mobi': 'mobi', '.azw3': 'azw3', '.azw': 'azw', '.fb2': 'fb2', '.cbz': 'cbz', '.pdf': 'pdf'
}

export function formatFromPath(p: string): BookFormat | null {
  return EXT[extname(p).toLowerCase()] ?? null
}

export function slugify(title: string, id: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '')
  return `${base || 'book'}-${id.slice(0, 6)}`
}

export function titleFromFilename(relPath: string): string {
  const name = basename(relPath, extname(relPath))
  return name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled'
}
