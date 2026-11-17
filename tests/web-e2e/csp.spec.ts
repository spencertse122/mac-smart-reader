import { createServer, type Server } from 'http'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname, join, resolve } from 'path'
import { test as base, expect, signIn, openContinue, bookFrame } from './fixtures'

// The app as nginx serves it: same CSP string (read from web/nginx.conf, the one source of truth), so a
// blocked blob: iframe, worker or style fails here instead of in production.
const OUT = resolve(__dirname, '../../out/web')
const CSP = /add_header Content-Security-Policy "([^"]+)"/.exec(readFileSync(resolve(__dirname, '../../web/nginx.conf'), 'utf8'))![1]
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm'
}

const test = base.extend<{ violations: string[] }, { cspServer: { server: Server; url: string } }>({
  cspServer: [
    async ({}, use) => {
      const server = createServer((req, res) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0])
        let file = join(OUT, path)
        if (!file.startsWith(OUT) || !existsSync(file) || statSync(file).isDirectory()) file = join(OUT, 'index.html')
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
        res.setHeader('Content-Security-Policy', CSP)
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.end(readFileSync(file))
      })
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
      const addr = server.address() as { port: number }
      await use({ server, url: `http://127.0.0.1:${addr.port}/` })
      server.close()
    },
    { scope: 'worker' }
  ],
  baseURL: async ({ cspServer }, use) => use(cspServer.url),
  violations: async ({ page }, use) => {
    const seen: string[] = []
    page.on('console', m => {
      const t = m.text()
      if (/Content Security Policy|Refused to/i.test(t)) seen.push(t)
    })
    await use(seen)
  }
})

test('opening an EPUB under the production CSP raises no violation', async ({ page, violations }) => {
  await signIn(page)
  await openContinue(page)
  await page.waitForTimeout(1000)
  expect(violations).toEqual([])
})

test('opening the PDF under the production CSP raises no violation', async ({ page, seed, violations }) => {
  await signIn(page)
  const pdf = seed.books.find(b => b.path.endsWith('.pdf'))!
  await page.locator(`[data-testid=book-tile][data-book-id="${pdf.id}"]`).tap()
  await expect(page.getByTestId('view-reader')).toBeVisible()
  await bookFrame(page, 3)
  await page.waitForTimeout(1000)
  expect(violations).toEqual([])
})
