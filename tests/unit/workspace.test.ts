import { it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Workspace } from '../../src/main/workspace'

const templateDir = resolve(__dirname, '../../resources/workspace-template')
let ws: Workspace | null = null
afterEach(() => { ws?.close(); ws = null })

const opts = { templateDir, newCardsPerDay: async () => 20, onReviewChanged: () => {} }

it('opens a folder end-to-end: setup, scan, highlight, review, stats', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sr-wsx-'))
  await writeFile(join(root, 'Some_Book.epub'), 'not really an epub')
  ws = await Workspace.open(root, opts)
  expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true)
  const [book] = await ws.library.list()
  expect(book.title).toBe('Some Book')
  const h = await ws.highlights.add(book.id, {
    location: 'epubcfi(/6/2)', quote: { exact: 'focus wins', prefix: '', suffix: '' },
    context: 'In the end focus wins every time.', chapter: 'One', position: 0.1, color: 'yellow', note: null
  })
  const q = await ws.review.queue()
  expect(q).toHaveLength(1)
  expect(q[0]).toMatchObject({ highlightId: h.id, bookTitle: 'Some Book', promptType: 'highlight' })
  await ws.review.rate(h.id, 'good', 3000, 'highlight')
  const stats = await ws.stats.get()
  expect(stats.K).toBeGreaterThan(0.9)
  expect(existsSync(join(root, '.smartreader/metrics.jsonl'))).toBe(true)
})

it('open rejects missing folder', async () => {
  await expect(Workspace.open('/definitely/not/here', opts)).rejects.toThrow('Folder not found')
})

it('open rejects an unwritable folder', async () => {
  if (process.getuid?.() === 0) return // root can write anywhere
  const root = await mkdtemp(join(tmpdir(), 'sr-ro-'))
  await chmod(root, 0o555)
  await expect(Workspace.open(root, opts)).rejects.toThrow('permission')
  await chmod(root, 0o755)
})
