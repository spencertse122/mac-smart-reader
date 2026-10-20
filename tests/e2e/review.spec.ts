import { test, expect } from '@playwright/test'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp, makeLibrary } from './helpers'

test('review a highlight card, then an AI question written by an agent appears', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await page.getByTestId('nav-review').waitFor()
  const ids = await page.evaluate(async () => {
    const book = (await window.api.library.list()).find(b => b.format === 'epub')!
    const mk = (exact: string) => window.api.highlights.add(book.id, {
      location: 'epubcfi(/6/4)', quote: { exact, prefix: '', suffix: '' }, context: `Sun Tzu said: ${exact} is vital.`,
      chapter: 'Laying Plans', position: 0.01, color: 'yellow', note: null
    })
    const a = await mk('the art of war')
    const b = await mk('moral law')
    return [a.id, b.id]
  })
  await page.getByTestId('nav-review').click()
  // highlight cards show their content immediately; Space = Next
  await expect(page.getByTestId('review-prompt')).toBeVisible()
  await expect(page.getByTestId('review-next')).toBeVisible()
  await expect(page.getByTestId('review-reveal')).toHaveCount(0)
  await page.keyboard.press('s')
  await expect(page.getByTestId('review-prompt')).toBeVisible()
  await expect(page.getByTestId('review-next')).toBeVisible()

  await appendFile(join(library, 'knowledge/prompts.jsonl'),
    JSON.stringify({ highlightId: ids[1], question: 'What is the first of the five constant factors?', answer: 'The Moral Law', by: 'distill' }) + '\n')
  await page.getByTestId('nav-library').click()
  await page.waitForTimeout(1500)
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('review-prompt')).toContainText('first of the five constant factors')
  await page.getByTestId('review-reveal').click()
  await expect(page.getByTestId('review-answer')).toContainText('The Moral Law')
  await page.getByTestId('review-next').click()
  await expect(page.getByTestId('review-done')).toBeVisible()
  const log = await page.evaluate(() => window.api.stats.get())
  expect(log.K).toBeGreaterThan(0)
  await app.close()
})

test('open in book navigates to the reader', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await page.getByTestId('nav-review').waitFor()
  await page.evaluate(async () => {
    const book = (await window.api.library.list()).find(b => b.format === 'epub')!
    await window.api.highlights.add(book.id, {
      location: 'epubcfi(/6/4)', quote: { exact: 'x y', prefix: '', suffix: '' }, context: 'a x y b',
      chapter: null, position: 0, color: 'blue', note: 'What is x y?'
    })
  })
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('review-prompt')).toHaveText('x y')
  await expect(page.getByTestId('review-note')).toHaveText('What is x y?')
  await page.getByTestId('review-open').click()
  await expect(page.getByTestId('view-reader')).toBeVisible()
  await app.close()
})

test('note cards show the note text immediately', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await page.getByTestId('nav-review').waitFor()
  await page.evaluate(async () => {
    const book = (await window.api.library.list()).find(b => b.format === 'epub')!
    await window.api.highlights.addNote(book.id, { location: '', chapter: null, position: 0, text: 'my own thought' })
  })
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('review-prompt')).toHaveText('my own thought')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('review-done')).toBeVisible()
  await app.close()
})
