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

  const load = async (): Promise<T> => {
    if (cache === undefined) cache = await readJson(path, fallback)
    return cache
  }

  return {
    read: () => chain.then(load),
    update(mutate) {
      const p = chain.then(async () => {
        const current = await load()
        const next = (mutate(current) ?? current) as T
        cache = next
        await writeJson(path, next)
        if (opts.afterWrite) await opts.afterWrite(next)
        return next
      })
      chain = p.catch(() => undefined)
      return p
    }
  }
}
