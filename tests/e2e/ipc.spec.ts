import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('library open, highlight, review and pty over real IPC', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp()
  const result = await page.evaluate(async lib => {
    const r = await window.api.library.open(lib)
    if (!r.ok) return { error: r.error }
    const book = r.books.find(b => b.format === 'epub')!
    await window.api.highlights.add(book.id, {
      location: 'epubcfi(/6/4)', quote: { exact: 'all warfare is based on deception', prefix: '', suffix: '' },
      context: 'All warfare is based on deception.', chapter: 'I', position: 0.05, color: 'yellow', note: null
    })
    const q = await window.api.review.queue()
    const id = await window.api.pty.create(80, 24)
    const out = await new Promise<string>(resolve => {
      let buf = ''
      const off = window.api.pty.onData((pid, d) => {
        if (pid !== id) return
        buf += d
        if (buf.includes('SR_OK')) { off(); resolve(buf) }
      })
      window.api.pty.write(id, 'echo SR_OK\r')
    })
    window.api.pty.kill(id)
    return { books: r.books.length, queue: q.length, ptyOk: out.includes('SR_OK') }
  }, library)
  expect(result).toEqual({ books: 4, queue: 1, ptyOk: true })
  await app.close()
})

test('opening a missing folder returns an error instead of crashing', async () => {
  const { app, page } = await launchApp()
  const r = await page.evaluate(() => window.api.library.open('/no/such/folder'))
  expect(r).toEqual({ ok: false, error: expect.stringContaining('Folder not found') })
  await app.close()
})
