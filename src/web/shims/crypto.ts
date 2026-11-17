import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export function createHash(alg: string) {
  if (alg !== 'sha256') throw new Error(`Unsupported hash: ${alg}`)
  const h = sha256.create()
  const api = {
    update(x: string | Uint8Array) {
      h.update(typeof x === 'string' ? new TextEncoder().encode(x) : x)
      return api
    },
    digest(_enc: 'hex'): string {
      return bytesToHex(h.digest())
    }
  }
  return api
}

export const randomUUID = (): string => globalThis.crypto.randomUUID()
