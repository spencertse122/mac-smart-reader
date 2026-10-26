export type BookFormat = 'epub' | 'mobi' | 'azw3' | 'azw' | 'fb2' | 'cbz' | 'pdf'
export type BookStatus = 'ok' | 'unsupported' | 'drm' | 'error'

export interface Book {
  id: string
  slug: string
  path: string // relative to the library root, POSIX separators
  format: BookFormat
  title: string
  author: string
  addedAt: string
  lastOpenedAt: string | null
  location: string | null // CFI of the last reading position
  progress: number // 0..1
  status: BookStatus
  statusReason: string | null
  fileSize: number
  mtimeMs: number
  metadataExtracted: boolean
  hasCover: boolean
  missing: boolean
}

export interface LibraryFile { version: 1; books: Record<string, Book> }

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink'
export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink']

export interface TextQuote { exact: string; prefix: string; suffix: string }

export type HighlightKind = 'highlight' | 'note'

export interface Highlight {
  id: string
  kind?: HighlightKind // absent = 'highlight'; a 'note' has an empty quote and its text in `note`
  location: string // CFI
  quote: TextQuote
  context: string
  chapter: string | null
  position: number // fraction of the book 0..1, for ordering
  color: HighlightColor
  note: string | null
  createdAt: string
  updatedAt: string
  deleted: boolean
}

export type NewHighlight = Pick<Highlight, 'location' | 'quote' | 'context' | 'chapter' | 'position' | 'color' | 'note'>
export type NewNote = { location: string; chapter: string | null; position: number; text: string }
export type HighlightPatch = Partial<Pick<Highlight, 'color' | 'note' | 'location'>>

export interface HighlightsFile { version: 1; bookId: string; highlights: Highlight[] }

export const LIMITS = { contextChars: 600, quoteAffixChars: 64, exactMaxChars: 3000, noteMaxChars: 5000 } as const

export interface DictEntry {
  headword: string
  pronunciation: string | null
  text: string // definition, display-ready (line breaks before senses/bullets, no etymology tail)
  raw: string
}
export type ZhResult = { status: 'ok'; gloss: string; entry: string } | { status: 'not-found' } | { status: 'unavailable' }
export type DictLookupResult = { ok: true; entry: DictEntry; zh: ZhResult } | { ok: false; reason: 'not-found' | 'unavailable' }

export interface VocabContext { bookId: string; sentence: string; location: string; chapter: string | null; at: string }
export interface VocabWord {
  id: string // 'w_<uuid>'; also the review card key
  headword: string
  pronunciation: string | null
  definition: string
  contexts: VocabContext[] // newest last, at most VOCAB_MAX_CONTEXTS
  createdAt: string
  updatedAt: string
  deleted: boolean
  zh?: string | null // Chinese gloss; undefined = never looked up, null = looked up, none found
  zhEntry?: string | null // full Chinese entry text
}
export interface VocabFile { version: 1; words: VocabWord[] }
export interface NewVocab {
  headword: string
  pronunciation: string | null
  definition: string
  zh?: string | null
  zhEntry?: string | null
  context: { bookId: string; sentence: string; location: string; chapter: string | null }
}
export const VOCAB_MAX_CONTEXTS = 5
export const VOCAB_SENTENCE_MAX = 300

export type FsrsState = 0 | 1 | 2 | 3 // ts-fsrs State: New, Learning, Review, Relearning

export interface CardState {
  bookId: string
  due: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: FsrsState
  last_review: string | null
  suspended: boolean
}

export interface ReviewStateFile { version: 1; desiredRetention: number; cards: Record<string, CardState> }

export type Rating = 'again' | 'hard' | 'good' | 'easy'
// 'cloze' only appears in old review-log lines; new code never produces it
export type PromptType = 'ai' | 'highlight' | 'note' | 'word' | 'cloze'

export interface ReviewLogEntry {
  ts: string
  highlightId: string
  bookId: string
  rating: Rating
  promptType: PromptType
  durationMs: number
  retrievabilityBefore: number
  wasNew: boolean
}

export interface PromptLine { highlightId: string; question: string; answer?: string; createdAt?: string; by?: string }

export interface ReviewCard {
  highlightId: string
  bookId: string
  bookTitle: string
  chapter: string | null
  location: string
  promptType: PromptType
  prompt: string
  answer: string
  note: string | null
  aiAnswer: string | null
  isNew: boolean
  // promptType 'word' only: `highlightId` is the word id, `prompt` the headword, `answer` the definition
  pronunciation?: string | null
  context?: string | null // sentence of the word's first context
  zh?: string | null // Chinese gloss
}

export interface PromptIssues { invalidLines: number; unknownHighlightIds: number }

export type SessionKind = 'reading' | 'review' | 'break'

export interface SessionEntry {
  start: string
  end: string
  kind: SessionKind
  bookId: string | null
  minutes: number
  pomodoro: boolean
}

export interface MetricSnapshot { date: string; K: number; cumulativeMinutes: number }

export interface Stats {
  K: number
  knowledgePerHour: number | null
  dueToday: number
  streakDays: number
  forecast: Array<{ date: string; count: number }>
  minutesByDay: Array<{ date: string; minutes: number }>
  kTrend: Array<{ date: string; K: number }>
  perBook: Array<{ bookId: string; title: string; cards: number }>
}

export type ReaderTheme = 'white' | 'sepia' | 'gray' | 'night'

export interface PomodoroSettings { workMin: number; breakMin: number; longBreakMin: number; longEvery: number; sound: boolean }

export interface Settings {
  libraryPath: string | null
  recentLibraries: string[]
  readerTheme: ReaderTheme
  fontFamily: 'serif' | 'sans'
  fontSize: number
  lineHeight: number
  flow: 'paginated' | 'scrolled'
  terminalPosition: 'bottom' | 'right'
  newCardsPerDay: number
  pomodoro: PomodoroSettings
}

export const DEFAULT_SETTINGS: Settings = {
  libraryPath: null,
  recentLibraries: [],
  readerTheme: 'white',
  fontFamily: 'serif',
  fontSize: 19,
  lineHeight: 1.55,
  flow: 'paginated',
  terminalPosition: 'bottom',
  newCardsPerDay: 20,
  pomodoro: { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, sound: true }
}

export interface Toast { kind: 'info' | 'warning' | 'error'; message: string }
