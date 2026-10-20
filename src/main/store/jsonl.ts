import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export async function appendJsonl(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.appendFile(path, JSON.stringify(value) + '\n', 'utf8')
}

export async function readJsonl<T>(path: string): Promise<{ items: T[]; skipped: number }> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { items: [], skipped: 0 }
    throw e
  }
  const items: T[] = []
  let skipped = 0
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const v = JSON.parse(t)
      if (v && typeof v === 'object' && !Array.isArray(v)) items.push(v as T)
      else skipped++
    } catch {
      skipped++
    }
  }
  return { items, skipped }
}
