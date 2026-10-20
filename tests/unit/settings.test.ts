import { it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from '../../src/main/settings'
import { DEFAULT_SETTINGS } from '../../src/shared/types'

it('returns defaults, merges partial files, patches nested pomodoro, remembers libraries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sr-set-'))
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ libraryPath: '/books' }))
  const s = new SettingsStore(dir)
  expect(await s.get()).toEqual({ ...DEFAULT_SETTINGS, libraryPath: '/books' })
  const u = await s.update({ pomodoro: { ...DEFAULT_SETTINGS.pomodoro, workMin: 50 } })
  expect(u.pomodoro.workMin).toBe(50)
  expect(u.pomodoro.breakMin).toBe(5)
  for (const p of ['/a', '/b', '/c', '/d', '/e', '/a', '/f']) await s.rememberLibrary(p)
  const r = await s.get()
  expect(r.libraryPath).toBe('/f')
  expect(r.recentLibraries).toEqual(['/f', '/a', '/e', '/d', '/c'])
})
