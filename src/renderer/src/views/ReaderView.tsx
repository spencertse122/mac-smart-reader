export function ReaderView({ bookId }: { bookId: string; target?: string }) {
  return <div className="placeholder" data-testid="view-reader">Reader {bookId}</div>
}
