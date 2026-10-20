import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
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
  const { app, page } = await launchApp({ library: '/no/such/library', waitForShell: false })
  await expect(page.getByTestId('choose-folder')).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('Folder not found')
  await app.close()
})

test('a second instance on the same data hands over to the running window and exits', async () => {
  const { app, userData } = await launchApp()
  await app.evaluate(({ app: electronApp }) => {
    const g = globalThis as unknown as { __second: number }
    g.__second = 0
    electronApp.on('second-instance', () => g.__second++)
  })
  const bin = process.env.SR_APP_PATH ?? (createRequire(__filename)('electron') as string)
  const args = process.env.SR_APP_PATH ? [] : ['.']
  if (process.platform === 'linux') args.push('--no-sandbox')
  const second = spawn(bin, args, { env: { ...process.env, SR_USER_DATA: userData, SR_E2E: '1' }, stdio: 'ignore' })
  const code = await Promise.race([
    new Promise<number | null>(r => second.on('exit', c => r(c))),
    new Promise<'running'>(r => setTimeout(() => r('running'), 15_000))
  ])
  if (code === 'running') second.kill()
  expect(code).toBe(0)
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __second: number }).__second)).toBe(1)
  expect(app.windows()).toHaveLength(1)
  await app.close()
})
