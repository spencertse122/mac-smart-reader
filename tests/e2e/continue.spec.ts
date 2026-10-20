import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('Continue Reading returns to the last opened book', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await page.getByTestId('nav-library').waitFor()
  await expect(page.getByTestId('nav-continue')).toHaveCount(0)
  const bookId = await page.evaluate(async () => (await window.api.library.list()).find(b => b.format === 'epub')!.id)
  await page.evaluate(id => window.api.library.markOpened(id), bookId)
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('nav-continue')).toBeVisible()
  await expect(page.getByTestId('nav-continue')).toContainText('%')
  await page.getByTestId('nav-continue').click()
  await expect(page.getByTestId('view-reader')).toBeVisible()
  await expect(page.getByTestId('nav-continue')).toHaveClass(/active/)
  await app.close()
})
