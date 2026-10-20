import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Book } from '../../../shared/types'
import { useAppState } from '../state/appState'
import { refreshBooks, toast } from '../state/actions'
import { BookTile } from '../library/BookTile'
import { filterAndSort } from '../library/metadata'
import { runMetadataExtraction } from '../library/extract'
import '../library/library.css'

export function LibraryView() {
  const { state, dispatch } = useAppState()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'title' | 'author'>('recent')

  useEffect(() => {
    runMetadataExtraction(state.books, () => void refreshBooks(dispatch))
  }, [state.books, dispatch])

  const visible = useMemo(() => filterAndSort(state.books, query, sort), [state.books, query, sort])
  const continueReading = useMemo(
    () => state.books.filter(b => b.lastOpenedAt && b.progress < 0.99 && b.status === 'ok').slice(0, 6),
    [state.books]
  )

  const open = (b: Book): void => {
    if (b.status !== 'ok') toast(dispatch, 'warning', `Can't open "${b.title}": ${b.statusReason ?? b.status}`)
    else dispatch({ type: 'navigate', view: { name: 'reader', bookId: b.id } })
  }

  const rescan = async (): Promise<void> => {
    dispatch({ type: 'books', books: await window.api.library.rescan() })
  }

  return (
    <div className="library" data-testid="view-library">
      <header className="library-header">
        <h1>Library</h1>
        <input className="library-search" placeholder="Search title or author" value={query} onChange={e => setQuery(e.target.value)} data-testid="library-search" />
        <select className="library-sort" value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
          <option value="recent">Recent</option>
          <option value="title">Title</option>
          <option value="author">Author</option>
        </select>
        <button className="icon-btn" title="Rescan folder" onClick={() => void rescan()}><RefreshCw size={15} /></button>
      </header>

      {state.books.length === 0 ? (
        <div className="library-empty">
          No ebooks found in this folder.<br />Add EPUB, MOBI, AZW3, FB2, CBZ or PDF files, then press rescan.
        </div>
      ) : (
        <>
          {!query && continueReading.length > 0 && (
            <>
              <h2>Continue Reading</h2>
              <div className="book-row">{continueReading.map(b => <BookTile key={b.id} book={b} onOpen={open} />)}</div>
            </>
          )}
          <h2>All Books <span className="muted" style={{ fontWeight: 400 }}>{visible.length}</span></h2>
          <div className="book-grid">{visible.map(b => <BookTile key={b.id} book={b} onOpen={open} />)}</div>
        </>
      )}
    </div>
  )
}
