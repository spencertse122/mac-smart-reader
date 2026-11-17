import { mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { test as base, expect, type Frame, type Page } from '@playwright/test'
import { FakeDrive } from '../web/fakeDrive'
import { macTool, type SeedSummary } from '../web/mirror'

export { expect }
export const LIB = 'Books'
const GSI_STUB = readFileSync(resolve(__dirname, 'gsiStub.js'), 'utf8')

type Seeded = { dir: string; summary: SeedSummary }

// Drive root: Books (a library prepared by the real Mac services) beside two unrelated folders.
export const test = base.extend<{ fake: FakeDrive; seed: SeedSummary }, { seeded: Seeded }>({
  seeded: [
    async ({}, use) => {
      const dir = mkdtempSync(join(tmpdir(), 'sr-web-e2e-'))
      const summary = macTool<SeedSummary>('seed', join(dir, LIB))
      mkdirSync(join(dir, 'Documents'))
      mkdirSync(join(dir, 'Photos'))
      await use({ dir, summary })
    },
    { scope: 'worker' }
  ],
  fake: async ({ seeded }, use) => {
    const fake = new FakeDrive()
    fake.seedFromDir(seeded.dir)
    await use(fake)
  },
  seed: async ({ seeded }, use) => use(seeded.summary),
  page: async ({ page, fake }, use) => {
    page.on('pageerror', e => console.log(`[pageerror] ${e.message}`))
    await page.route('https://accounts.google.com/gsi/client', r => r.fulfill({ body: GSI_STUB, contentType: 'text/javascript' }))
    await page.route('https://www.googleapis.com/**', async r => {
      const req = r.request()
      if (req.url().startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ email: 'reader@example.com' }) })
      }
      const body = req.postDataBuffer()
      const res = await fake.fetch(req.url(), { method: req.method(), headers: req.headers(), body: body ? new Uint8Array(body) : undefined })
      const headers: Record<string, string> = { 'access-control-allow-origin': '*' }
      res.headers.forEach((v, k) => (headers[k] = v))
      await r.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) })
    })
    await use(page)
  }
})

// Edits the web app holds that have not reached Drive yet.
export const pending = (page: Page): Promise<number> =>
  page.evaluate(() => (window.api as unknown as { sync(): { pending(): number } | null }).sync()?.pending() ?? -1)

export const json = (fake: FakeDrive, path: string): any => JSON.parse(new TextDecoder().decode(fake.readFile(path)))

// Sign in with the stubbed Google button and pick the library the folder picker detects.
export async function signIn(page: Page): Promise<void> {
  await page.goto('/')
  const button = page.getByTestId('google-signin')
  await expect(button).toBeEnabled()
  await button.tap()
  await page.getByTestId('choose-folder').tap()
  const detected = page.getByTestId('detected-folder')
  await expect(detected).toHaveCount(1)
  await expect(detected).toHaveText(LIB)
  await detected.tap()
  await expect(page.getByTestId('view-library')).toBeVisible()
}

// The iframe foliate renders the current section into, once it has real text.
export async function bookFrame(page: Page, minText = 200): Promise<Frame> {
  let found: Frame | null = null
  await expect
    .poll(async () => {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue
        const len = await f.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0)
        if (len >= minText) {
          found = f
          return true
        }
      }
      return false
    }, { timeout: 20_000 })
    .toBe(true)
  return found!
}

export const readerCfi = (page: Page): Promise<string> =>
  page.evaluate(() => (document.querySelector('foliate-view') as unknown as { lastLocation?: { cfi?: string } } | null)?.lastLocation?.cfi ?? '')

// Long-press selection is not automatable on every engine, so select a visible sentence with the
// Selection API (as the OS would) and let the reader's selectionchange handler raise the popup.
export async function selectSentence(frame: Frame, chars = 40): Promise<string> {
  return frame.evaluate(n => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const fr = (window.frameElement as HTMLElement).getBoundingClientRect()
    let node: Node | null
    while ((node = walker.nextNode())) {
      const t = node.textContent ?? ''
      const i = t.search(/\S/)
      if (t.trim().length <= n + 5) continue
      const r = document.createRange()
      r.setStart(node, i)
      r.setEnd(node, i + n)
      const rr = r.getBoundingClientRect()
      const x = rr.left + fr.left
      const y = rr.top + fr.top
      if (x < 0 || rr.right + fr.left > window.parent.innerWidth || y < 150 || y > window.parent.innerHeight - 150) continue
      const s = document.getSelection()!
      s.removeAllRanges()
      s.addRange(r)
      return r.toString()
    }
    throw new Error('no visible sentence to select')
  }, chars)
}

// Characters of book text actually on screen (inside the reader's page area), not merely in the iframe.
export async function visibleTextLength(frame: Frame): Promise<number> {
  return frame.evaluate(() => {
    const fr = (window.frameElement as HTMLElement).getBoundingClientRect()
    const w = window.parent.innerWidth
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n = 0
    let node: Node | null
    while ((node = walker.nextNode())) {
      const r = document.createRange()
      r.selectNodeContents(node)
      for (const rect of r.getClientRects()) {
        const left = rect.left + fr.left
        if (rect.width > 0 && left >= 0 && left + rect.width <= w) n += Math.round(rect.width / 8)
      }
    }
    return n
  })
}

// Brings the toolbar up with a fresh 3 s auto-hide window: waits for it to hide, then taps the page middle.
// (Using an already-visible toolbar races its auto-hide.)
export async function showToolbar(page: Page): Promise<void> {
  const reader = page.getByTestId('view-reader')
  await expect(reader).toHaveClass(/chrome-hidden/, { timeout: 6_000 })
  const vp = page.viewportSize()!
  await page.touchscreen.tap(vp.width / 2, vp.height / 2)
  await expect(reader).not.toHaveClass(/chrome-hidden/)
}

// Taps the first characters of the text node that starts with `words` (what selectSentence selected).
export async function tapText(page: Page, frame: Frame, words: string): Promise<void> {
  const at = await frame.evaluate(text => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const raw = node.textContent ?? ''
      if (!raw.replace(/\s+/g, ' ').trim().startsWith(text.slice(0, 20))) continue
      const r = document.createRange()
      const start = raw.search(/\S/)
      r.setStart(node, start)
      r.setEnd(node, start + 5)
      const rr = r.getBoundingClientRect()
      const fr = (window.frameElement as HTMLElement).getBoundingClientRect()
      return { x: rr.left + rr.width / 2 + fr.left, y: rr.top + rr.height / 2 + fr.top }
    }
    return null
  }, words)
  if (!at) throw new Error(`text not on the page: ${words}`)
  await page.touchscreen.tap(at.x, at.y)
}

// Opens the book the tab bar offers to continue and waits for its text.
export async function openContinue(page: Page): Promise<Frame> {
  await page.getByTestId('tab-continue').tap()
  await expect(page.getByTestId('view-reader')).toBeVisible()
  return bookFrame(page)
}

// Selects a sentence and saves it as a yellow highlight; returns the quote as the sheet shows it.
export async function highlightSentence(page: Page, frame: Frame): Promise<string> {
  const quote = await selectSentence(frame)
  await expect(page.getByTestId('hl-popup')).toBeVisible()
  await page.getByTestId('hl-color-yellow').tap()
  await expect(page.getByTestId('hl-popup')).toHaveCount(0)
  return quote.replace(/\s+/g, ' ').trim()
}
