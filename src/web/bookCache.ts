import { clear, createStore, get, set } from 'idb-keyval'

export interface BookCache {
  get(key: string): Promise<Uint8Array | undefined>
  put(key: string, data: Uint8Array): Promise<void>
  clear(): Promise<void>
}

// Book bytes in IndexedDB, keyed `driveId:md5`, so a changed file never serves stale bytes.
export function idbBookCache(dbName = 'sr-books'): BookCache {
  const store = createStore(dbName, 'books')
  return {
    get: async key => {
      try {
        return await get<Uint8Array>(key, store)
      } catch {
        return undefined
      }
    },
    // A full quota must not fail the read.
    put: async (key, data) => {
      try {
        await set(key, data, store)
      } catch {
        // ignore
      }
    },
    clear: () => clear(store)
  }
}
