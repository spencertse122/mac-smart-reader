import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { readJson, writeFileAtomic, writeJson } from '../store/atomic'

export interface SetupResult { created: string[]; updated: string[]; skipped: string[] }
interface Manifest { version: 1; files: Record<string, string> }

const sha = (s: Buffer | string): string => createHash('sha256').update(s).digest('hex')

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string): Promise<void> {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = join(d, e.name)
      if (e.isDirectory()) await walk(abs)
      else if (e.isFile()) out.push(relative(dir, abs).split(sep).join('/'))
    }
  }
  await walk(dir)
  return out.sort()
}

async function readMaybe(p: string): Promise<Buffer | null> {
  try {
    return await readFile(p)
  } catch {
    return null
  }
}

export async function setupWorkspace(root: string, templateDir: string): Promise<SetupResult> {
  const result: SetupResult = { created: [], updated: [], skipped: [] }
  const manifestPath = join(root, '.smartreader', 'template-manifest.json')
  const manifest = await readJson<Manifest>(manifestPath, () => ({ version: 1, files: {} }))

  const plan: Array<{ src: string; dest: string; createOnly: boolean }> = []
  for (const rel of await listFiles(templateDir)) {
    const [top, ...rest] = rel.split('/')
    const tail = rest.join('/')
    if (top === 'root') plan.push({ src: rel, dest: tail, createOnly: false })
    else if (top === 'knowledge') plan.push({ src: rel, dest: `knowledge/${tail}`, createOnly: true })
    else if (top === 'skills') {
      plan.push({ src: rel, dest: `.claude/skills/${tail}`, createOnly: false })
      plan.push({ src: rel, dest: `.agents/skills/${tail}`, createOnly: false })
    }
  }

  for (const { src, dest, createOnly } of plan) {
    const template = await readFile(join(templateDir, src))
    const tHash = sha(template)
    const destAbs = join(root, dest)
    const current = await readMaybe(destAbs)
    if (current === null) {
      await writeFileAtomic(destAbs, template)
      if (!createOnly) manifest.files[dest] = tHash
      result.created.push(dest)
      continue
    }
    if (createOnly) {
      result.skipped.push(dest)
      continue
    }
    const cHash = sha(current)
    if (cHash === tHash) {
      manifest.files[dest] = tHash
      result.skipped.push(dest)
    } else if (manifest.files[dest] === cHash) {
      await writeFileAtomic(destAbs, template)
      manifest.files[dest] = tHash
      result.updated.push(dest)
    } else {
      result.skipped.push(dest) // edited by the user: never clobber
    }
  }

  await mkdir(join(root, 'knowledge', 'concepts'), { recursive: true })
  await mkdir(join(root, 'knowledge', 'books'), { recursive: true })
  await writeJson(manifestPath, manifest)
  return result
}
