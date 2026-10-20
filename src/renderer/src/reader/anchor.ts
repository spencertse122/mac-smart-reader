import type { TextQuote } from '../../../shared/types'

function commonSuffix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

function commonPrefix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

// Finds the best occurrence of quote.exact in the document, scored by how well prefix/suffix match.
export function findQuoteRange(doc: Document, quote: TextQuote): Range | null {
  if (!quote.exact) return null
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  const starts: number[] = []
  let full = ''
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    starts.push(full.length)
    nodes.push(n as Text)
    full += (n as Text).data
  }
  let best = -1
  let bestScore = -1
  for (let i = full.indexOf(quote.exact); i >= 0; i = full.indexOf(quote.exact, i + 1)) {
    const score = commonSuffix(full.slice(0, i), quote.prefix) + commonPrefix(full.slice(i + quote.exact.length), quote.suffix)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  if (best < 0) return null
  const locate = (offset: number, isEnd: boolean): [Text, number] => {
    for (let k = 0; k < nodes.length; k++) {
      const s = starts[k]
      const e = s + nodes[k].data.length
      if (offset < e || (isEnd && offset === e)) return [nodes[k], offset - s]
    }
    const last = nodes[nodes.length - 1]
    return [last, last.data.length]
  }
  const range = doc.createRange()
  const [sn, so] = locate(best, false)
  const [en, eo] = locate(best + quote.exact.length, true)
  range.setStart(sn, so)
  range.setEnd(en, eo)
  return range
}
