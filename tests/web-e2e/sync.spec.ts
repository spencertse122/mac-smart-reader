import { test, expect, signIn, openContinue, highlightSentence, showToolbar, pending, json, LIB } from './fixtures'

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
