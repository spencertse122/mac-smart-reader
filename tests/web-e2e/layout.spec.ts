import type { Page } from '@playwright/test'
import { test, expect, signIn, openContinue, selectSentence, showToolbar } from './fixtures'

test.use({ viewport: { width: 390, height: 844 } })

const TABS = ['library', 'review', 'vocab', 'stats'] as const

// Every visible control smaller than a 44×44 CSS px hit area (a control inside a <label> is hit through the label).
function smallTargets(page: Page, scope = 'body'): Promise<string[]> {
  return page.evaluate(scopeSel => {
    const out: string[] = []
    const root = document.querySelector(scopeSel)
    if (!root) return [`no ${scopeSel}`]
    for (const el of root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role=button]')) {
      const hit = el.tagName === 'INPUT' && el.closest('label') ? el.closest('label')! : el
      const r = hit.getBoundingClientRect()
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || el.closest('[aria-hidden=true]')) continue
      // Layout size, not the (possibly mid-animation, scaled) bounding box.
      const w = hit.offsetWidth
      const h = hit.offsetHeight
      if (w < 44 || h < 44) {
        const label = el.getAttribute('aria-label') ?? el.dataset.testid ?? el.textContent?.trim().slice(0, 20) ?? ''
        out.push(`${el.tagName.toLowerCase()} "${label}" ${w}x${h}`)
      }
    }
    return out
  }, scope)
}

async function checkScreen(page: Page, name: string): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name}: horizontal overflow`).toBeLessThanOrEqual(390)
  await expect(page.getByText('Terminal', { exact: false }), `${name}: desktop-only Terminal`).toHaveCount(0)
  expect(await smallTargets(page), `${name}: touch targets under 44 px`).toEqual([])
}

test('every tab fits a 390 px phone, with a tab bar of large targets and no desktop-only UI', async ({ page }) => {
  await signIn(page)
  const tabbar = page.locator('nav.tabbar')
  for (const t of TABS) {
    await page.getByTestId(`tab-${t}`).tap()
    await expect(page.getByTestId(`view-${t}`)).toBeVisible()
    await expect(tabbar).toBeVisible()
    // let lazy content (charts, covers) settle before measuring
    await page.waitForLoadState('networkidle')
    for (const b of await tabbar.getByRole('button').all()) {
      const box = (await b.boundingBox())!
      expect(box.height, `tab button on ${t}`).toBeGreaterThanOrEqual(44)
    }
    await checkScreen(page, t)
  }
})

test('the reader fits the phone, its toolbar has large targets, and selection offers no dictionary', async ({ page }) => {
  await signIn(page)
  const frame = await openContinue(page)
  await showToolbar(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  expect(await smallTargets(page, '.reader-toolbar'), 'reader toolbar targets under 44 px').toEqual([])
  await expect(page.getByText('Terminal')).toHaveCount(0)

  await selectSentence(frame)
  await expect(page.getByTestId('hl-popup')).toBeVisible()
  await expect(page.getByTestId('hl-lookup')).toHaveCount(0)
  expect(await smallTargets(page, '[data-testid=hl-popup]'), 'popup targets under 44 px').toEqual([])
})

test('a tapped toolbar button does not keep the toolbar up', async ({ page }) => {
  await signIn(page)
  await openContinue(page)
  await showToolbar(page)
  const reader = page.getByTestId('view-reader')
  const bar = page.locator('.reader-toolbar')
  await bar.getByTestId('pomodoro-start').tap()
  await showToolbar(page)
  // Tapping a button focuses it on Android Chrome; that focus must not count as "typing in the toolbar".
  await bar.getByTestId('pomodoro-toggle').tap()
  if (test.info().project.name === 'mobile-chromium') {
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid)).toBe('pomodoro-toggle')
  }
  await expect(reader).not.toHaveClass(/chrome-hidden/)
  await expect(reader).toHaveClass(/chrome-hidden/, { timeout: 5_000 })
})

test('after a toolbar button opens a sheet and it is closed, the toolbar still hides after 3 s', async ({ page }) => {
  await signIn(page)
  await openContinue(page)
  await showToolbar(page)
  const reader = page.getByTestId('view-reader')
  // Tapping a button focuses it on Android; closing the sheet from its scrim leaves that focus in the toolbar.
  await page.getByTestId('open-highlights').tap()
  await expect(page.getByTestId('highlights-sheet')).toBeVisible()
  await page.touchscreen.tap(195, 60)
  await expect(page.getByTestId('highlights-sheet')).toHaveCount(0)
  await expect(reader).not.toHaveClass(/chrome-hidden/)
  await expect(reader).toHaveClass(/chrome-hidden/, { timeout: 5_000 })
})
