import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('stats page renders KPIs and charts after a review', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await expect(page.getByTestId('nav-stats')).toBeVisible()
  await page.evaluate(async () => {
    const book = (await window.api.library.list()).find(b => b.format === 'epub')!
    const h = await window.api.highlights.add(book.id, {
      location: 'epubcfi(/6/4)', quote: { exact: 'all warfare', prefix: '', suffix: '' }, context: 'all warfare is deception',
      chapter: null, position: 0, color: 'yellow', note: null
    })
    await window.api.review.rate(h.id, 'good', 2000, 'cloze')
  })
  await page.getByTestId('nav-stats').click()
  await expect(page.getByTestId('kpi-rate')).toBeVisible()
  await expect(page.locator('[data-testid="view-stats"] svg').first()).toBeVisible()
  await expect(page.getByTestId('status-rate')).toBeVisible()
  await app.close()
})
