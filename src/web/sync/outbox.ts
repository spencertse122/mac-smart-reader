import { createStore, del, entries, set } from 'idb-keyval'

// A pending upload. `baseMd5`/`baseText` describe the last-synced Drive version the local data was
// derived from, so a replay after a restart can still three-way merge. `remove` = trash on Drive.
export type OutboxItem = { path: string; data: Uint8Array; baseMd5: string | null; baseText?: string | null; remove?: boolean }

export interface OutboxStore {
  put(item: OutboxItem): Promise<void>
  delete(path: string): Promise<void>
  all(): Promise<OutboxItem[]>
}

export function idbOutbox(key = 'sr.outbox'): OutboxStore {
  const store = createStore(key, 'items')
  return {
    put: item => set(item.path, item, store),
    delete: path => del(path, store),
    all: async () => (await entries<string, OutboxItem>(store)).map(([, v]) => v)
  }
}
