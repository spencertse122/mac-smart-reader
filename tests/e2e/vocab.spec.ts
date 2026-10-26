import { test, expect, type Frame } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentFrame, launchApp, makeLibrary, openBook } from './helpers'

// Selects the n-th word (letters only, 5+ chars) of the first long plain paragraph and fires the pointerup the reader listens for.
async function selectWord(frame: Frame, n: number): Promise<string> {
  return frame.evaluate(k => {
    const p = [...document.querySelectorAll('p')].find(x => x.firstChild?.nodeType === Node.TEXT_NODE && (x.firstChild as Text).data.trim().split(/\s+/).length > 12)!
    const text = p.firstChild as Text
    const words = [...text.data.matchAll(/[A-Za-z]{5,}/g)]
    const m = words[k]
    const r = document.createRange()
    r.setStart(text, m.index!)
    r.setEnd(text, m.index! + m[0].length)
    const sel = document.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    return m[0]
  }, n)
}

test('look up a word, see it in Vocabulary, review it as a word card; unknown word saves nothing', async () => {
  const library = await makeLibrary()
  const dir = await mkdtemp(join(tmpdir(), 'sr-dict-'))
  const stub = join(dir, 'dict.json')
  await writeFile(stub, '{}')
  const { app, page } = await launchApp({ library, env: { SR_DICT_STUB: stub } })
  await openBook(page, 'epub')
  const frame = await contentFrame(page)

  // Not found: message shown, nothing saved.
  const unknown = await selectWord(frame, 0)
  await expect(page.getByTestId('hl-popup')).toBeVisible()
  await page.getByTestId('hl-lookup').click()
  await expect(page.getByTestId('hl-lookup-msg')).toContainText(`No definition found for “${unknown}”.`)
  await expect(page.getByTestId('hl-lookup-saved')).toHaveCount(0)
  expect(await page.evaluate(() => window.api.vocab.list())).toHaveLength(0)

  // Found: definition shown and the word saved.
  await frame.evaluate(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
  await expect(page.getByTestId('hl-popup')).toHaveCount(0)
  const word = await selectWord(frame, 1)
  // zh sample is the real OCD line for "serendipity" with the headword swapped.
  const zhRaw = `${word.toLowerCase()} | BrE ˌsɛrənˈdɪpɪti, AmE ˌsɛrənˈdɪpədi | noun formal ① uncountable (luck) 机缘凑巧 jīyuán còuqiǎo ② countable (unplanned event) 巧事 qiǎo shì`
  await writeFile(stub, JSON.stringify({
    [word]: `${word} ${word.slice(0, 3)}·${word.slice(3)} | ˈfɔːbəl | noun a made-up test meaning: a thing used in tests. • another sense`,
    [`zh:${word}`]: zhRaw,
    [`zh:${word.toLowerCase()}`]: zhRaw
  }))
  await expect(page.getByTestId('hl-popup')).toBeVisible()
  await page.getByTestId('hl-lookup').click()
  await expect(page.getByTestId('hl-lookup-def')).toContainText('made-up test meaning')
  await expect(page.getByTestId('lookup-zh')).toHaveText('① 机缘凑巧 ② 巧事')
  await expect(page.getByTestId('lookup-zh-hint')).toHaveCount(0)
  await page.getByTestId('lookup-zh-more').click()
  await expect(page.getByTestId('lookup-zh-entry')).toContainText('jīyuán còuqiǎo')
  await expect(page.getByTestId('hl-lookup-saved')).toBeVisible()
  await expect(page.getByTestId('due-badge')).toHaveText('1')
  const saved = await page.evaluate(() => window.api.vocab.list())
  expect(saved).toHaveLength(1)
  expect(saved[0].contexts[0].sentence.length).toBeLessThanOrEqual(300)
  expect(saved[0].contexts[0].sentence.toLowerCase()).toContain(word.toLowerCase())

  // Vocabulary view
  await page.getByTestId('nav-vocab').click()
  await expect(page.getByTestId('vocab-item')).toHaveCount(1)
  await expect(page.getByTestId('vocab-headword')).toHaveText(word)
  await page.getByTestId('vocab-search').fill('zzzz-nothing')
  await expect(page.getByTestId('vocab-item')).toHaveCount(0)
  await page.getByTestId('vocab-search').fill('made-up')
  await expect(page.getByTestId('vocab-item')).toHaveCount(1)
  await expect(page.getByTestId('vocab-zh')).toHaveText('① 机缘凑巧 ② 巧事')
  await page.getByTestId('vocab-search').fill('巧事')
  await expect(page.getByTestId('vocab-item')).toHaveCount(1)

  // Review: front is only the headword; Space flips; Got it advances
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('review-prompt')).toHaveText(word)
  await expect(page.getByTestId('review-def')).toHaveCount(0)
  await expect(page.getByTestId('review-sooner')).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(page.getByTestId('review-def')).toContainText('made-up test meaning')
  await expect(page.getByTestId('review-zh')).toHaveText('① 机缘凑巧 ② 巧事')
  await expect(page.getByTestId('review-sooner')).toHaveText(/Forgot/)
  await expect(page.getByTestId('review-next')).toHaveText(/Got it/)
  await expect(page.getByTestId('review-context').locator('mark')).toHaveText(word)
  await page.getByTestId('review-next').click()
  await expect(page.getByTestId('review-done')).toBeVisible()

  // Delete from Vocabulary with confirm
  await page.getByTestId('nav-vocab').click()
  await page.getByTestId('vocab-delete').click()
  await page.getByTestId('vocab-delete-no').click()
  await expect(page.getByTestId('vocab-item')).toHaveCount(1)
  await page.getByTestId('vocab-delete').click()
  await page.getByTestId('vocab-delete-yes').click()
  await expect(page.getByTestId('vocab-empty')).toBeVisible()
  await app.close()
})

test('Chinese dictionary not installed: hint shown, English still works, no gloss', async () => {
  const library = await makeLibrary()
  const dir = await mkdtemp(join(tmpdir(), 'sr-dict-'))
  const stub = join(dir, 'dict.json')
  await writeFile(stub, '{}')
  const { app, page } = await launchApp({ library, env: { SR_DICT_STUB: stub } })
  await openBook(page, 'epub')
  const frame = await contentFrame(page)
  const word = await selectWord(frame, 1)
  await writeFile(stub, JSON.stringify({
    [word]: `${word} ${word.slice(0, 3)}·${word.slice(3)} | ˈfɔːbəl | noun a made-up test meaning: a thing used in tests.`,
    'zh:__unavailable__': true
  }))
  await expect(page.getByTestId('hl-popup')).toBeVisible()
  await page.getByTestId('hl-lookup').click()
  await expect(page.getByTestId('hl-lookup-def')).toContainText('made-up test meaning')
  await expect(page.getByTestId('lookup-zh-hint')).toBeVisible()
  await expect(page.getByTestId('lookup-zh')).toHaveCount(0)
  await app.close()
})
