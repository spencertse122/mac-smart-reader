import { test, expect, type Page, type Frame } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

async function openBook(page: Page, format: string): Promise<string> {
  // The library opens asynchronously after launch; the shell appears once it is ready.
  await expect(page.getByTestId('app-shell')).toBeVisible()
  const id = await page.evaluate(async f => (await window.api.library.list()).find(b => b.format === f)!.id, format)
  await page.locator(`[data-book-id="${id}"]`).click()
  await expect(page.getByTestId('view-reader')).toBeVisible()
  return id
}

// The PDF fixture holds a single short sentence per page, so it uses a lower threshold.
async function contentFrame(page: Page, minChars = 200): Promise<Frame> {
  await expect.poll(() => page.frames().filter(f => f.url().startsWith('blob:')).length, { timeout: 20_000 }).toBeGreaterThan(0)
  for (let i = 0; i < 40; i++) {
    for (const f of page.frames().filter(f => f.url().startsWith('blob:'))) {
      const len = await f.evaluate(() => document.body?.innerText.trim().length ?? 0).catch(() => 0)
      if (len > minChars) return f
    }
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(250)
  }
  throw new Error('no content frame with text')
}

test('EPUB: read, highlight, persist across restart, review card appears', async () => {
  const library = await makeLibrary()
  let { app, page } = await launchApp({ library })
  const id = await openBook(page, 'epub')
  const frame = await contentFrame(page)
  const selected = await frame.evaluate(() => {
    // First paragraph that starts with a long run of plain text (the fixture's header paragraphs start with <strong>).
    const p = [...document.querySelectorAll('p')].find(x => x.firstChild?.nodeType === Node.TEXT_NODE && (x.firstChild as Text).data.trim().split(/\s+/).length > 8)!
    const text = p.firstChild as Text
    const r = document.createRange()
    r.setStart(text, 0)
    r.setEnd(text, Math.min(40, text.data.length))
    const sel = document.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    return r.toString()
  })
  await expect(page.getByTestId('hl-popup')).toBeVisible()
  await page.getByTestId('hl-color-green').click()
  await expect.poll(() => page.evaluate(b => window.api.highlights.list(b).then(h => h.length), id)).toBe(1)
  const saved = await page.evaluate(b => window.api.highlights.list(b), id)
  expect(saved[0].quote.exact).toBe(selected)
  expect(saved[0].location).toMatch(/^epubcfi\(/)
  await expect(page.getByTestId('hl-item')).toHaveCount(1)
  await expect(page.getByTestId('due-badge')).toHaveText('1')
  await app.close()

  ;({ app, page } = await launchApp({ library }))
  await openBook(page, 'epub')
  await page.getByTestId('nav-highlights').click()
  await expect(page.getByTestId('hl-item')).toHaveCount(1)
  await app.close()
})

for (const format of ['mobi', 'azw3', 'pdf']) {
  test(`${format.toUpperCase()} opens and renders text`, async () => {
    const library = await makeLibrary()
    const { app, page } = await launchApp({ library })
    await openBook(page, format)
    await contentFrame(page, format === 'pdf' ? 20 : 200)
    await expect(page.getByTestId('view-reader')).toBeVisible()
    await app.close()
  })
}

test('reading position is restored', async () => {
  const library = await makeLibrary()
  let { app, page } = await launchApp({ library })
  const id = await openBook(page, 'epub')
  await contentFrame(page)
  for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200) }
  await page.waitForTimeout(1500)
  const before = await page.evaluate(async b => (await window.api.library.list()).find(x => x.id === b)!.location, id)
  expect(before).toMatch(/^epubcfi\(/)
  await app.close()
  ;({ app, page } = await launchApp({ library }))
  await openBook(page, 'epub')
  await page.waitForTimeout(1500)
  const after = await page.evaluate(async b => (await window.api.library.list()).find(x => x.id === b)!.progress, id)
  expect(after).toBeGreaterThan(0)
  await app.close()
})
