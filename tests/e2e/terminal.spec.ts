import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
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

// Without a library (Welcome screen) nothing re-opens a workspace after reload, which used to be what killed the shells.
test('reloading the window kills the shells it started', async () => {
  const { app, page, userData } = await launchApp()
  const pidFile = join(userData, 'shell.pid')
  await page.evaluate(async file => {
    const id = await window.api.pty.create(80, 24)
    window.api.pty.write(id, `echo $$ > '${file}'\r`)
  }, pidFile)
  await expect.poll(() => readFile(pidFile, 'utf8').then(s => s.trim()).catch(() => ''), { timeout: 15_000 }).toMatch(/^\d+$/)
  const pid = Number((await readFile(pidFile, 'utf8')).trim())
  const alive = (): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  expect(alive()).toBe(true)
  // a navigation the app blocks (will-navigate) must not count as leaving the page
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => undefined
  })
  const server = createServer((_, res) => res.end('elsewhere'))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  await page.evaluate(port => {
    location.href = `http://127.0.0.1:${port}/`
  }, (server.address() as AddressInfo).port)
  await page.waitForTimeout(1000)
  server.close()
  expect(alive()).toBe(true)
  await page.reload()
  await expect.poll(alive, { timeout: 10_000 }).toBe(false)
  await app.close()
})
