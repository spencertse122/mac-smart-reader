import { md5 } from '@noble/hashes/legacy.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export const md5hex = (data: Uint8Array): string => bytesToHex(md5(data))

const encoder = new TextEncoder()
const decoder = new TextDecoder()
export const enc = (s: string): Uint8Array => encoder.encode(s)
export const dec = (b: Uint8Array): string => decoder.decode(b)

// Files whose content we three-way merge (and so keep the last-synced text of).
export const isMergeable = (path: string): boolean => /\.jsonl?$/.test(path)

export function parsesAsJson(data: Uint8Array): boolean {
  try {
    JSON.parse(dec(data))
    return true
  } catch {
    return false
  }
}

// Runs `fn` over `items` with at most `limit` in flight.
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
