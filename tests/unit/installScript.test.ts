import { describe, it, expect } from 'vitest'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const path = resolve(__dirname, '../../install.sh')

// Sources install.sh without running main, then feeds `json` to asset_url <arch>.
function assetUrl(json: string, arch: string): { out: string; status: number | null } {
  const r = spawnSync('bash', ['-c', 'source "$1"; asset_url "$2"', '_', path, arch], {
    input: json,
    env: { ...process.env, SMART_READER_INSTALL_NO_MAIN: '1' },
    encoding: 'utf8'
  })
  return { out: r.stdout.trim(), status: r.status }
}

const base = 'https://github.com/spencertse122/mac-smart-reader/releases/download/v0.1.0'
const assets = [`${base}/Smart-Reader-0.1.0-x64.dmg`, `${base}/Smart-Reader-0.1.0-arm64.dmg`, `${base}/Smart-Reader-0.1.0-arm64.dmg.blockmap`]
const release = { tag_name: 'v0.1.0', assets: assets.map(u => ({ name: u.split('/').pop(), url: 'https://api.github.com/x', browser_download_url: u })) }

describe('install.sh', () => {
  it('is valid bash and targets the right repo and assets', async () => {
    execFileSync('bash', ['-n', path])
    const s = await readFile(path, 'utf8')
    expect(s).toContain('spencertse122/mac-smart-reader')
    expect(s).not.toContain('afreeelfdobby934-sys')
    expect(s).toContain('gh release download')
    expect(s).toContain('https://api.github.com/repos/${REPO}/releases/latest')
    expect(s).toContain('brew install gh && gh auth login')
    expect(s).toContain('xattr -dr com.apple.quarantine')
    expect(s).toMatch(/arm64/)
    expect(s).toMatch(/x64/)
    expect(s).toContain('/Applications/Smart Reader.app')
    expect(s).not.toMatch(/\|\s*(jq|python3?)\b/) // stock macOS has neither
    // macOS ships bash 3.2, which treats a multibyte char after $VAR as part of the name ("ARCH…: unbound variable")
    expect(s).toMatch(/^[\x00-\x7F]*$/)
  })

  it('asset_url picks the DMG for the arch from pretty-printed API JSON', () => {
    const json = JSON.stringify(release, null, 2)
    expect(assetUrl(json, 'arm64')).toEqual({ out: `${base}/Smart-Reader-0.1.0-arm64.dmg`, status: 0 })
    expect(assetUrl(json, 'x64')).toEqual({ out: `${base}/Smart-Reader-0.1.0-x64.dmg`, status: 0 })
  })

  it('asset_url handles compact JSON and prints nothing when no asset matches', () => {
    expect(assetUrl(JSON.stringify(release), 'arm64').out).toBe(`${base}/Smart-Reader-0.1.0-arm64.dmg`)
    expect(assetUrl(JSON.stringify({ message: 'Not Found' }), 'arm64').out).toBe('')
  })

  it('falls back from an unauthenticated gh to curl, and explains private repos when both fail', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'sr-install-'))
    const log = join(bin, 'calls.log')
    const stub = async (name: string, body: string): Promise<void> => {
      await writeFile(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`)
      await chmod(join(bin, name), 0o755)
    }
    await stub('uname', '[[ "$1" == "-m" ]] && echo arm64 || echo Darwin')
    await stub('gh', 'exit 1') // installed but not logged in
    await stub('curl', 'exit 22') // e.g. 404 for a private repo
    const r = spawnSync('bash', [path], { env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('If the repository is private')
    expect(r.stderr).toContain('brew install gh && gh auth login')
    const calls = await readFile(log, 'utf8')
    expect(calls).toContain('gh auth status')
    expect(calls).not.toContain('gh release download')
    expect(calls).toContain('curl -fsSL -H Accept: application/vnd.github+json https://api.github.com/repos/spencertse122/mac-smart-reader/releases/latest')
  })
})
