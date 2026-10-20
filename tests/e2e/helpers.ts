import { _electron as electron, expect, type ElectronApplication, type Frame, type Page } from '@playwright/test'
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const FIXTURES = resolve(__dirname, '../fixtures/books')

// Copies the fixture books into a fresh temp library folder.
export async function makeLibrary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sr-lib-'))
  await cp(FIXTURES, dir, { recursive: true })
  return dir
}

// The library opens asynchronously after launch; window.api.library.* fails until the shell is up.
export async function waitForLibrary(page: Page): Promise<void> {
  await page.getByTestId('app-shell').waitFor({ state: 'visible', timeout: 30_000 })
}

export async function launchApp(opts: { library?: string; waitForShell?: boolean } = {}): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = await mkdtemp(join(tmpdir(), 'sr-user-'))
  if (opts.library) {
    await mkdir(userData, { recursive: true })
    await writeFile(join(userData, 'settings.json'), JSON.stringify({ libraryPath: opts.library }))
  }
  const executablePath = process.env.SR_APP_PATH // set in the release smoke test to the packaged binary
  const args = executablePath ? [] : ['.']
  if (process.platform === 'linux') args.push('--no-sandbox')
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args,
    env: { ...process.env, SR_USER_DATA: userData, SR_E2E: '1' } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  if (opts.library && opts.waitForShell !== false) await waitForLibrary(page)
  return { app, page, userData }
}

export async function openBook(page: Page, format: string): Promise<string> {
  // The library opens asynchronously after launch; the shell appears once it is ready.
  await expect(page.getByTestId('app-shell')).toBeVisible()
  const id = await page.evaluate(async f => (await window.api.library.list()).find(b => b.format === f)!.id, format)
  // An opened book appears in both Continue Reading and All Books.
  await page.locator(`[data-book-id="${id}"]`).first().click()
  await expect(page.getByTestId('view-reader')).toBeVisible()
  return id
}

// The PDF fixture holds a single short sentence per page, so it uses a lower threshold.
export async function contentFrame(page: Page, minChars = 200): Promise<Frame> {
  await expect.poll(() => page.frames().filter(f => f.url().startsWith('blob:')).length, { timeout: 20_000 }).toBeGreaterThan(0)
  for (let i = 0; i < 40; i++) {
    for (const f of page.frames().filter(f => f.url().startsWith('blob:'))) {
      const len = await f.evaluate(() => document.body?.innerText.trim().length ?? 0).catch(() => 0)
      if (len > minChars) return f
    }
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(250)
  }
  throw new Error('no content frame with text')
}
