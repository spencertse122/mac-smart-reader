export interface TrackedSession { start: number; end: number; bookId: string; pomodoro: boolean }

export class ReadingSessionTracker {
  private cur: { bookId: string; start: number; last: number; pomodoro: boolean } | null = null

  constructor(private log: (s: TrackedSession) => void, private idleMs = 3 * 60_000) {}

  activity(bookId: string, now: number, pomodoro: boolean): void {
    if (this.cur && (this.cur.bookId !== bookId || now - this.cur.last > this.idleMs)) this.end(this.cur.bookId !== bookId ? now : undefined)
    if (!this.cur) this.cur = { bookId, start: now, last: now, pomodoro }
    else {
      this.cur.last = now
      this.cur.pomodoro ||= pomodoro
    }
  }

  tick(now: number): void {
    if (this.cur && now - this.cur.last > this.idleMs) this.end()
  }

  // Ends the current session at `at`, or at the last activity when idle.
  end(at?: number): void {
    if (!this.cur) return
    const { bookId, start, last, pomodoro } = this.cur
    this.cur = null
    this.log({ start, end: at ?? last, bookId, pomodoro })
  }
}
