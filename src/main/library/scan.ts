import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { formatFromPath } from './ids'

const SKIP_DIRS = new Set(['knowledge', 'node_modules'])
// When the user picks ~ itself: walking these is slow and can trigger macOS privacy (TCC) prompts.
const HOME_SKIP_DIRS = new Set(['Library', 'Applications', 'Pictures', 'Music', 'Movies'])

export async function scanFolder(root: string, home: string = homedir()): Promise<string[]> {
  const out: string[] = []
  const isHome = resolve(root) === resolve(home)
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || (isHome && dir === root && HOME_SKIP_DIRS.has(e.name))) continue
        await walk(abs)
      } else if (e.isFile() && formatFromPath(e.name)) {
        out.push(relative(root, abs).split(sep).join('/'))
      }
    }
  }
  await walk(root)
  return out.sort()
}
