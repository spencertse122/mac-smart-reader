import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('library shows all books, extracts real titles and covers, searches', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await expect(page.getByTestId('book-tile')).toHaveCount(4)
  await expect(page.getByTestId('book-tile').filter({ hasText: 'The Art of War' }).first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => page.evaluate(async () => (await window.api.library.list()).every(b => b.metadataExtracted || b.status !== 'ok')), { timeout: 30_000 }).toBe(true)
  await page.getByTestId('library-search').fill('zzzz-no-match')
  await expect(page.getByTestId('book-tile')).toHaveCount(0)
  await page.getByTestId('library-search').fill('')
  await page.getByTestId('book-tile').first().click()
  await expect(page.getByTestId('view-reader')).toBeVisible()
  await app.close()
})
