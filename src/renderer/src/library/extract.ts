import type { Book } from '../../../shared/types'
import { bookFile, makeBook } from '../reader/foliate'
import { normalizeMetadata } from './metadata'

export async function coverToJpeg(blob: Blob, maxWidth = 600): Promise<Uint8Array | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, maxWidth / bmp.width)
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale))
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    return new Uint8Array(await out.arrayBuffer())
  } catch {
    return null
  }
}

let running = false
const queued = new Set<string>()

// Extracts title/author/cover with foliate's own parsers, one book at a time so the UI stays responsive.
export function runMetadataExtraction(books: Book[], onDone: () => void): void {
  for (const b of books) if (b.status === 'ok' && !b.metadataExtracted) queued.add(b.id)
  if (running || queued.size === 0) return
  running = true
  void (async () => {
    while (queued.size) {
      const id = queued.values().next().value as string
      queued.delete(id)
      const book = books.find(b => b.id === id)
      if (!book) continue
      try {
        const parsed = await makeBook(await bookFile(id))
        const { title, author } = normalizeMetadata(parsed.metadata, book.title)
        const blob = await parsed.getCover?.().catch(() => null)
        const cover = blob ? await coverToJpeg(blob) : null
        await window.api.library.saveMetadata(id, { title, author, cover })
      } catch (e) {
        const err = e as Error
        const status = err.name === 'UnsupportedTypeError' ? 'unsupported' : 'error'
        await window.api.library.setStatus(id, status, err.message || 'Could not open this file')
      }
      await new Promise(r => setTimeout(r, 30))
    }
    running = false
    onDone()
  })()
}
