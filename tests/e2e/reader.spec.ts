import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { contentFrame, launchApp, makeLibrary, openBook } from './helpers'

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

test('quitting right after turning pages keeps the latest position', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  const id = await openBook(page, 'epub')
  await contentFrame(page)
  await page.waitForTimeout(1500) // let the debounced save settle
  const settled = await page.evaluate(async b => (await window.api.library.list()).find(x => x.id === b)!.location, id)
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(120) }
  await app.close() // like ⌘Q, well inside the 1 s save debounce
  const lib = JSON.parse(await readFile(join(library, '.smartreader/library.json'), 'utf8'))
  expect(lib.books[id].location).toMatch(/^epubcfi\(/)
  expect(lib.books[id].location).not.toBe(settled)
})

test('a note typed for a new highlight survives a click back into the book', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  const id = await openBook(page, 'epub')
  const frame = await contentFrame(page)
  await frame.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find(x => x.firstChild?.nodeType === Node.TEXT_NODE && (x.firstChild as Text).data.trim().split(/\s+/).length > 8)!
    const r = document.createRange()
    r.setStart(p.firstChild!, 0)
    r.setEnd(p.firstChild!, 25)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(r)
    p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await page.getByTestId('hl-note').click()
  await page.getByTestId('hl-note-input').fill('my own thought')
  // click somewhere in the book instead of pressing Save
  await frame.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
  await expect(page.getByTestId('hl-popup')).toBeHidden()
  await expect.poll(() => page.evaluate(b => window.api.highlights.list(b), id)).toEqual([
    expect.objectContaining({ note: 'my own thought', color: 'yellow' })
  ])
  await app.close()
})
