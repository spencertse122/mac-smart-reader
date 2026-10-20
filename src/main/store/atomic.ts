import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export interface RecoveryEvent { path: string; restoredFromBackup: boolean; corruptCopy: string }

let recoveryListener: ((e: RecoveryEvent) => void) | null = null
export function setRecoveryListener(fn: ((e: RecoveryEvent) => void) | null): void {
  recoveryListener = fn
}

function isNotFound(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === 'ENOENT'
}

export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await fs.copyFile(path, `${path}.bak`)
  } catch (e) {
    if (!isNotFound(e)) throw e
  }
  await fs.rename(tmp, path)
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(value, null, 2) + '\n')
}

export async function readJson<T>(path: string, fallback: () => T): Promise<T> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (e) {
    if (isNotFound(e)) return fallback()
    throw e
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    const corruptCopy = `${path}.corrupt-${Date.now()}`
    await fs.rename(path, corruptCopy)
    try {
      const restored = JSON.parse(await fs.readFile(`${path}.bak`, 'utf8')) as T
      await writeJson(path, restored)
      recoveryListener?.({ path, restoredFromBackup: true, corruptCopy })
      return restored
    } catch {
      recoveryListener?.({ path, restoredFromBackup: false, corruptCopy })
      return fallback()
    }
  }
}
