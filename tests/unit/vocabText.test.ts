import { describe, expect, it } from 'vitest'
import { emphasize, lookupTerm, sentenceAround } from '../../src/renderer/src/vocab/text'

describe('lookupTerm', () => {
  it('accepts short selections', () => {
    expect(lookupTerm('  serendipity ')).toBe('serendipity')
    expect(lookupTerm('a  b c d')).toBe('a b c d')
  })
  it('rejects empty, long and many-word selections', () => {
    expect(lookupTerm('  ')).toBeNull()
    expect(lookupTerm('a b c d e')).toBeNull()
    expect(lookupTerm('x'.repeat(65))).toBeNull()
  })
})

describe('sentenceAround', () => {
  const ctx = 'He left early. The ephemeral joy of the morning faded fast! Nobody noticed.'
  it('returns the containing sentence', () => {
    expect(sentenceAround(ctx, 'ephemeral')).toBe('The ephemeral joy of the morning faded fast!')
    expect(sentenceAround(ctx, 'He')).toBe('He left early.')
    expect(sentenceAround(ctx, 'Nobody')).toBe('Nobody noticed.')
  })
  it('caps long sentences around the selection', () => {
    const long = 'word '.repeat(200) + 'target ' + 'word '.repeat(200) + '.'
    const s = sentenceAround(long, 'target', 300)
    expect(s.length).toBeLessThanOrEqual(300)
    expect(s).toContain('target')
  })
  it('falls back when the selection is not found', () => {
    expect(sentenceAround('Some text here.', 'zzz')).toBe('Some text here.')
    expect(sentenceAround('', 'abc')).toBe('abc')
  })
})

describe('emphasize', () => {
  const join = (s: ReturnType<typeof emphasize>) => s.filter(x => x.hit).map(x => x.text)
  it('matches the headword case-insensitively', () => {
    expect(join(emphasize('Ephemeral things end.', ['ephemeral']))).toEqual(['Ephemeral'])
  })
  it('matches inflected forms by stem', () => {
    expect(join(emphasize('She was running and he runs.', ['run']))).toEqual(['running', 'runs'])
    expect(join(emphasize('A serendipitous find', ['serendipity']))).toEqual(['serendipitous'])
  })
  it('matches the selected form too and keeps all text', () => {
    const segs = emphasize('They walked on.', ['stroll', 'walked'])
    expect(join(segs)).toEqual(['walked'])
    expect(segs.map(s => s.text).join('')).toBe('They walked on.')
  })
  it('does not match mid-word and survives regex chars', () => {
    expect(join(emphasize('carpet', ['pet']))).toEqual([])
    expect(() => emphasize('a (b) c', ['(b)', null])).not.toThrow()
  })
})
