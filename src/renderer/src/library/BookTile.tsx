import type { Book } from '../../../shared/types'
import { useCover } from './useCover'
import { GeneratedCover } from './GeneratedCover'

export function BookTile({ book, onOpen }: { book: Book; onOpen: (b: Book) => void }) {
  const cover = useCover(book.id, book.hasCover)
  const disabled = book.status !== 'ok'
  return (
    <button
      className={`book-tile ${disabled ? 'disabled' : ''}`}
      title={disabled ? `${book.title}: ${book.statusReason ?? book.status}` : book.title}
      onClick={() => onOpen(book)}
      data-testid="book-tile"
      data-book-id={book.id}
    >
      <div className="book-cover">
        {cover ? <img src={cover} alt="" draggable={false} /> : <GeneratedCover id={book.id} title={book.title} author={book.author} />}
        {book.progress > 0 && (
          <div className="book-progress"><div style={{ width: `${Math.round(book.progress * 100)}%` }} /></div>
        )}
      </div>
      <div className="book-title">{book.title}</div>
      <div className="book-author">{book.author || ' '}</div>
    </button>
  )
}
