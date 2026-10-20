import { it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const path = resolve(__dirname, '../../install.sh')

it('install.sh is valid bash and targets the right repo and assets', async () => {
  execFileSync('bash', ['-n', path])
  const s = await readFile(path, 'utf8')
  expect(s).toContain('afreeelfdobby934-sys/mac-smart-reader')
  expect(s).toContain('gh release download')
  expect(s).toContain('xattr -dr com.apple.quarantine')
  expect(s).toMatch(/arm64/)
  expect(s).toMatch(/x64/)
  expect(s).toContain('/Applications/Smart Reader.app')
})
