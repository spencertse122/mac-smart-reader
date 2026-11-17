import { execFileSync } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { FakeDrive } from './fakeDrive'

const REPO = resolve(__dirname, '../..')

export type SeedSummary = {
  books: Array<{ id: string; path: string; slug: string }>
  epubId: string
  highlightId: string
  wordId: string
  location: string
}

// Runs a macTool command in a child process so the Mac services see the real disk.
export function macTool<T = unknown>(command: string, dir: string, ...args: string[]): T {
  const out = execFileSync(join(REPO, 'node_modules/.bin/jiti'), [join(REPO, 'tests/web/macTool.ts'), command, dir, ...args], {
    cwd: REPO,
    encoding: 'utf8'
  })
  return JSON.parse(out) as T
}

let cached: { dir: string; summary: SeedSummary } | null = null

// A library prepared by the real Mac Workspace, uploaded into the fake Drive. Seeded once per test file.
export function seedFake(fake: FakeDrive): SeedSummary {
  if (!cached) {
    const dir = mkdtempSync(join(tmpdir(), 'sr-mac-'))
    cached = { dir, summary: macTool<SeedSummary>('seed', dir) }
  }
  fake.seedFromDir(cached.dir)
  return cached.summary
}
