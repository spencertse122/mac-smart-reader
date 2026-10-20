import { describe, expect, it } from 'vitest'
import { drawable } from '../../src/renderer/src/reader/drawable'
import type { Highlight } from '../../src/shared/types'

const h = (o: Partial<Highlight>): Highlight => ({ id: 'a', location: 'c', quote: { exact: 'x', prefix: '', suffix: '' }, context: '', position: 0, color: 'yellow', createdAt: '', ...o }) as Highlight

describe('drawable', () => {
  it('drops notes and deleted, keeps highlights with or without kind', () => {
    const list = [h({ id: '1' }), h({ id: '2', kind: 'highlight' }), h({ id: '3', kind: 'note' }), h({ id: '4', deleted: true })]
    expect(drawable(list).map(x => x.id)).toEqual(['1', '2'])
  })
})
