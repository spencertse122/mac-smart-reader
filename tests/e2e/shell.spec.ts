import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('first launch shows Welcome', async () => {
  const { app, page } = await launchApp()
  await expect(page.getByTestId('choose-folder')).toBeVisible()
  await app.close()
})

test('remembered library opens to the shell; navigation and terminal toggle work', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('view-review')).toBeVisible()
  await page.getByTestId('nav-stats').click()
  await expect(page.getByTestId('view-stats')).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('event:menu', { type: 'toggle-terminal' }))
  await expect(page.getByTestId('terminal-panel')).toBeVisible()
  await app.close()
})

test('missing remembered folder falls back to Welcome with an error toast', async () => {
  const { app, page } = await launchApp({ library: '/no/such/library' })
  await expect(page.getByTestId('choose-folder')).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('Folder not found')
  await app.close()
})
