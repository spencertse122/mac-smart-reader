import { stat } from 'node:fs/promises'
import { readJson, writeJson } from './atomic'

export interface JsonFile<T> {
  read(): Promise<T>
  update(mutate: (draft: T) => T | void): Promise<T>
}

// Single-writer cached JSON document. Updates are serialized so concurrent IPC calls never lose writes.
export function jsonFile<T>(
  path: string,
  fallback: () => T,
  opts: { afterWrite?: (value: T) => Promise<void> } = {}
): JsonFile<T> {
  let cache: T | undefined
  let chain: Promise<unknown> = Promise.resolve()

  // Another device (Drive sync) may rewrite the file, so each load compares mtime:size with the last one we saw.
  let sig: string | null = null
  const statSig = async (): Promise<string | null> => {
    try {
      const st = await stat(path)
      return `${st.mtimeMs}:${st.size}`
    } catch {
      return null
    }
  }

  const load = async (): Promise<T> => {
    const now = await statSig()
    // A file that vanished after a cached load keeps the cache.
    if (cache === undefined || (now !== null && now !== sig)) {
      // Keep the signature from before the read: a swap mid-read then differs next time and reloads.
      cache = await readJson(path, fallback)
      sig = now
    }
    return cache as T
  }

  return {
    read: () => chain.then(load),
    update(mutate) {
      const p = chain.then(async () => {
        const current = await load()
        const before = JSON.stringify(current)
        const next = (mutate(current) ?? current) as T
        cache = next
        if (JSON.stringify(next) === before) return next
        await writeJson(path, next)
        sig = await statSig()
        if (opts.afterWrite) await opts.afterWrite(next)
        return next
      })
      chain = p.catch(() => undefined)
      return p
    }
  }
}
