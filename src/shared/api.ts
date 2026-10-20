import type {
  Book, BookStatus, Highlight, HighlightPatch, NewHighlight, NewNote, PromptIssues, PromptType,
  Rating, ReviewCard, ReviewLogEntry, SessionEntry, Settings, Stats, Toast
} from './types'

export type OpenLibraryResult = { ok: true; root: string; books: Book[] } | { ok: false; error: string }

export type MenuAction =
  | { type: 'open-folder' }
  | { type: 'open-library'; path: string }
  | { type: 'toggle-terminal' }
  | { type: 'toggle-pomodoro' }
  | { type: 'new-note' }
  | { type: 'continue-reading' }

export interface SmartReaderApi {
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
  }
  library: {
    chooseFolder(): Promise<string | null>
    open(root: string): Promise<OpenLibraryResult>
    current(): Promise<string | null>
    list(): Promise<Book[]>
    rescan(): Promise<Book[]>
    readBook(id: string): Promise<{ name: string; data: Uint8Array }>
    getCover(id: string): Promise<Uint8Array | null>
    saveMetadata(id: string, meta: { title: string; author: string; cover: Uint8Array | null }): Promise<Book>
    saveProgress(id: string, location: string, progress: number): Promise<void>
    markOpened(id: string): Promise<void>
    setStatus(id: string, status: BookStatus, reason: string | null): Promise<void>
  }
  highlights: {
    list(bookId: string): Promise<Highlight[]>
    add(bookId: string, h: NewHighlight): Promise<Highlight>
    addNote(bookId: string, n: NewNote): Promise<Highlight>
    update(bookId: string, id: string, patch: HighlightPatch): Promise<Highlight>
    remove(bookId: string, id: string): Promise<void>
  }
  review: {
    queue(): Promise<ReviewCard[]>
    rate(highlightId: string, rating: Rating, durationMs: number, promptType: PromptType): Promise<ReviewLogEntry>
    dueCount(): Promise<number>
    promptIssues(): Promise<PromptIssues>
  }
  sessions: {
    log(entry: Omit<SessionEntry, 'minutes'>): Promise<void>
  }
  stats: {
    get(): Promise<Stats>
  }
  pty: {
    create(cols: number, rows: number): Promise<string>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, exitCode: number) => void): () => void
  }
  on: {
    reviewChanged(cb: () => void): () => void
    libraryChanged(cb: () => void): () => void
    toast(cb: (t: Toast) => void): () => void
    menu(cb: (a: MenuAction) => void): () => void
  }
}

declare global {
  interface Window { api: SmartReaderApi }
}
