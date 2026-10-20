export function HighlightsPanel({ bookId }: { bookId: string }) {
  return <p className="muted" style={{ padding: '12px 18px' }} data-book={bookId}>Highlights</p>
}
