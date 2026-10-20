import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('pomodoro runs, break overlay appears, and offers review', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await expect(page.getByTestId('app-shell')).toBeVisible()
  // seed one highlight so a review card is due (the break overlay only offers Review when N > 0)
  await page.evaluate(async () => {
    const books = await window.api.library.list()
    await window.api.highlights.add(books.find(b => b.format === 'epub')!.id, {
      location: 'epubcfi(/6/4)', quote: { exact: 'all warfare is based on deception', prefix: '', suffix: '' },
      context: 'All warfare is based on deception.', chapter: 'I', position: 0.05, color: 'yellow', note: null
    })
  })
  await page.evaluate(() => window.api.settings.update({ pomodoro: { workMin: 0.02, breakMin: 0.05, longBreakMin: 0.05, longEvery: 4, sound: false } }))
  await page.reload()
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await page.getByTestId('pomodoro-start').click()
  await expect(page.getByTestId('break-overlay')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('break-review').click()
  await expect(page.getByTestId('break-overlay')).toBeHidden()
  await expect(page.locator('[data-testid="view-review"], [data-testid="review-empty"]').first()).toBeVisible()
  await app.close()
})
