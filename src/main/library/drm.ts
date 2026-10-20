import { open, readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import type { BookFormat } from '../../shared/types'

const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'])

export async function detectDrm(absPath: string, format: BookFormat): Promise<string | null> {
  try {
    if (format === 'epub') return detectEpubDrm(new Uint8Array(await readFile(absPath)))
    if (format === 'mobi' || format === 'azw' || format === 'azw3') {
      const fh = await open(absPath, 'r')
      try {
        const head = Buffer.alloc(82)
        const { bytesRead } = await fh.read(head, 0, 82, 0)
        if (bytesRead < 82) return null
        return await detectMobiDrmBuffer(head, async (offset, len) => {
          const b = Buffer.alloc(len)
          await fh.read(b, 0, len, offset)
          return b
        })
      } finally {
        await fh.close()
      }
    }
    return null
  } catch {
    return null // unreadable files are reported when the reader fails to open them
  }
}

export function detectEpubDrm(zip: Uint8Array): string | null {
  const files = unzipSync(zip, {
    filter: f => f.name === 'META-INF/encryption.xml' || f.name === 'META-INF/rights.xml'
  })
  if (files['META-INF/rights.xml']) return 'Protected by Adobe DRM'
  const enc = files['META-INF/encryption.xml']
  if (!enc) return null
  const xml = strFromU8(enc)
  const algorithms = [...xml.matchAll(/<(?:[\w-]+:)?EncryptionMethod[^>]*Algorithm\s*=\s*"([^"]+)"/g)].map(m => m[1])
  return algorithms.some(a => !FONT_OBFUSCATION.has(a)) ? 'Encrypted with DRM' : null
}

// PalmDB header: type/creator at 60..68, record 0 offset at 78. MOBI record 0: encryption type at +12.
export async function detectMobiDrmBuffer(
  head: Buffer,
  readAt: (offset: number, len: number) => Promise<Buffer>
): Promise<string | null> {
  if (head.toString('latin1', 60, 68) !== 'BOOKMOBI') return null
  const rec0 = head.readUInt32BE(78)
  const field = await readAt(rec0 + 12, 2)
  if (field.length < 2) return null
  return field.readUInt16BE(0) !== 0 ? 'Protected by Kindle DRM' : null
}
