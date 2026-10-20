import type { Highlight } from '../../../shared/types'

// Notes are never drawn on the page nor anchored; only real highlights take part in overlay logic.
export const isDrawable = (h: Highlight): boolean => h.kind !== 'note' && !h.deleted

export const drawable = (list: Highlight[]): Highlight[] => list.filter(isDrawable)
