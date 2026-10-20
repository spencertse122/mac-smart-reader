import { test, expect, type Frame, type Page } from '@playwright/test'
import { appendFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, makeLibrary } from './helpers'

async function contentFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().filter(f => f.url().startsWith('blob:')).length, { timeout: 20_000 }).toBeGreaterThan(0)
  for (let i = 0; i < 40; i++) {
    for (const f of page.frames().filter(f => f.url().startsWith('blob:'))) {
      const len = await f.evaluate(() => document.body?.innerText.trim().length ?? 0).catch(() => 0)
      if (len > 200) return f
    }
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(250)
  }
  throw new Error('no content frame')
}

async function selectSomeText(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find(x => x.firstChild?.nodeType === Node.TEXT_NODE && (x.firstChild as Text).data.trim().split(/\s+/).length > 8)!
    const t = p.firstChild as Text
    const r = document.createRange()
    r.setStart(t, 0)
    r.setEnd(t, Math.min(30, t.data.length))
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(r)
    p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
}

test('first run → read → highlight → agent adds question → review → stats', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })

  // workspace was prepared for agents
  for (const p of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'knowledge/index.md', '.claude/skills/distill/SKILL.md', '.agents/skills/recall/SKILL.md']) {
    expect(existsSync(join(library, p)), p).toBe(true)
  }

  // read and highlight
  await expect(page.getByTestId('book-tile').filter({ hasText: 'The Art of War' }).first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('book-tile').filter({ hasText: 'The Art of War' }).first().click()
  const frame = await contentFrame(page)
  await selectSomeText(frame)
  await expect(page.getByTestId('hl-popup')).toBeVisible()
  await page.getByTestId('hl-color-yellow').click()
  await expect(page.getByTestId('due-badge')).toHaveText('1')

  // highlights mirror exists for the agent
  const lib = JSON.parse(await readFile(join(library, '.smartreader/library.json'), 'utf8'))
  const book = Object.values(lib.books as Record<string, { slug: string; title: string; id: string }>).find(b => b.title.includes('Art of War'))!
  const md = await readFile(join(library, `.smartreader/books/${book.slug}/highlights.md`), 'utf8')
  const hid = /- id: (h_[0-9a-f-]+)/.exec(md)![1]

  // simulate the coach agent writing a better question
  await appendFile(join(library, 'knowledge/prompts.jsonl'), JSON.stringify({ highlightId: hid, question: 'AGENT QUESTION?', answer: 'agent answer', by: 'distill' }) + '\n')
  await page.waitForTimeout(1500)

  // review it
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('review-prompt')).toHaveText('AGENT QUESTION?')
  await page.keyboard.press('Space')
  await page.keyboard.press('3')
  await expect(page.getByTestId('review-done')).toBeVisible()
  const log = (await readFile(join(library, '.smartreader/review-log.jsonl'), 'utf8')).trim().split('\n')
  expect(JSON.parse(log[0])).toMatchObject({ highlightId: hid, rating: 'good', promptType: 'ai' })

  // stats
  await page.getByTestId('nav-stats').click()
  await expect(page.getByTestId('kpi-rate')).toBeVisible()
  await app.close()
})

// Regression: a book whose cover dir already existed when the library opened used to save its first highlight with bookId ''.
test('restart → highlight a book whose cover was extracted last session → it becomes a review card', async () => {
  const library = await makeLibrary()
  type B = { id: string; slug: string; metadataExtracted: boolean; hasCover: boolean; status: string }
  const books = async (): Promise<B[]> => {
    try {
      return Object.values(JSON.parse(await readFile(join(library, '.smartreader/library.json'), 'utf8')).books as Record<string, B>)
    } catch {
      return []
    }
  }
  const first = await launchApp({ library })
  await expect.poll(async () => {
    const bs = (await books()).filter(b => b.status === 'ok')
    return bs.length > 0 && bs.every(b => b.metadataExtracted) && bs.some(b => b.hasCover)
  }, { timeout: 30_000 }).toBe(true)
  await first.app.close()
  for (const b of await books()) expect(existsSync(join(library, `.smartreader/books/${b.slug}/highlights.json`))).toBe(false)

  const { app, page } = await launchApp({ library })
  await expect(page.getByTestId('book-tile').filter({ hasText: 'The Art of War' }).first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('book-tile').filter({ hasText: 'The Art of War' }).first().click()
  await selectSomeText(await contentFrame(page))
  await expect(page.getByTestId('hl-popup')).toBeVisible()
  await page.getByTestId('hl-color-yellow').click()
  await expect(page.getByTestId('due-badge')).toHaveText('1')
  const book = (await books()).find(b => existsSync(join(library, `.smartreader/books/${b.slug}/highlights.json`)))!
  expect(existsSync(join(library, `.smartreader/books/${book.slug}/cover.jpg`))).toBe(true)
  const file = JSON.parse(await readFile(join(library, `.smartreader/books/${book.slug}/highlights.json`), 'utf8'))
  expect(file.bookId).toBe(book.id)
  expect(file.highlights).toHaveLength(1)
  expect(existsSync(join(library, `.smartreader/books/${book.slug}/highlights.md`))).toBe(true)
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('review-prompt')).toBeVisible()
  await app.close()
})
