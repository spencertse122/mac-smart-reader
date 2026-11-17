import { useEffect } from 'react'
import { useAppState } from '../state/appState'
import { refreshBooks } from '../state/actions'

// Opening a book and reading both update the persisted book record; pick that up whenever the view changes.
export function useBookRefresh(): void {
  const { state, dispatch } = useAppState()
  const viewName = state.view.name
  const readerBookId = state.view.name === 'reader' ? state.view.bookId : null
  useEffect(() => { if (state.root) void refreshBooks(dispatch).catch(() => undefined) }, [viewName, readerBookId, state.root, dispatch])
}
