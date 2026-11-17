import { test, expect, signIn, openContinue, selectSentence, readerCfi, visibleTextLength, showToolbar, tapText, json, LIB } from './fixtures'

const NOTE = 'Know the enemy first'

test('a reader signs in, reads, highlights, reviews, and it all lands in Drive', async ({ page, fake, seed }) => {
  await signIn(page)
  const epub = seed.books.find(b => b.id === seed.epubId)!

  // Library lists the Mac's books; the tab bar offers the book the Mac read last.
  const tiles = page.locator('.book-grid [data-testid=book-tile]')
  await expect(tiles).toHaveCount(seed.books.length)
  await expect(page.getByTestId('tab-continue')).toBeVisible()

  // Continue opens at the Mac's saved position (spine item /6/8), not the start of the book.
  const frame = await openContinue(page)
  await expect.poll(() => readerCfi(page)).toMatch(/^epubcfi\(\/6\/8!/)
  // ...and that page shows text (WebKit once showed a blank column before chapters that force a page break).
  await expect.poll(() => visibleTextLength(frame)).toBeGreaterThan(100)

  // Select a sentence; the popup offers colours but no dictionary lookup on the web.
  const quote = await selectSentence(frame)
  const popup = page.getByTestId('hl-popup')
  await expect(popup).toBeVisible()
  await expect(page.getByTestId('hl-lookup')).toHaveCount(0)
  await page.getByTestId('hl-color-yellow').tap()
  await expect(popup).toHaveCount(0)
  const words = quote.replace(/\s+/g, ' ').trim()

  // A tap on the new highlight reopens the popup to add a note.
  await tapText(page, frame, words)
  await expect(popup).toBeVisible()
  await page.getByTestId('hl-note').tap()
  await page.getByTestId('hl-note-input').fill(NOTE)
  await page.getByTestId('hl-note-save').tap()
  await expect(popup).toHaveCount(0)

  // The highlight and its note are in the bottom sheet.
  await showToolbar(page)
  await page.getByTestId('open-highlights').tap()
  const sheet = page.getByTestId('highlights-sheet')
  await expect(sheet).toBeVisible()
  const item = sheet.getByTestId('hl-item').filter({ hasText: words.slice(0, 30) })
  await expect(item).toHaveCount(1)
  await expect(item).toContainText(NOTE)
  await sheet.getByTestId('sheet-close').tap()
  await expect(sheet).toHaveCount(0)

  // Review: the new highlight (Next) and the Mac's saved word (Got it).
  await showToolbar(page)
  await page.getByTestId('reader-back').tap()
  await page.getByTestId('tab-review').tap()
  await expect(page.getByTestId('view-review')).toBeVisible()
  const seen: string[] = []
  for (let i = 1; i <= 5 && (await page.getByTestId('review-done').count()) === 0; i++) {
    const card = page.getByTestId('review-card')
    await expect(card).toContainText(new RegExp(`(?<!\\d)${i} / \\d`))
    // Word cards hide the answer until tapped; highlight cards show it at once.
    if (await page.getByTestId('review-reveal').count()) await page.getByTestId('review-reveal').tap()
    const next = page.getByTestId('review-next')
    seen.push((await next.innerText()).trim())
    await next.tap()
    await expect(page.getByTestId('review-done').or(card.filter({ hasText: new RegExp(`(?<!\\d)${i + 1} / \\d`) }))).toBeVisible()
  }
  expect(seen).toContain('Next')
  expect(seen).toContain('Got it')
  await expect(page.getByTestId('review-done')).toBeVisible()

  await page.getByTestId('tab-vocab').tap()
  await expect(page.getByTestId('vocab-headword')).toHaveText(['deception'])

  await page.getByTestId('tab-stats').tap()
  await expect(page.getByTestId('kpi-streak')).toHaveText('1 day')

  // Everything is on Drive once the outbox drains: the highlight with its note, and both reviews.
  const hlPath = `${LIB}/.smartreader/books/${epub.slug}/highlights.json`
  const mine = (): any => json(fake, hlPath).highlights.find((h: any) => h.quote.exact.replace(/\s+/g, ' ').trim() === words)
  await expect.poll(() => mine()?.note ?? null).toBe(NOTE)
  expect(mine().color).toBe('yellow')
  const reviewed = (): string[] =>
    new TextDecoder().decode(fake.readFile(`${LIB}/.smartreader/review-log.jsonl`)).trim().split('\n').map(l => JSON.parse(l).highlightId)
  await expect.poll(reviewed).toEqual(expect.arrayContaining([seed.wordId, mine().id]))

  // A reload starts from Drive and IndexedDB again: highlight, note and reviews survive.
  await page.reload()
  await expect(page.getByTestId('tab-library')).toBeVisible()
  await page.getByTestId('tab-review').tap()
  await expect(page.getByTestId('review-empty')).toBeVisible()
  await expect(page.getByTestId('due-badge')).toHaveCount(0)
  await openContinue(page)
  await showToolbar(page)
  await page.getByTestId('open-highlights').tap()
  await expect(page.getByTestId('highlights-sheet').getByTestId('hl-item').filter({ hasText: NOTE })).toContainText(words.slice(0, 30))
})
