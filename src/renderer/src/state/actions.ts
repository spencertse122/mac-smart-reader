import type { Dispatch } from 'react'
import type { Settings, Toast } from '../../../shared/types'
import type { Action } from './appState'

export function toast(dispatch: Dispatch<Action>, kind: Toast['kind'], message: string): void {
  dispatch({ type: 'toast', toast: { kind, message } })
}

export async function openLibrary(dispatch: Dispatch<Action>, path: string): Promise<boolean> {
  const r = await window.api.library.open(path)
  if (!r.ok) {
    toast(dispatch, 'error', r.error)
    return false
  }
  dispatch({ type: 'libraryOpened', root: r.root, books: r.books })
  dispatch({ type: 'settings', settings: await window.api.settings.get() })
  await refreshDueCount(dispatch)
  return true
}

export async function chooseAndOpenLibrary(dispatch: Dispatch<Action>): Promise<void> {
  const path = await window.api.library.chooseFolder()
  if (path) await openLibrary(dispatch, path)
}

export async function refreshBooks(dispatch: Dispatch<Action>): Promise<void> {
  dispatch({ type: 'books', books: await window.api.library.list() })
}

export async function refreshDueCount(dispatch: Dispatch<Action>): Promise<void> {
  dispatch({ type: 'dueCount', count: await window.api.review.dueCount() })
}

export async function updateSettings(dispatch: Dispatch<Action>, patch: Partial<Settings>): Promise<void> {
  dispatch({ type: 'settings', settings: await window.api.settings.update(patch) })
}
