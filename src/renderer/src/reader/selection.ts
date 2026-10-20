import { LIMITS, type TextQuote } from '../../../shared/types'

const BLOCKS = 'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, figcaption, pre'

export function quoteFromRange(range: Range): TextQuote {
  const doc = range.startContainer.ownerDocument!
  const before = doc.createRange()
  before.setStart(doc.body, 0)
  before.setEnd(range.startContainer, range.startOffset)
  const after = doc.createRange()
  after.setStart(range.endContainer, range.endOffset)
  after.setEnd(doc.body, doc.body.childNodes.length)
  return {
    exact: range.toString(),
    prefix: before.toString().slice(-LIMITS.quoteAffixChars),
    suffix: after.toString().slice(0, LIMITS.quoteAffixChars)
  }
}

function closestBlock(n: Node): Element | null {
  const el = n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement
  return el?.closest(BLOCKS) ?? el?.closest('div, section, body') ?? null
}

export function contextFromRange(range: Range, max: number = LIMITS.contextChars): string {
  const exact = range.toString().replace(/\s+/g, ' ').trim()
  const text = (closestBlock(range.commonAncestorContainer)?.textContent ?? exact).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const i = text.indexOf(exact)
  if (i < 0) return exact.slice(0, max)
  const pad = Math.max(0, Math.floor((max - exact.length) / 2))
  const start = Math.max(0, Math.min(i - pad, text.length - max))
  return text.slice(start, start + max)
}
