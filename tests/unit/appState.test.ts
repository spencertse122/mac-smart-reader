import { it, expect } from 'vitest'
import { reducer, initialState } from '../../src/renderer/src/state/appState'
import { DEFAULT_SETTINGS } from '../../src/shared/types'

it('handles the core navigation and library flow', () => {
  let s = reducer(initialState, { type: 'settings', settings: DEFAULT_SETTINGS })
  expect(s.settings).toEqual(DEFAULT_SETTINGS)
  s = reducer(s, { type: 'libraryOpened', root: '/books', books: [] })
  expect(s).toMatchObject({ status: 'ready', root: '/books', view: { name: 'library' }, sidebarTab: 'library' })
  s = reducer(s, { type: 'navigate', view: { name: 'reader', bookId: 'b1' } })
  expect(s.sidebarTab).toBe('highlights')
  s = reducer(s, { type: 'navigate', view: { name: 'review' } })
  expect(s.sidebarTab).toBe('review')
  s = reducer(s, { type: 'toggleTerminal' })
  expect(s).toMatchObject({ terminalOpen: true, terminalMounted: true })
  s = reducer(s, { type: 'toggleTerminal' })
  expect(s).toMatchObject({ terminalOpen: false, terminalMounted: true })
  s = reducer(s, { type: 'toast', toast: { kind: 'error', message: 'x' } })
  s = reducer(s, { type: 'toast', toast: { kind: 'info', message: 'y' } })
  expect(s.toasts.map(t => t.message)).toEqual(['x', 'y'])
  s = reducer(s, { type: 'dismissToast', id: s.toasts[0].id })
  expect(s.toasts.map(t => t.message)).toEqual(['y'])
  s = reducer(s, { type: 'libraryClosed' })
  expect(s).toMatchObject({ status: 'ready', root: null, books: [] })
})
