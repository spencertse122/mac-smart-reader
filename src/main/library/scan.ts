import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { formatFromPath } from './ids'

const SKIP_DIRS = new Set(['knowledge', 'node_modules'])

export async function scanFolder(root: string): Promise<string[]> {
  const out: string[] = []
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
        if (!SKIP_DIRS.has(e.name)) await walk(abs)
      } else if (e.isFile() && formatFromPath(e.name)) {
        out.push(relative(root, abs).split(sep).join('/'))
      }
    }
  }
  await walk(root)
  return out.sort()
}
