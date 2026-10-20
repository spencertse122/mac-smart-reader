import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test.skip(!process.env.SR_APP_PATH, 'runs only against a packaged app (SR_APP_PATH)')

test('packaged app lists books and node-pty works', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await expect(page.getByTestId('book-tile')).toHaveCount(4, { timeout: 30_000 })
  const ptyOk = await page.evaluate(async () => {
    const id = await window.api.pty.create(80, 24)
    const out = await new Promise<string>(resolve => {
      let buf = ''
      const off = window.api.pty.onData((pid, d) => {
        if (pid !== id) return
        buf += d
        if (buf.includes('SR_OK')) { off(); resolve(buf) }
      })
      window.api.pty.write(id, 'echo SR_OK\r')
    })
    window.api.pty.kill(id)
    return out.includes('SR_OK')
  })
  expect(ptyOk).toBe(true)
  await app.close()
})
