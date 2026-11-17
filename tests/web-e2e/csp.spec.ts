import { createServer, type Server } from 'http'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname, join, resolve } from 'path'
import { strToU8, zipSync } from 'fflate'
import { test as base, expect, signIn, openContinue, bookFrame, LIB } from './fixtures'

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

// An EPUB whose chapter tries to run code two ways: an inline <script> and an inline event handler.
function hostileEpub(): Uint8Array {
  const text = 'This chapter is ordinary prose that a reader would expect to see on the page. '.repeat(8)
  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title>
<script>window.top.__pwned = 'script'; document.title = 'pwned'</script></head>
<body><h1>Chapter One</h1><p>${text}</p>
<img alt="x" src="data:image/png;base64,AAAA" onerror="window.top.__pwned = 'onerror'; document.title = 'pwned'"/>
<p>${text}</p></body></html>`
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head>
<body><nav epub:type="toc"><ol><li><a href="one.xhtml">One</a></li></ol></nav></body></html>`
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">hostile-1</dc:identifier>
<dc:title>Hostile Book</dc:title><dc:creator>Nobody</dc:creator><dc:language>en</dc:language>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="one" href="one.xhtml" media-type="application/xhtml+xml" properties="scripted"/></manifest>
<spine><itemref idref="one"/></spine></package>`
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/one.xhtml': strToU8(chapter)
  })
}

test('script and inline handlers in a book never run', async ({ page, fake }) => {
  fake.putFile(`${LIB}/hostile.epub`, hostileEpub())
  await signIn(page)
  await page.getByTestId('book-tile').filter({ hasText: 'Hostile Book' }).tap()
  await expect(page.getByTestId('view-reader')).toBeVisible()
  const frame = await bookFrame(page, 300)
  // the image has failed to load by now, so a permitted onerror would have run
  await expect.poll(() => frame.evaluate(() => (document.querySelector('img') as HTMLImageElement | null)?.complete ?? false)).toBe(true)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned ?? null)).toBeNull()
  for (const f of page.frames()) {
    expect(await f.evaluate(() => [(window as unknown as { __pwned?: string }).__pwned ?? null, document.title === 'pwned']).catch(() => [null, false])).toEqual([null, false])
  }
})

test('the CSP forbids plugins, <base> rewrites and framing', () => {
  expect(CSP).toContain("object-src 'none'")
  expect(CSP).toContain("base-uri 'none'")
  // 'self', not 'none': blob: book frames inherit this policy, and WebKit then refuses to frame them
  expect(CSP).toContain("frame-ancestors 'self'")
})
