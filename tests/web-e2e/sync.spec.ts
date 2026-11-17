import { test, expect, signIn, openContinue, highlightSentence, showToolbar, pending, json, readerCfi, tapText, LIB } from './fixtures'

const normal = (s: string): string => s.replace(/\s+/g, ' ').trim()

test('a highlight made on the Mac shows up when the tab becomes visible again', async ({ page, fake, seed }) => {
  await signIn(page)
  await openContinue(page)
  await showToolbar(page)
  await page.getByTestId('open-highlights').tap()
  const items = page.getByTestId('highlights-sheet').getByTestId('hl-item')
  await expect(items).toHaveCount(1)

  // The Mac writes a second highlight into the book's highlights.json on Drive.
  const epub = seed.books.find(b => b.id === seed.epubId)!
  const path = `${LIB}/.smartreader/books/${epub.slug}/highlights.json`
  const file = json(fake, path)
  const now = new Date().toISOString()
  file.highlights.push({
    id: 'h_from-the-mac',
    location: 'epubcfi(/6/4!/4/2/1:0)',
    quote: { exact: 'Written on the Mac a moment ago', prefix: '', suffix: '' },
    context: 'Written on the Mac a moment ago.',
    chapter: 'Laying Plans',
    position: 0.06,
    color: 'green',
    note: null,
    createdAt: now,
    updatedAt: now,
    deleted: false
  })
  fake.putFile(path, new TextEncoder().encode(JSON.stringify(file, null, 2)))

  // Coming back to the tab pulls at once (no need to wait for the 30 s poll).
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(items).toHaveCount(2)
  await expect(items.filter({ hasText: 'Written on the Mac a moment ago' })).toHaveCount(1)
})

test('an expired token mid-session queues edits, and reconnecting flushes them to Drive', async ({ page, fake, seed }) => {
  await signIn(page)
  const frame = await openContinue(page)
  const epub = seed.books.find(b => b.id === seed.epubId)!
  const path = `${LIB}/.smartreader/books/${epub.slug}/highlights.json`
  const onDrive = (): string[] => json(fake, path).highlights.map((h: any) => normal(h.quote.exact))

  fake.expireToken()
  const quote = await highlightSentence(page, frame)
  const banner = page.getByTestId('reconnect')
  await expect(banner).toBeVisible()
  expect(onDrive()).not.toContain(quote)
  expect(await pending(page)).toBeGreaterThan(0)

  // Google hands out a fresh token on reconnect; Drive accepts only that one now.
  await page.evaluate(() => ((window as unknown as { __gsiToken: string }).__gsiToken = 'fresh-token'))
  fake.setToken('fresh-token')
  await banner.tap()
  await expect(banner).toHaveCount(0)
  await expect.poll(onDrive).toContain(quote)
  await expect.poll(() => pending(page)).toBe(0)
})

test('a highlight made on the Mac appears in the open book, and goes when the Mac deletes it, without moving the reader', async ({ page, fake, seed }) => {
  await signIn(page)
  const frame = await openContinue(page)
  const epub = seed.books.find(b => b.id === seed.epubId)!
  const path = `${LIB}/.smartreader/books/${epub.slug}/highlights.json`
  type View = { renderer: { getContents(): Array<{ index: number; doc: Document; overlayer?: { element: SVGElement } }> }; getCFI(i: number, r: Range): string }
  // Highlight shapes drawn on the section on screen.
  const marks = (): Promise<number> =>
    page.evaluate(() => {
      const view = document.querySelector('foliate-view') as unknown as View
      return view.renderer.getContents().reduce((n, c) => n + (c.overlayer?.element.childElementCount ?? 0), 0)
    })
  // The CFI of a sentence on screen, as the Mac would have stored it.
  const target = await page.evaluate(() => {
    const view = document.querySelector('foliate-view') as unknown as View
    const { index, doc } = view.renderer.getContents()[0]
    const fr = (doc.defaultView!.frameElement as HTMLElement).getBoundingClientRect()
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const t = node.textContent ?? ''
      const i = t.search(/\S/)
      if (t.trim().length < 45) continue
      const r = doc.createRange()
      r.setStart(node, i)
      r.setEnd(node, i + 40)
      const rr = r.getBoundingClientRect()
      if (rr.left + fr.left < 0 || rr.right + fr.left > innerWidth || rr.top + fr.top < 150 || rr.top + fr.top > innerHeight - 150) continue
      return { cfi: view.getCFI(index, r), text: r.toString() }
    }
    throw new Error('no visible sentence')
  })
  const start = await readerCfi(page)
  const drawn = await marks()

  const file = json(fake, path)
  const now = new Date().toISOString()
  const mac = {
    id: 'h_on-the-page', location: target.cfi, quote: { exact: target.text, prefix: '', suffix: '' }, context: target.text,
    chapter: 'Laying Plans', position: 0.06, color: 'green', note: null, createdAt: now, updatedAt: now, deleted: false
  }
  file.highlights.push(mac)
  fake.putFile(path, new TextEncoder().encode(JSON.stringify(file, null, 2)))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(marks).toBe(drawn + 1)
  expect(await readerCfi(page)).toBe(start)
  // It is a real highlight: tapping it opens the edit popup.
  await tapText(page, frame, target.text.replace(/\s+/g, ' ').trim())
  await expect(page.getByTestId('hl-delete')).toBeVisible()

  // The Mac deletes it; the popup the reader has open is left alone.
  const later = json(fake, path)
  const gone = later.highlights.find((h: { id: string }) => h.id === mac.id)
  Object.assign(gone, { deleted: true, updatedAt: new Date(Date.now() + 1000).toISOString() })
  fake.putFile(path, new TextEncoder().encode(JSON.stringify(later, null, 2)))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(marks).toBe(drawn)
  await expect(page.getByTestId('hl-popup')).toBeVisible()
  expect(await readerCfi(page)).toBe(start)
})
