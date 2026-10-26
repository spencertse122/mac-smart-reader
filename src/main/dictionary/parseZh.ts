// Parses raw Oxford Chinese Dictionary (OCD) text into a short Simplified Chinese gloss plus a readable full entry.
const CIRCLED = '[\\u2460-\\u2473\\u3251-\\u325F]'
const CIRCLED_G = new RegExp(CIRCLED, 'g')
const CIRCLED_NUMS = '①②③④'
const MAX_SENSES = 4

function body(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!/^\p{Script=Latin}/u.test(t) || !t.includes(' | ')) return null
  const first = t.indexOf(' | ')
  const second = t.indexOf(' | ', first + 3)
  // `headword | pronunciation | body`; with a single pipe the rest is the body
  return (second === -1 ? t.slice(first + 3) : t.slice(second + 3)).trim()
}

function senseGloss(sense: string): string {
  let t = sense.split('▸')[0]
  t = t.replace(/«[^»]*»/g, ' ').replace(/‹[^›]*›/g, ' ').replace(/\([^)]*\)/g, ' ')
  const out: string[] = []
  for (const piece of t.split(';')) {
    const m = /[㐀-䶿一-鿿][^\p{Script=Latin}]*/u.exec(piece)
    const run = m?.[0].replace(/[\s,，、.。:：]+$/u, '').trim()
    if (run && !out.includes(run)) out.push(run)
  }
  return out.join('；')
}

export function parseZh(raw: string): { gloss: string; entry: string } | null {
  try {
    const b = body(raw)
    if (b === null) return null
    const senses = b.split(CIRCLED_G).map(senseGloss).filter(Boolean).slice(0, MAX_SENSES)
    if (senses.length === 0) return null
    const gloss = senses.length === 1 ? senses[0] : senses.map((s, i) => `${CIRCLED_NUMS[i]} ${s}`).join(' ')
    const entry = b
      .replace(/(?<![A-Za-z])([A-F])\.\s/g, '\n$1. ')
      .replace(new RegExp(`(${CIRCLED})`, 'g'), '\n$1')
      .replace(/▸/g, '\n▸')
      .split('\n')
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
    return { gloss, entry }
  } catch {
    return null
  }
}

// For a body that is only a cross-reference such as `adverb = nevertheless`, returns the target word.
export function zhCrossRef(raw: string): string | null {
  try {
    const b = body(raw)
    if (b === null || /[㐀-鿿]/.test(b)) return null
    const m = /^[^=]*=\s*(\p{Script=Latin}[\p{Script=Latin}'’ -]*?)\s*$/u.exec(b)
    return m ? m[1] : null
  } catch {
    return null
  }
}
