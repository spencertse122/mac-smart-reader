import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { detectDrm, detectEpubDrm } from '../../src/main/library/drm'

const enc = (alg: string) =>
  `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/></enc:EncryptedData></encryption>`

describe('epub drm', () => {
  it('no encryption.xml => not DRM', () => {
    expect(detectEpubDrm(zipSync({ mimetype: strToU8('application/epub+zip') }))).toBeNull()
  })
  it('font obfuscation only => not DRM', () => {
    expect(detectEpubDrm(zipSync({ 'META-INF/encryption.xml': strToU8(enc('http://www.idpf.org/2008/embedding')) }))).toBeNull()
    expect(detectEpubDrm(zipSync({ 'META-INF/encryption.xml': strToU8(enc('http://ns.adobe.com/pdf/enc#RC')) }))).toBeNull()
  })
  it('real encryption => DRM', () => {
    expect(detectEpubDrm(zipSync({ 'META-INF/encryption.xml': strToU8(enc('http://www.w3.org/2001/04/xmlenc#aes128-cbc')) }))).toMatch(/DRM/)
  })
  it('rights.xml => Adobe DRM', () => {
    expect(detectEpubDrm(zipSync({ 'META-INF/rights.xml': strToU8('<rights/>') }))).toMatch(/Adobe DRM/)
  })
})

function mobi(encryption: number): Buffer {
  const header = Buffer.alloc(86)
  header.write('BOOKMOBI', 60, 'latin1')
  header.writeUInt16BE(1, 76) // record count
  header.writeUInt32BE(86, 78) // record 0 offset
  const rec0 = Buffer.alloc(16)
  rec0.writeUInt16BE(encryption, 12)
  return Buffer.concat([header, rec0])
}

describe('mobi drm', () => {
  it('reads the encryption field of record 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sr-drm-'))
    await writeFile(join(dir, 'free.mobi'), mobi(0))
    await writeFile(join(dir, 'locked.azw3'), mobi(2))
    expect(await detectDrm(join(dir, 'free.mobi'), 'mobi')).toBeNull()
    expect(await detectDrm(join(dir, 'locked.azw3'), 'azw3')).toMatch(/Kindle DRM/)
  })
  it('garbage input is not DRM and does not throw', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sr-drm-'))
    await writeFile(join(dir, 'junk.epub'), 'not a zip')
    await writeFile(join(dir, 'junk.mobi'), 'short')
    expect(await detectDrm(join(dir, 'junk.epub'), 'epub')).toBeNull()
    expect(await detectDrm(join(dir, 'junk.mobi'), 'mobi')).toBeNull()
  })
})
