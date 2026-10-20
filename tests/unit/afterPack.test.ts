import { describe, it, expect } from 'vitest'
import { chmod, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Hook = (ctx: { appOutDir: string; electronPlatformName: string; packager: { appInfo: { productFilename: string } } }) => Promise<void>
const afterPack = (createRequire(import.meta.url)('../../scripts/after-pack.cjs') as { default: Hook }).default

const PREBUILDS = 'Smart Reader.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds'
const ctx = (appOutDir: string, electronPlatformName = 'darwin') => ({ appOutDir, electronPlatformName, packager: { appInfo: { productFilename: 'Smart Reader' } } })

describe('afterPack hook', () => {
  it('makes every darwin spawn-helper in the bundle executable', async () => {
    const out = await mkdtemp(join(tmpdir(), 'sr-pack-'))
    for (const arch of ['darwin-arm64', 'darwin-x64']) {
      await mkdir(join(out, PREBUILDS, arch), { recursive: true })
      await writeFile(join(out, PREBUILDS, arch, 'spawn-helper'), 'bin')
      await chmod(join(out, PREBUILDS, arch, 'spawn-helper'), 0o644) // as shipped in the npm tarball
    }
    await afterPack(ctx(out))
    for (const arch of ['darwin-arm64', 'darwin-x64']) {
      expect((await stat(join(out, PREBUILDS, arch, 'spawn-helper'))).mode & 0o777).toBe(0o755)
    }
  })

  it('fails the build when the prebuilds are missing, and ignores other platforms', async () => {
    const out = await mkdtemp(join(tmpdir(), 'sr-pack-'))
    await expect(afterPack(ctx(out))).rejects.toThrow('node-pty')
    await expect(afterPack(ctx(out, 'linux'))).resolves.toBeUndefined()
  })
})
