import { test, expect } from '@playwright/test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { contentFrame, launchApp, makeLibrary, openBook } from './helpers'

test('EPUB: write a note from the toolbar, see it in the panel and highlights.md, due badge increments', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  const id = await openBook(page, 'epub')
  await contentFrame(page)

  await page.getByTestId('reader-note').click()
  await expect(page.getByTestId('note-composer')).toBeVisible()
  await expect(page.getByTestId('note-input')).toBeFocused()
  await expect(page.getByTestId('note-save')).toBeDisabled()
  await page.getByTestId('note-input').fill('   ')
  await expect(page.getByTestId('note-save')).toBeDisabled()

  // Esc cancels and arrows inside the composer do not turn pages.
  await page.getByTestId('note-input').fill('discarded')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('note-composer')).toHaveCount(0)

  await page.getByTestId('reader-note').click()
  await page.getByTestId('note-input').fill('My own thought about this')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByTestId('note-composer')).toHaveCount(0)

  await expect.poll(() => page.evaluate(b => window.api.highlights.list(b).then(h => h.filter(x => x.kind === 'note').length), id)).toBe(1)
  const [note] = await page.evaluate(b => window.api.highlights.list(b), id)
  expect(note.note).toBe('My own thought about this')
  expect(note.quote.exact).toBe('')
  await expect(page.getByTestId('due-badge')).toHaveText('1')

  await page.getByTestId('nav-highlights').click()
  await expect(page.getByTestId('note-item')).toHaveCount(1)
  await expect(page.getByTestId('note-item')).toContainText('My own thought about this')

  // Edit through the panel.
  await page.getByTestId('note-edit').click()
  await page.getByTestId('note-edit-input').fill('Edited thought')
  await page.getByTestId('note-edit-save').click()
  await expect(page.getByTestId('note-item')).toContainText('Edited thought')

  const books = join(library, '.smartreader', 'books')
  const md = async (): Promise<string> => {
    const all = await Promise.all((await readdir(books)).map(d => readFile(join(books, d, 'highlights.md'), 'utf8').catch(() => '')))
    return all.join('\n')
  }
  await expect.poll(md).toContain('**Note:** Edited thought')

  await page.getByTestId('note-delete').click()
  await expect(page.getByTestId('note-item')).toHaveCount(0)
  await app.close()
})
