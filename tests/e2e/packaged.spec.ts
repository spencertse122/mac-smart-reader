import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { contentFrame, launchApp, makeLibrary, openBook } from './helpers'

test.skip(!process.env.SR_APP_PATH, 'runs only against a packaged app (SR_APP_PATH)')

test('packaged app lists books and node-pty works', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  // SR_EXPECT_ARCH proves the x64 build really ran as x64 (under Rosetta on an arm64 runner)
  if (process.env.SR_EXPECT_ARCH) expect(await app.evaluate(() => process.arch)).toBe(process.env.SR_EXPECT_ARCH)
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

// Exercises app:// inside the asar, foliate, the pdf.js module worker and the bundled workspace templates.
test('packaged app opens an EPUB and a PDF and sets up the agent workspace', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  for (const p of ['CLAUDE.md', 'AGENTS.md', '.claude/skills/recall/SKILL.md', '.claude/skills/distill/SKILL.md', 'knowledge/index.md']) {
    expect(existsSync(join(library, p)), p).toBe(true)
  }
  await openBook(page, 'epub')
  await contentFrame(page)
  await page.getByTestId('nav-library').click()
  await expect(page.getByTestId('view-reader')).toBeHidden()
  await openBook(page, 'pdf')
  await contentFrame(page, 20)
  await app.close()
})
