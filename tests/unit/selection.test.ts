// @vitest-environment jsdom
/// <reference lib="dom" />
import { it, expect } from 'vitest'
import { quoteFromRange, contextFromRange } from '../../src/renderer/src/reader/selection'
import { findQuoteRange } from '../../src/renderer/src/reader/anchor'

function docWith(html: string): Document {
  const d = document.implementation.createHTMLDocument('t')
  d.body.innerHTML = html
  return d
}

function rangeOf(d: Document, needle: string, occurrence = 0): Range {
  const r = findQuoteRange(d, { exact: needle, prefix: '', suffix: '' })
  if (!r) throw new Error('not found')
  if (occurrence === 0) return r
  throw new Error('unsupported')
}

it('quote captures prefix and suffix up to 64 chars', () => {
  const d = docWith('<p>Alpha beta gamma.</p><p>Delta epsilon zeta.</p>')
  const q = quoteFromRange(rangeOf(d, 'gamma.Delta'))
  expect(q.exact).toBe('gamma.Delta')
  expect(q.prefix).toBe('Alpha beta ')
  expect(q.suffix).toBe(' epsilon zeta.')
})

it('context is the enclosing paragraph, trimmed around the quote when long', () => {
  const d = docWith('<p>Short para with target words inside.</p>')
  expect(contextFromRange(rangeOf(d, 'target words'))).toBe('Short para with target words inside.')
  const long = 'x '.repeat(500) + 'needle here' + ' y'.repeat(500)
  const d2 = docWith(`<p>${long}</p>`)
  const ctx = contextFromRange(rangeOf(d2, 'needle here'), 100)
  expect(ctx.length).toBeLessThanOrEqual(100)
  expect(ctx).toContain('needle here')
})

it('findQuoteRange disambiguates repeated text with prefix/suffix', () => {
  const d = docWith('<p>the cat sat. the cat ran.</p>')
  const r = findQuoteRange(d, { exact: 'the cat', prefix: 'sat. ', suffix: ' ran' })!
  const pre = d.createRange()
  pre.setStart(d.body, 0)
  pre.setEnd(r.startContainer, r.startOffset)
  expect(pre.toString()).toBe('the cat sat. ')
  expect(r.toString()).toBe('the cat')
})

it('findQuoteRange spans element boundaries and returns null when absent', () => {
  const d = docWith('<p>one <em>two</em> three</p>')
  expect(findQuoteRange(d, { exact: 'one two three', prefix: '', suffix: '' })?.toString()).toBe('one two three')
  expect(findQuoteRange(d, { exact: 'four', prefix: '', suffix: '' })).toBeNull()
})
