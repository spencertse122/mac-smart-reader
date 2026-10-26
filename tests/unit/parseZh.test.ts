import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseZh, zhCrossRef } from '../../src/main/dictionary/parseZh'

const samples = new Map<string, string>()
let cur = ''
for (const line of readFileSync(join(__dirname, '../fixtures/ocd-samples.txt'), 'utf8').split('\n')) {
  if (line.startsWith('--- ')) cur = line.slice(4).trim()
  else if (cur && line.trim()) samples.set(cur, line)
}
const sample = (w: string): string => {
  const s = samples.get(w)
  if (s === undefined) throw new Error(`no sample ${w}`)
  return s
}

describe('parseZh', () => {
  const table: Array<[string, string]> = [
    ['serendipity', '① 机缘凑巧 ② 巧事'],
    ['mitigate', '缓和；减轻'],
    ['ephemeral', '① 短暂的 ② 短生的'],
    ['ubiquitous', '普遍存在的'],
    ['epistemology', '认识论'],
    ['hegemony', '领导权；支配权'],
    ['set', '① 放置；安置 ② 确定；树立 ③ 设定 ④ 使开始'],
    ['running', '① 跑 ② 跑步 ③ 参加赛跑 ④ 逃跑']
  ]
  for (const [w, gloss] of table) {
    it(`glosses ${w}`, () => {
      expect(parseZh(sample(w))?.gloss).toBe(gloss)
    })
  }
  it('rejects non-English entries and misses', () => {
    expect(parseZh(sample('ran'))).toBeNull()
    expect(parseZh(sample('黑'))).toBeNull()
    expect(parseZh(sample('qwertyzx'))).toBeNull()
    expect(parseZh('')).toBeNull()
    expect(parseZh('garbage')).toBeNull()
    expect(parseZh('\u0000\ud800 | x')).toBeNull()
    expect(parseZh(undefined as unknown as string)).toBeNull()
  })
  it('has no gloss for a cross-reference but exposes its target', () => {
    const raw = sample('nonetheless')
    expect(parseZh(raw)).toBeNull()
    expect(zhCrossRef(raw)).toBe('nevertheless')
    expect(zhCrossRef(sample('serendipity'))).toBeNull()
    expect(zhCrossRef('garbage')).toBeNull()
  })
  it('breaks the entry before senses, bullets and parts', () => {
    const e = parseZh(sample('serendipity'))!.entry
    expect(e).toContain('\n① uncountable')
    expect(e).toContain('\n② countable')
    expect(e).toContain('jīyuán còuqiǎo')
    const u = parseZh(sample('ubiquitous'))!.entry
    expect(u).toContain('\n▸ ubiquitous presence')
    expect(parseZh(sample('set'))!.entry).toMatch(/^A\. transitive verb/)
    expect(parseZh(sample('running'))!.entry).toMatch(/\nB\. transitive verb/)
  })
})
