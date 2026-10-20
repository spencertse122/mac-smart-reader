import { test, expect } from '@playwright/test'
import { launchApp } from './helpers'

test('app window loads, exposes api, and can load foliate-js', async () => {
  const { app, page } = await launchApp()
  await expect(page).toHaveTitle('Smart Reader')
  expect(await page.evaluate(() => typeof window.api.settings.get)).toBe('function')
  const ok = await page.evaluate(async () => {
    await import(/* @vite-ignore */ new URL('foliate-js/view.js', document.baseURI).href)
    return !!customElements.get('foliate-view')
  })
  expect(ok).toBe(true)
  await app.close()
})
