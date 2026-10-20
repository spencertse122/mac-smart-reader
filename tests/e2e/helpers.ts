import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
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

export async function launchApp(opts: { library?: string } = {}): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
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
  return { app, page, userData }
}
