import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { launchApp, makeLibrary } from './helpers'

// A minimal EPUB 3 whose chapter tries every way to run script and reach the app's window.api.
function hostileEpub(): Uint8Array {
  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Chapter</title><script src="a.js"></script><script>parent.__pwnedInline = 1</script></head>
<body>
<h1>Hostile chapter</h1>
<p>This chapter ships scripts that try to reach the reader app through the parent window and run commands in its terminal.</p>
<img src="missing.png" onerror="parent.__pwnedAttr = 1" alt="" />
<p>More ordinary text so the section has content to paginate and read in the reader view.</p>
</body>
</html>`
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head>
<body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">Chapter</a></li></ol></nav></body></html>`
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:5b1c0f0e-0000-4000-8000-000000000001</dc:identifier>
<dc:title>Script Trap</dc:title><dc:creator>Mallory</dc:creator><dc:language>en</dc:language>
<meta property="dcterms:modified">2026-10-20T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml" properties="scripted"/>
<item id="js" href="a.js" media-type="application/javascript"/>
</manifest>
<spine><itemref idref="ch1"/></spine>
</package>`
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/ch1.xhtml': strToU8(chapter),
    'OEBPS/a.js': strToU8('parent.__pwned = 1; parent.__pwnedApi = typeof parent.api')
  })
}

test('scripts inside an EPUB never run or reach window.api', async () => {
  const library = await makeLibrary()
  await writeFile(join(library, 'script-trap.epub'), hostileEpub())
  const { app, page } = await launchApp({ library })
  const tile = page.getByTestId('book-tile').filter({ hasText: 'Script Trap' }).first()
  await expect(tile).toBeVisible({ timeout: 30_000 })
  await tile.click()
  // the chapter rendered, so any script in it had its chance to run
  await expect.poll(async () => {
    for (const f of page.frames().filter(f => f.url().startsWith('blob:'))) {
      if (await f.evaluate(() => document.body?.innerText.includes('Hostile chapter')).catch(() => false)) return true
    }
    return false
  }, { timeout: 20_000 }).toBe(true)
  await page.waitForTimeout(1000)
  const flags = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    return { src: w.__pwned, inline: w.__pwnedInline, attr: w.__pwnedAttr, api: w.__pwnedApi }
  })
  expect(flags).toEqual({ src: undefined, inline: undefined, attr: undefined, api: undefined })
  await app.close()
})

test('the window never navigates away from the app, and file drops are swallowed', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  const appUrl = page.url()
  const server = createServer((_, res) => res.end('<h1>not the app</h1>'))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const web = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  // record instead of launching a browser
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened: string[] }
    g.__opened = []
    shell.openExternal = async (url: string) => {
      g.__opened.push(url)
    }
  })
  for (const url of [web, 'file:///etc/hosts']) {
    await page.evaluate(u => {
      location.href = u
    }, url)
    await page.waitForTimeout(1000)
    expect(page.url()).toBe(appUrl)
  }
  // (a locator would wait forever on the cancelled navigation, so ask the DOM directly)
  expect(await page.evaluate(() => !!document.querySelector('[data-testid="app-shell"]'))).toBe(true)
  expect(await app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)).toEqual([web])
  server.close()

  const prevented = await page.evaluate(() => {
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })
    document.body.dispatchEvent(over)
    document.body.dispatchEvent(drop)
    return { over: over.defaultPrevented, drop: drop.defaultPrevented }
  })
  expect(prevented).toEqual({ over: true, drop: true })
  await app.close()
})
