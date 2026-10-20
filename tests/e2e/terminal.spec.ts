import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('terminal opens in the books folder, runs commands, survives toggle, supports tabs', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  const toggle = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('event:menu', { type: 'toggle-terminal' }))
  await toggle()
  const panel = page.getByTestId('terminal-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.xterm-rows')).toContainText('Smart Reader')
  await panel.locator('.xterm').click()
  await page.keyboard.type('pwd && echo SR_TERMINAL_OK\n')
  await expect(panel.locator('.xterm-rows')).toContainText('SR_TERMINAL_OK', { timeout: 15_000 })
  await expect(panel.locator('.xterm-rows')).toContainText(library.split('/').pop()!)
  await toggle()
  await expect(panel).toBeHidden()
  await toggle()
  await expect(panel.locator('.xterm-rows')).toContainText('SR_TERMINAL_OK')
  await page.getByTestId('term-new-tab').click()
  await expect(panel.locator('.xterm')).toHaveCount(2)
  await app.close()
})
