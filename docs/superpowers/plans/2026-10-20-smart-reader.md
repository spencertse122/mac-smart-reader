# Smart Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only macOS Electron ebook reader (EPUB/MOBI/AZW3/FB2/CBZ/PDF) with Apple Books-style highlighting, FSRS review of highlights, a Pomodoro timer, an embedded terminal for AI coding agents, and coach skills that maintain a Markdown knowledge graph. Ship it as a DMG installed with one command.

**Architecture:** An Electron main process owns all file I/O for the chosen books folder: library scan, highlights, FSRS state, logs and workspace templates. It exposes a typed IPC API through a sandboxed preload. A React renderer hosts the UI. foliate-js is vendored as static ES modules and renders every book format, including PDF through its bundled pdf.js adapter. An xterm.js panel talks to node-pty in the main process. The app and the terminal agent never communicate directly. **The books folder is the interface**, and every file in it has exactly one writer.

**Tech Stack:** Electron 44, electron-vite 6, Vite 8, React 19, TypeScript 5.9, ts-fsrs 5, node-pty 1.1, @xterm/xterm 6, fflate, foliate-js (vendored at commit `78914aef4466eb960965702401634c2cb348e9b1`), Vitest 5, Playwright 1.64 (Electron), electron-builder 26, GitHub Actions (macOS runner).

**Spec:** `docs/superpowers/specs/2026-10-20-smart-reader-design.md`. Methodology: `docs/methodology.md`.

**Spec refinements made while planning (they don't change behavior):**
- PDF is rendered through foliate-js's bundled pdf.js adapter rather than a separate pdf.js viewer. Every format then shares one reader adapter, and every highlight location is a CFI.
- Book metadata and covers are extracted in the renderer using foliate-js parsers, so there is one parser for every format, and sent to main through `library.saveMetadata`.
- `Highlight` gains `position` (book fraction 0–1, used for ordering). `Book` gains `fileSize`, `mtimeMs`, `metadataExtracted`, `hasCover` and `missing`. `ReviewLogEntry` gains `wasNew` (used for the new-cards-per-day quota).
- The terminal uses light/dark colors that follow the system appearance, not the reader theme. The reader theme can be sepia or gray, which doesn't suit a terminal.
- The installer downloads with `gh` (the repo is private), so the README's one-liner fetches `install.sh` through `gh api` instead of raw `curl`. *(Superseded in the final fix wave: the repo `spencertse122/mac-smart-reader` is public, so the README one-liner is raw `curl`, and `install.sh` uses `gh` when logged in, else `curl` via the releases API.)*
- There is a 7th skill, `learning-coach`, that carries the methodology rules. The other 6 skills reference it.
- No `electron-store`, `chokidar` or `ulid`. They are ESM-only and unnecessary. Settings use our own JSON store; `prompts.jsonl` is watched with `fs.watchFile` polling (1s), which survives agents writing via rename; ids use `crypto.randomUUID()`.

## Global Constraints

- Local-only: no network calls from the app, no telemetry, no AI calls from the app.
- Minimum macOS 13. Builds are produced for arm64 and x64, unsigned (`identity: null`), and the installer clears quarantine.
- Books folder layout and file ownership are exactly as spec §3. The app never writes inside `knowledge/` except creating missing template files in `WorkspaceSetup`. Agents never write `.smartreader/`.
- All app JSON writes go through `writeFileAtomic` (temp → fsync → rename, keeping `.bak`).
- Book id = SHA-256(first 1 MiB + decimal file size), first 16 hex chars. slug = kebab title (≤50 chars) + `-` + first 6 chars of id.
- FSRS: `ts-fsrs`, desired retention 0.9, fuzz off, default new-card cap 20/day.
- Context cloze: blank `▁▁▁▁ (~N words)`. For highlights over 40 words, the first 6 words stay visible.
- Highlight colors: `yellow | green | blue | pink`. Context ≤600 chars; quote prefix/suffix ≤64 chars; exact ≤3000 chars.
- Reading session idle cutoff: 3 minutes. Pomodoro defaults: 25/5, long break 15 every 4.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. All main-process access goes through `window.api` (type `SmartReaderApi`).
- Shortcuts: ⌘J terminal, ⌥⌘P Pomodoro, ⇧⌘O open folder (menu accelerators); Space/1–4 in review; ←/→ in reader.
- Files under `src/shared/` are the cross-task contract. Only Task 1 creates them. A later task that needs a change there must stop and report `NEEDS_CONTEXT` to the controller instead of editing.
- Code style: TypeScript strict, 2-space indent, no semicolons, single quotes, named exports, comments only where intent isn't obvious.

## Review Focus

1. **An agent writes `knowledge/prompts.jsonl` mid-line or replaces it via rename.** The app must ignore the partial line, pick up the completed file within ~1s, and never crash (Task 4 test: `partial trailing line is skipped then picked up`).
2. **The same book is in two places, or a file is renamed or moved.** Highlights must stay attached to the content-hash id, and duplicates must not flip the stored path (Task 2 tests: `renamed file keeps id`, `duplicate copy keeps original path`).
3. **The remembered books folder is gone (unplugged drive) or not writable.** The app must show Welcome with a clear message and not crash (Task 7 test: `open rejects missing folder`, plus Task 8 boot behavior).
4. **Degenerate highlights:** whitespace-only selections, very long selections, or a quote not found in its context. They must be rejected or degrade to a usable cloze (Task 3 test: `rejects blank and oversized highlights`; Task 4 test: `cloze falls back when quote not in context`).
5. **Large libraries (hundreds of books, 100 MB PDFs).** Scanning must hash only the first 1 MiB and skip unchanged files by size+mtime (Task 2 test: `second scan does not rehash unchanged files`).

## Execution Strategy (subagents)

The user asked for **Sonnet subagents to write the code and the controller (Opus, this session) to review every task**. The hardest tasks go to Opus. Tasks are grouped into waves. Tasks in the same wave touch disjoint files and run in parallel, each in its own git worktree.

| Wave | Tasks (model) | Depends on | Notes |
|---|---|---|---|
| 0 | T1 Scaffold + store + shared contract (**controller**) | — | Pins versions, proves Electron + node-pty + foliate load on this VPS |
| 1 | T2 Library+Settings, T3 Highlights, T4 Review engine, T5 Sessions/Metrics/Stats, T6 Workspace setup + skills (all **sonnet**) | T1 | Pure Node modules + unit tests; 5 parallel |
| 2 | T7 Main wiring + IPC + PTY (**sonnet**), T8 Renderer shell + design system (**sonnet**) | W1 | 2 parallel |
| 3a | T9 Library view (**sonnet**), T10 Reader + highlighting (**opus**), T11 Review UI (**sonnet**), T12 Terminal panel (**sonnet**) | W2 | 4 parallel; each replaces only its own stub files |
| 3b | T13 Pomodoro + session tracking (**sonnet**), T14 Stats view (**sonnet**) | W2 (T13 also uses T10's bus events, already defined in T8) | 2 parallel |
| 4 | T15 Full-journey E2E + CI (**sonnet**), T16 Packaging + release + install.sh + README (**sonnet**) | W3 | 2 parallel |
| 5 | Final branch review, push to the GitHub repo `spencertse122/mac-smart-reader`, tag `v0.1.0`, watch the release build (**controller**) | W4 | — |

**Worktree protocol for every parallel subagent:**
```bash
# controller creates, per task N:
git worktree add .worktrees/task-N -b task-N main
ln -s /home/ubuntu/mac-smart-reader/node_modules .worktrees/task-N/node_modules
# subagent works only inside .worktrees/task-N, commits on branch task-N
# controller reviews `git diff main...task-N`, then: git merge --no-ff task-N
```
`.gitignore` lists `node_modules` **without** a trailing slash so the symlink is ignored. Do not run `npm install` inside a worktree. If a dependency is missing, report `NEEDS_CONTEXT`.

**Cross-task e2e:** a few e2e specs touch UI owned by a sibling task in the same wave. Subagents run unit tests and typecheck in their worktree. The controller runs every e2e spec after merging each wave.

**Review protocol (controller):** for each finished task, read the diff against the task text and spec, then run `npm run typecheck && npm test`, plus that task's e2e spec if it has one. Send concrete fix requests back to the same subagent, or fix trivial issues directly. Merge only when everything is green.

---
### Task 1: Scaffold, atomic store and shared contract (controller)

**Files:**
- Create: `package.json`, `.gitignore`, `.npmrc`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `playwright.config.ts`
- Create: `src/shared/types.ts`, `src/shared/api.ts`, `src/shared/ipc.ts`, `src/shared/dates.ts`
- Create: `src/main/index.ts`, `src/main/store/atomic.ts`, `src/main/store/jsonl.ts`, `src/main/store/jsonFile.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts`
- Create: `src/renderer/public/foliate-js/**` (vendored)
- Create: `scripts/make-fixture-pdf.mjs`, `scripts/fetch-fixtures.sh`, `tests/fixtures/books/{art-of-war.epub,art-of-war.azw3,art-of-war.mobi,sample.pdf}`
- Test: `tests/unit/store.test.ts`, `tests/unit/dates.test.ts`, `tests/e2e/helpers.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (every later task relies on these exact names):
  - `src/shared/types.ts`: all data types and `DEFAULT_SETTINGS`, `HIGHLIGHT_COLORS`, `LIMITS`
  - `src/shared/api.ts`: `SmartReaderApi`, `OpenLibraryResult`, `MenuAction`; global `window.api`
  - `src/shared/ipc.ts`: `IPC` channel constants
  - `src/shared/dates.ts`: `localDay(d: Date): string`, `addDays(d: Date, n: number): Date`
  - `src/main/store/atomic.ts`: `writeFileAtomic(path, data)`, `writeJson(path, value)`, `readJson<T>(path, fallback)`, `setRecoveryListener(fn)`, `RecoveryEvent`
  - `src/main/store/jsonl.ts`: `appendJsonl(path, value)`, `readJsonl<T>(path): Promise<{ items: T[]; skipped: number }>`
  - `src/main/store/jsonFile.ts`: `jsonFile<T>(path, fallback, opts?): JsonFile<T>` with `read()` and `update(mutate)`
  - `tests/e2e/helpers.ts`: `makeLibrary(): Promise<string>`, `launchApp(opts): Promise<{ app: ElectronApplication; page: Page; userData: string }>`

- [ ] **Step 1: Initialize the package and install pinned dependencies**

```bash
cd /home/ubuntu/mac-smart-reader
cat > package.json <<'EOF'
{
  "name": "smart-reader",
  "productName": "Smart Reader",
  "version": "0.1.0",
  "private": true,
  "description": "Local ebook reader for durable learning",
  "author": "spencertse122",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "e2e": "electron-vite build && playwright test",
    "postinstall": "electron-builder install-app-deps",
    "fixtures:pdf": "node scripts/make-fixture-pdf.mjs tests/fixtures/books/sample.pdf"
  }
}
EOF
printf 'save-exact=true\n' > .npmrc
npm install ts-fsrs@5.4.2 node-pty@1.1.0 fflate@0.8.3
npm install -D electron@44.9.1 electron-vite@6.0.0 electron-builder@26.15.3 vite@8.3.4 \
  @vitejs/plugin-react@6.1.2 typescript@5.9.3 vitest@5.0.5 @playwright/test@1.64.1 \
  react@19.3.1 react-dom@19.3.1 @types/react @types/react-dom @types/node@24 \
  @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0 lucide-react jsdom @resvg/resvg-js
```
Expected: the install finishes, and `postinstall` rebuilds `node-pty` for Electron without errors. If node-pty fails to compile against Electron 44, try `node-pty@beta`. If that also fails, pin the newest Electron for which `npx @electron/rebuild -f -w node-pty` succeeds, and record the decision in the plan header.

- [ ] **Step 2: Write config files**

`.gitignore`:
```gitignore
node_modules
out
release
dist
test-results
playwright-report
.worktrees
*.log
.DS_Store
# never commit personal ebooks; fixtures are re-included below
*.epub
*.mobi
*.azw
*.azw3
*.pdf
*.fb2
*.cbz
!tests/fixtures/books/*
```

`electron.vite.config.ts`:
```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve('src/main/index.ts') } }
  },
  preload: {
    build: { rollupOptions: { input: resolve('src/preload/index.ts') } }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
```
Check electron-vite 6 behavior: dependencies must be externalized for main/preload (v5+ does this by default; older versions needed `externalizeDepsPlugin()`). Run `npm run build` and confirm `out/main/index.js` contains `require("node-pty")` or `require("ts-fsrs")` rather than inlined code once those are imported. If they are inlined, add `externalizeDepsPlugin()` to `main.plugins` and `preload.plugins`.

`tsconfig.json`:
```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true, "resolveJsonModule": true,
    "types": ["node"], "lib": ["ES2023"], "noEmit": true, "composite": false
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "tests/unit/**/*", "tests/e2e/**/*",
              "electron.vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "skipLibCheck": true, "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"], "types": [], "noEmit": true
  },
  "include": ["src/renderer/src/**/*", "src/shared/**/*"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'], environment: 'node' }
})
```

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']]
})
```

- [ ] **Step 3: Write the shared contract**

`src/shared/types.ts`:
```ts
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

export interface Highlight {
  id: string
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
export type HighlightPatch = Partial<Pick<Highlight, 'color' | 'note' | 'location'>>

export interface HighlightsFile { version: 1; bookId: string; highlights: Highlight[] }

export const LIMITS = { contextChars: 600, quoteAffixChars: 64, exactMaxChars: 3000 } as const

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
export type PromptType = 'ai' | 'note' | 'cloze'

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
```

`src/shared/api.ts`:
```ts
import type {
  Book, BookStatus, Highlight, HighlightPatch, NewHighlight, PromptIssues, PromptType,
  Rating, ReviewCard, ReviewLogEntry, SessionEntry, Settings, Stats, Toast
} from './types'

export type OpenLibraryResult = { ok: true; root: string; books: Book[] } | { ok: false; error: string }

export type MenuAction =
  | { type: 'open-folder' }
  | { type: 'open-library'; path: string }
  | { type: 'toggle-terminal' }
  | { type: 'toggle-pomodoro' }

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
```

`src/shared/ipc.ts`:
```ts
export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  libraryChooseFolder: 'library:chooseFolder',
  libraryOpen: 'library:open',
  libraryCurrent: 'library:current',
  libraryList: 'library:list',
  libraryRescan: 'library:rescan',
  libraryReadBook: 'library:readBook',
  libraryGetCover: 'library:getCover',
  librarySaveMetadata: 'library:saveMetadata',
  librarySaveProgress: 'library:saveProgress',
  libraryMarkOpened: 'library:markOpened',
  librarySetStatus: 'library:setStatus',
  highlightsList: 'highlights:list',
  highlightsAdd: 'highlights:add',
  highlightsUpdate: 'highlights:update',
  highlightsRemove: 'highlights:remove',
  reviewQueue: 'review:queue',
  reviewRate: 'review:rate',
  reviewDueCount: 'review:dueCount',
  reviewPromptIssues: 'review:promptIssues',
  sessionsLog: 'sessions:log',
  statsGet: 'stats:get',
  ptyCreate: 'pty:create',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  eventReviewChanged: 'event:reviewChanged',
  eventLibraryChanged: 'event:libraryChanged',
  eventToast: 'event:toast',
  eventMenu: 'event:menu'
} as const
```

`src/shared/dates.ts`:
```ts
export function localDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
```

- [ ] **Step 4: Write failing store tests**

`tests/unit/store.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeJson, readJson, setRecoveryListener } from '../../src/main/store/atomic'
import { appendJsonl, readJsonl } from '../../src/main/store/jsonl'
import { jsonFile } from '../../src/main/store/jsonFile'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'sr-store-')) })

describe('atomic json', () => {
  it('writes and reads back, creating parent dirs', async () => {
    const p = join(dir, 'a', 'b.json')
    await writeJson(p, { x: 1 })
    expect(await readJson(p, () => ({ x: 0 }))).toEqual({ x: 1 })
  })

  it('returns fallback when missing', async () => {
    expect(await readJson(join(dir, 'nope.json'), () => ({ d: true }))).toEqual({ d: true })
  })

  it('keeps a .bak of the previous version and leaves no temp files', async () => {
    const p = join(dir, 'c.json')
    await writeJson(p, { v: 1 })
    await writeJson(p, { v: 2 })
    expect(JSON.parse(await readFile(`${p}.bak`, 'utf8'))).toEqual({ v: 1 })
    expect((await readdir(dir)).filter(f => f.includes('.tmp-'))).toEqual([])
  })

  it('recovers from corrupt json using .bak and reports it', async () => {
    const p = join(dir, 'd.json')
    await writeJson(p, { v: 1 })
    await writeJson(p, { v: 2 })
    await writeFile(p, '{ broken')
    const events: unknown[] = []
    setRecoveryListener(e => events.push(e))
    expect(await readJson(p, () => ({ v: 0 }))).toEqual({ v: 1 })
    expect(events).toHaveLength(1)
    expect((await readdir(dir)).some(f => f.startsWith('d.json.corrupt-'))).toBe(true)
    setRecoveryListener(null)
  })

  it('falls back when corrupt and no backup exists', async () => {
    const p = join(dir, 'e.json')
    await writeFile(p, 'nope')
    expect(await readJson(p, () => ({ v: 9 }))).toEqual({ v: 9 })
  })
})

describe('jsonl', () => {
  it('appends and reads, skipping bad lines', async () => {
    const p = join(dir, 'log.jsonl')
    await appendJsonl(p, { a: 1 })
    await writeFile(p, (await readFile(p, 'utf8')) + 'garbage\n\n{"a":2}\n{"a":3')
    const r = await readJsonl<{ a: number }>(p)
    expect(r.items).toEqual([{ a: 1 }, { a: 2 }])
    expect(r.skipped).toBe(2)
  })

  it('missing file reads as empty', async () => {
    expect(await readJsonl(join(dir, 'x.jsonl'))).toEqual({ items: [], skipped: 0 })
  })
})

describe('jsonFile', () => {
  it('serializes concurrent updates without losing writes', async () => {
    const f = jsonFile(join(dir, 'n.json'), () => ({ n: 0 }))
    await Promise.all(Array.from({ length: 20 }, () => f.update(d => { d.n++ })))
    expect((await f.read()).n).toBe(20)
    expect(JSON.parse(await readFile(join(dir, 'n.json'), 'utf8')).n).toBe(20)
  })

  it('runs afterWrite inside the write chain', async () => {
    const seen: number[] = []
    const f = jsonFile(join(dir, 'm.json'), () => ({ n: 0 }), { afterWrite: async v => { seen.push(v.n) } })
    await Promise.all([f.update(d => { d.n = 1 }), f.update(d => { d.n = 2 })])
    expect(seen).toEqual([1, 2])
  })

  it('a failing update rejects but later updates still run', async () => {
    const f = jsonFile(join(dir, 'k.json'), () => ({ n: 0 }))
    await expect(f.update(() => { throw new Error('boom') })).rejects.toThrow('boom')
    await f.update(d => { d.n = 5 })
    expect((await f.read()).n).toBe(5)
  })
})
```

`tests/unit/dates.test.ts`:
```ts
import { it, expect } from 'vitest'
import { localDay, addDays } from '../../src/shared/dates'

it('formats local day and adds days across month end', () => {
  const d = new Date(2026, 9, 31, 23, 30)
  expect(localDay(d)).toBe('2026-10-31')
  expect(localDay(addDays(d, 1))).toBe('2026-11-01')
})
```

- [ ] **Step 5: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/store.test.ts tests/unit/dates.test.ts`
Expected: FAIL with "Cannot find module '../../src/main/store/atomic'" (dates passes once Step 3 is done).

- [ ] **Step 6: Implement the store**

`src/main/store/atomic.ts`:
```ts
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export interface RecoveryEvent { path: string; restoredFromBackup: boolean; corruptCopy: string }

let recoveryListener: ((e: RecoveryEvent) => void) | null = null
export function setRecoveryListener(fn: ((e: RecoveryEvent) => void) | null): void {
  recoveryListener = fn
}

function isNotFound(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === 'ENOENT'
}

export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await fs.copyFile(path, `${path}.bak`)
  } catch (e) {
    if (!isNotFound(e)) throw e
  }
  await fs.rename(tmp, path)
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(value, null, 2) + '\n')
}

export async function readJson<T>(path: string, fallback: () => T): Promise<T> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (e) {
    if (isNotFound(e)) return fallback()
    throw e
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    const corruptCopy = `${path}.corrupt-${Date.now()}`
    await fs.rename(path, corruptCopy)
    try {
      const restored = JSON.parse(await fs.readFile(`${path}.bak`, 'utf8')) as T
      await writeJson(path, restored)
      recoveryListener?.({ path, restoredFromBackup: true, corruptCopy })
      return restored
    } catch {
      recoveryListener?.({ path, restoredFromBackup: false, corruptCopy })
      return fallback()
    }
  }
}
```

`src/main/store/jsonl.ts`:
```ts
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export async function appendJsonl(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.appendFile(path, JSON.stringify(value) + '\n', 'utf8')
}

export async function readJsonl<T>(path: string): Promise<{ items: T[]; skipped: number }> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { items: [], skipped: 0 }
    throw e
  }
  const items: T[] = []
  let skipped = 0
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const v = JSON.parse(t)
      if (v && typeof v === 'object' && !Array.isArray(v)) items.push(v as T)
      else skipped++
    } catch {
      skipped++
    }
  }
  return { items, skipped }
}
```

`src/main/store/jsonFile.ts`:
```ts
import { readJson, writeJson } from './atomic'

export interface JsonFile<T> {
  read(): Promise<T>
  update(mutate: (draft: T) => T | void): Promise<T>
}

// Single-writer cached JSON document. Updates are serialized so concurrent IPC calls never lose writes.
export function jsonFile<T>(
  path: string,
  fallback: () => T,
  opts: { afterWrite?: (value: T) => Promise<void> } = {}
): JsonFile<T> {
  let cache: T | undefined
  let chain: Promise<unknown> = Promise.resolve()

  const load = async (): Promise<T> => {
    if (cache === undefined) cache = await readJson(path, fallback)
    return cache
  }

  return {
    read: () => chain.then(load),
    update(mutate) {
      const p = chain.then(async () => {
        const current = await load()
        const next = (mutate(current) ?? current) as T
        cache = next
        await writeJson(path, next)
        if (opts.afterWrite) await opts.afterWrite(next)
        return next
      })
      chain = p.catch(() => undefined)
      return p
    }
  }
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/store.test.ts tests/unit/dates.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 8: Vendor foliate-js**

```bash
SRC=$(mktemp -d)/foliate-js
git clone -q https://github.com/johnfactotum/foliate-js.git "$SRC"
git -C "$SRC" checkout -q 78914aef4466eb960965702401634c2cb348e9b1
mkdir -p src/renderer/public/foliate-js
cp -r "$SRC"/LICENSE "$SRC"/*.js "$SRC"/vendor src/renderer/public/foliate-js/
rm -f src/renderer/public/foliate-js/{reader.js,rollup.config.js,eslint.config.js}
find src/renderer/public/foliate-js -name '*.map' -delete
echo "foliate-js @ 78914aef4466eb960965702401634c2cb348e9b1 (MIT) — vendored unmodified" > src/renderer/public/foliate-js/VENDORED.txt
```
Expected: `src/renderer/public/foliate-js/view.js` and `vendor/pdfjs/pdf.mjs` exist.

- [ ] **Step 9: Write the main process, preload and minimal renderer**

`src/main/index.ts`:
```ts
import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])
if (process.env.SR_USER_DATA) app.setPath('userData', process.env.SR_USER_DATA)

const RENDERER_DIR = join(__dirname, '../renderer')
const CSP = [
  "default-src 'self' app: blob: data:",
  "script-src 'self' app: blob:",
  "style-src 'self' 'unsafe-inline' app: blob:",
  "img-src 'self' app: blob: data:",
  "font-src 'self' app: blob: data:",
  "worker-src 'self' app: blob:",
  "connect-src 'self' app: blob: data:"
].join('; ')

function registerAppProtocol(): void {
  protocol.handle('app', async request => {
    const { pathname } = new URL(request.url)
    const filePath = normalize(join(RENDERER_DIR, decodeURIComponent(pathname)))
    if (!filePath.startsWith(RENDERER_DIR + sep)) return new Response('Forbidden', { status: 403 })
    const res = await net.fetch(pathToFileURL(filePath).toString())
    const headers = new Headers(res.headers)
    if (/\.html?$/.test(filePath)) headers.set('Content-Security-Policy', CSP)
    if (/\.m?js$/.test(filePath)) headers.set('Content-Type', 'text/javascript')
    return new Response(res.body, { status: res.status, headers })
  })
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Smart Reader',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void win.loadURL(process.env.ELECTRON_RENDERER_URL ?? 'app://bundle/index.html')
  return win
}

app.whenReady().then(() => {
  registerAppProtocol()
  createMainWindow()
})

app.on('window-all-closed', () => app.quit())
```
Check: the preload output filename may be `index.js` or `index.mjs` in electron-vite 6. Use whatever `ls out/preload` shows after `npm run build`.

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { SmartReaderApi } from '../shared/api'
import { IPC } from '../shared/ipc'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}

const api: SmartReaderApi = {
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: patch => invoke(IPC.settingsUpdate, patch)
  },
  library: {
    chooseFolder: () => invoke(IPC.libraryChooseFolder),
    open: root => invoke(IPC.libraryOpen, root),
    current: () => invoke(IPC.libraryCurrent),
    list: () => invoke(IPC.libraryList),
    rescan: () => invoke(IPC.libraryRescan),
    readBook: id => invoke(IPC.libraryReadBook, id),
    getCover: id => invoke(IPC.libraryGetCover, id),
    saveMetadata: (id, meta) => invoke(IPC.librarySaveMetadata, id, meta),
    saveProgress: (id, location, progress) => invoke(IPC.librarySaveProgress, id, location, progress),
    markOpened: id => invoke(IPC.libraryMarkOpened, id),
    setStatus: (id, status, reason) => invoke(IPC.librarySetStatus, id, status, reason)
  },
  highlights: {
    list: bookId => invoke(IPC.highlightsList, bookId),
    add: (bookId, h) => invoke(IPC.highlightsAdd, bookId, h),
    update: (bookId, id, patch) => invoke(IPC.highlightsUpdate, bookId, id, patch),
    remove: (bookId, id) => invoke(IPC.highlightsRemove, bookId, id)
  },
  review: {
    queue: () => invoke(IPC.reviewQueue),
    rate: (highlightId, rating, durationMs, promptType) =>
      invoke(IPC.reviewRate, highlightId, rating, durationMs, promptType),
    dueCount: () => invoke(IPC.reviewDueCount),
    promptIssues: () => invoke(IPC.reviewPromptIssues)
  },
  sessions: { log: entry => invoke(IPC.sessionsLog, entry) },
  stats: { get: () => invoke(IPC.statsGet) },
  pty: {
    create: (cols, rows) => invoke(IPC.ptyCreate, cols, rows),
    write: (id, data) => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: id => ipcRenderer.send(IPC.ptyKill, id),
    onData: cb => listen(IPC.ptyData, cb),
    onExit: cb => listen(IPC.ptyExit, cb)
  },
  on: {
    reviewChanged: cb => listen(IPC.eventReviewChanged, cb),
    libraryChanged: cb => listen(IPC.eventLibraryChanged, cb),
    toast: cb => listen(IPC.eventToast, cb),
    menu: cb => listen(IPC.eventMenu, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
```

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Smart Reader</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/env.d.ts`:
```ts
/// <reference types="vite/client" />
import '../../shared/api'
```

`src/renderer/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

`src/renderer/src/App.tsx` (replaced in Task 8):
```tsx
export function App() {
  return <div id="app-ready">Smart Reader</div>
}
```

- [ ] **Step 10: Create fixtures**

`scripts/make-fixture-pdf.mjs`:
```js
// Writes a small text PDF (2 pages) with a valid xref table, used by e2e tests.
import { writeFileSync } from 'node:fs'

const pages = [
  'Spaced repetition strengthens memory over time.',
  'Retrieval practice beats rereading for durable learning.'
]
const objs = ['<< /Type /Catalog /Pages 2 0 R >>']
const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')
objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
const fontId = 3 + pages.length * 2
pages.forEach(text => {
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${objs.length + 2} 0 R >>`)
  const stream = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
})
objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

let out = '%PDF-1.4\n'
const offsets = []
objs.forEach((o, i) => {
  offsets.push(out.length)
  out += `${i + 1} 0 obj\n${o}\nendobj\n`
})
const xref = out.length
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
out += offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
writeFileSync(process.argv[2] ?? 'tests/fixtures/books/sample.pdf', out, 'latin1')
```
(The page object's `/Contents` number is `objs.length + 2`: when the page is pushed at array index k (object k+1), its content stream is the next object, k+2.)

`scripts/fetch-fixtures.sh`:
```bash
#!/usr/bin/env bash
# Public-domain fixtures from Project Gutenberg (The Art of War, ebook #132).
set -euo pipefail
cd "$(dirname "$0")/../tests/fixtures/books"
curl -fsSL -o art-of-war.epub https://www.gutenberg.org/ebooks/132.epub3.images
curl -fsSL -o art-of-war.azw3 https://www.gutenberg.org/ebooks/132.kf8.images
curl -fsSL -o art-of-war.mobi https://www.gutenberg.org/ebooks/132.kindle.images
```
Run:
```bash
mkdir -p tests/fixtures/books && chmod +x scripts/fetch-fixtures.sh && scripts/fetch-fixtures.sh && npm run fixtures:pdf
ls -la tests/fixtures/books && file tests/fixtures/books/*
```
Expected: 4 files. EPUB = "EPUB document" or "Zip archive"; azw3/mobi = "Mobipocket E-book"; pdf = "PDF document". If Gutenberg blocks the VPS, use any other public-domain EPUB/MOBI and note the source in `scripts/fetch-fixtures.sh`.

- [ ] **Step 11: Write the e2e helpers and smoke test**

`tests/e2e/helpers.ts`:
```ts
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const FIXTURES = resolve(__dirname, '../fixtures/books')

// Copies the fixture books into a fresh temp library folder.
export async function makeLibrary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sr-lib-'))
  await cp(FIXTURES, dir, { recursive: true })
  return dir
}

export async function launchApp(opts: { library?: string } = {}): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = await mkdtemp(join(tmpdir(), 'sr-user-'))
  if (opts.library) {
    await mkdir(userData, { recursive: true })
    await writeFile(join(userData, 'settings.json'), JSON.stringify({ libraryPath: opts.library }))
  }
  const executablePath = process.env.SR_APP_PATH // set in the release smoke test to the packaged binary
  const args = executablePath ? [] : ['.']
  if (process.platform === 'linux') args.push('--no-sandbox')
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args,
    env: { ...process.env, SR_USER_DATA: userData, SR_E2E: '1' } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userData }
}
```

`tests/e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { launchApp } from './helpers'

test('app window loads, exposes api, and can load foliate-js', async () => {
  const { app, page } = await launchApp()
  await expect(page).toHaveTitle('Smart Reader')
  expect(await page.evaluate(() => typeof window.api.settings.get)).toBe('function')
  const ok = await page.evaluate(async () => {
    await import(/* @vite-ignore */ new URL('foliate-js/view.js', document.baseURI).href)
    return !!customElements.get('foliate-view')
  })
  expect(ok).toBe(true)
  await app.close()
})
```

- [ ] **Step 12: Build, typecheck and run everything**

Run: `npm run typecheck && npm test && xvfb-run -a npm run e2e`
Expected: typecheck clean; unit tests PASS; the e2e smoke test PASS (proves the app:// protocol, the preload bridge and foliate-js module loading in a production build).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron app, atomic store, shared contract, foliate-js, fixtures"
```
### Task 2: Library service and settings store (sonnet, wave 1)

**Files:**
- Create: `src/main/library/ids.ts`, `src/main/library/scan.ts`, `src/main/library/drm.ts`, `src/main/library/libraryService.ts`, `src/main/settings.ts`
- Test: `tests/unit/library.test.ts`, `tests/unit/drm.test.ts`, `tests/unit/settings.test.ts`

**Interfaces:**
- Consumes: `Book`, `BookFormat`, `BookStatus`, `LibraryFile`, `Settings`, `DEFAULT_SETTINGS` (shared/types); `jsonFile`, `writeFileAtomic` (main/store).
- Produces:
  - `computeBookId(absPath: string): Promise<string>`, `formatFromPath(p: string): BookFormat | null`, `slugify(title: string, id: string): string`, `titleFromFilename(relPath: string): string`
  - `scanFolder(root: string): Promise<string[]>` (relative POSIX paths, sorted)
  - `detectDrm(absPath: string, format: BookFormat): Promise<string | null>`, `detectEpubDrm(zip: Uint8Array): string | null`, `detectMobiDrmBuffer(buf: Buffer, readAt: (offset: number, len: number) => Promise<Buffer>): Promise<string | null>`
  - `class LibraryService { constructor(root: string, now?: () => Date, hash?: (abs: string) => Promise<string>); readonly root: string; readonly dataDir: string; scan(): Promise<Book[]>; list(): Promise<Book[]>; get(id: string): Promise<Book>; bookDir(id: string): Promise<string>; readBook(id: string): Promise<{ name: string; data: Buffer }>; getCover(id: string): Promise<Buffer | null>; saveMetadata(id, meta: { title: string; author: string; cover: Uint8Array | null }): Promise<Book>; saveProgress(id, location: string, progress: number): Promise<void>; markOpened(id): Promise<void>; setStatus(id, status: BookStatus, reason: string | null): Promise<void> }`
  - `class BookNotFoundError extends Error`
  - `class SettingsStore { constructor(userDataDir: string); get(): Promise<Settings>; update(patch: Partial<Settings>): Promise<Settings>; rememberLibrary(path: string): Promise<Settings> }`

- [ ] **Step 1: Write the failing tests**

`tests/unit/library.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rename, readFile, copyFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeBookId, slugify, formatFromPath, titleFromFilename } from '../../src/main/library/ids'
import { scanFolder } from '../../src/main/library/scan'
import { LibraryService } from '../../src/main/library/libraryService'

let root: string
const fixed = () => new Date('2026-10-20T10:00:00Z')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sr-lib-'))
})

async function put(rel: string, content: string | Buffer): Promise<void> {
  await mkdir(join(root, rel, '..'), { recursive: true })
  await writeFile(join(root, rel), content)
}

describe('ids', () => {
  it('id is stable, content-based, 16 hex chars', async () => {
    await put('a.epub', 'hello')
    await put('b.epub', 'hello')
    await put('c.epub', 'world')
    const [a, b, c] = await Promise.all(['a.epub', 'b.epub', 'c.epub'].map(f => computeBookId(join(root, f))))
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('only hashes the first MiB (same head + same size => same id)', async () => {
    const head = Buffer.alloc(1024 * 1024, 7)
    await put('x.pdf', Buffer.concat([head, Buffer.from('AAAA')]))
    await put('y.pdf', Buffer.concat([head, Buffer.from('BBBB')]))
    expect(await computeBookId(join(root, 'x.pdf'))).toBe(await computeBookId(join(root, 'y.pdf')))
  })

  it('slugify handles punctuation, accents, non-latin and length', () => {
    expect(slugify('Thinking, Fast and Slow', 'abcdef1234567890')).toBe('thinking-fast-and-slow-abcdef')
    expect(slugify('Café Society', '1234567890abcdef')).toBe('cafe-society-123456')
    expect(slugify('思考的艺术', 'ffffff0000000000')).toBe('book-ffffff')
    const long = slugify('a'.repeat(30) + ' ' + 'b'.repeat(30), '0000001111111111')
    expect(long.length).toBeLessThanOrEqual(50 + 7)
    expect(long.endsWith('-000000')).toBe(true)
  })

  it('formatFromPath maps known extensions case-insensitively', () => {
    expect(formatFromPath('x/Book.EPUB')).toBe('epub')
    expect(formatFromPath('a.azw3')).toBe('azw3')
    expect(formatFromPath('a.azw')).toBe('azw')
    expect(formatFromPath('a.mobi')).toBe('mobi')
    expect(formatFromPath('a.fb2')).toBe('fb2')
    expect(formatFromPath('a.cbz')).toBe('cbz')
    expect(formatFromPath('a.pdf')).toBe('pdf')
    expect(formatFromPath('notes.txt')).toBeNull()
  })

  it('titleFromFilename strips extension and underscores', () => {
    expect(titleFromFilename('sub/The_Art_of_War.epub')).toBe('The Art of War')
  })
})

describe('scanFolder', () => {
  it('finds supported books recursively and skips app/agent dirs and hidden files', async () => {
    await put('a.epub', 'x')
    await put('sub/deeper/b.pdf', 'x')
    await put('notes.txt', 'x')
    await put('.hidden.epub', 'x')
    await put('.smartreader/c.epub', 'x')
    await put('knowledge/d.epub', 'x')
    await put('.claude/e.epub', 'x')
    expect(await scanFolder(root)).toEqual(['a.epub', 'sub/deeper/b.pdf'])
  })
})

describe('LibraryService', () => {
  it('scan creates books with defaults and persists library.json', async () => {
    await put('The_Art_of_War.epub', 'book-one')
    const lib = new LibraryService(root, fixed)
    const books = await lib.scan()
    expect(books).toHaveLength(1)
    const b = books[0]
    expect(b).toMatchObject({
      path: 'The_Art_of_War.epub', format: 'epub', title: 'The Art of War', author: '',
      status: 'ok', progress: 0, location: null, metadataExtracted: false, hasCover: false, missing: false,
      addedAt: '2026-10-20T10:00:00.000Z'
    })
    expect(b.slug).toBe(`the-art-of-war-${b.id.slice(0, 6)}`)
    const saved = JSON.parse(await readFile(join(root, '.smartreader/library.json'), 'utf8'))
    expect(saved.version).toBe(1)
    expect(Object.keys(saved.books)).toEqual([b.id])
  })

  it('renamed file keeps id and its data', async () => {
    await put('old.epub', 'same-content')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    await lib.saveProgress(b.id, 'epubcfi(/6/4)', 0.5)
    await mkdir(join(root, 'moved'))
    await rename(join(root, 'old.epub'), join(root, 'moved/new name.epub'))
    const lib2 = new LibraryService(root, fixed)
    const [b2] = await lib2.scan()
    expect(b2.id).toBe(b.id)
    expect(b2.path).toBe('moved/new name.epub')
    expect(b2.progress).toBe(0.5)
  })

  it('duplicate copy keeps original path and lists once', async () => {
    await put('z-original.epub', 'dup')
    const lib = new LibraryService(root, fixed)
    await lib.scan()
    await copyFile(join(root, 'z-original.epub'), join(root, 'a-copy.epub'))
    const books = await lib.scan()
    expect(books).toHaveLength(1)
    expect(books[0].path).toBe('z-original.epub')
  })

  it('missing files are kept but hidden from list', async () => {
    await put('gone.epub', 'gone')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    await rm(join(root, 'gone.epub'))
    expect(await lib.scan()).toEqual([])
    expect((await lib.get(b.id)).missing).toBe(true)
  })

  it('second scan does not rehash unchanged files', async () => {
    await put('a.epub', 'aaa')
    await put('b.pdf', 'bbb')
    let calls = 0
    const counting = async (p: string) => { calls++; return computeBookId(p) }
    const lib = new LibraryService(root, fixed, counting)
    await lib.scan()
    expect(calls).toBe(2)
    await lib.scan()
    expect(calls).toBe(2)
    await writeFile(join(root, 'a.epub'), 'changed-content')
    await lib.scan()
    expect(calls).toBe(3)
  })

  it('list sorts recently opened first, then title', async () => {
    await put('b.epub', 'b')
    await put('a.epub', 'a')
    await put('c.epub', 'c')
    let t = 0
    const lib = new LibraryService(root, () => new Date(Date.UTC(2026, 9, 20, 10, 0, t++)))
    const books = await lib.scan()
    const c = books.find(x => x.path === 'c.epub')!
    await lib.markOpened(c.id)
    expect((await lib.list()).map(x => x.path)).toEqual(['c.epub', 'a.epub', 'b.epub'])
  })

  it('saveMetadata sets title/author/cover and renames slug dir when there are no highlights', async () => {
    await put('ugly (z-lib).epub', 'meta')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    const oldDir = await lib.bookDir(b.id)
    await mkdir(oldDir, { recursive: true })
    const updated = await lib.saveMetadata(b.id, { title: 'Deep Work', author: 'Cal Newport', cover: new Uint8Array([1, 2, 3]) })
    expect(updated).toMatchObject({ title: 'Deep Work', author: 'Cal Newport', metadataExtracted: true, hasCover: true })
    expect(updated.slug).toBe(`deep-work-${b.id.slice(0, 6)}`)
    expect(existsSync(oldDir)).toBe(false)
    expect([...(await lib.getCover(b.id))!]).toEqual([1, 2, 3])
  })

  it('saveMetadata keeps slug when highlights already exist', async () => {
    await put('x.epub', 'has-highlights')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    const dir = await lib.bookDir(b.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'highlights.json'), '{"version":1,"bookId":"x","highlights":[]}')
    const updated = await lib.saveMetadata(b.id, { title: 'Other Title', author: '', cover: null })
    expect(updated.slug).toBe(b.slug)
    expect(updated.title).toBe('Other Title')
    expect(updated.hasCover).toBe(false)
  })

  it('saveMetadata keeps old title when given blank', async () => {
    await put('Keep_Me.epub', 'k')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    expect((await lib.saveMetadata(b.id, { title: '  ', author: 'A', cover: null })).title).toBe('Keep Me')
  })

  it('saveProgress clamps, setStatus records reason, readBook returns bytes', async () => {
    await put('p.epub', 'bytes!')
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    await lib.saveProgress(b.id, 'cfi', 1.7)
    await lib.setStatus(b.id, 'error', 'Bad zip')
    const got = await lib.get(b.id)
    expect(got.progress).toBe(1)
    expect(got.status).toBe('error')
    expect(got.statusReason).toBe('Bad zip')
    const { name, data } = await lib.readBook(b.id)
    expect(name).toBe('p.epub')
    expect(data.toString()).toBe('bytes!')
  })

  it('get throws BookNotFoundError for unknown id', async () => {
    const lib = new LibraryService(root, fixed)
    await expect(lib.get('nope')).rejects.toThrow('Book not found')
  })

  it('flags DRM books at scan time', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const xml = '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>'
    await put('locked.epub', Buffer.from(zipSync({ mimetype: strToU8('application/epub+zip'), 'META-INF/encryption.xml': strToU8(xml) })))
    const lib = new LibraryService(root, fixed)
    const [b] = await lib.scan()
    expect(b.status).toBe('drm')
    expect(b.statusReason).toMatch(/DRM/)
    expect((await stat(join(root, 'locked.epub'))).size).toBeGreaterThan(0)
  })
})
```

`tests/unit/drm.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { detectDrm, detectEpubDrm } from '../../src/main/library/drm'

const enc = (alg: string) =>
  `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/></enc:EncryptedData></encryption>`

describe('epub drm', () => {
  it('no encryption.xml => not DRM', () => {
    expect(detectEpubDrm(zipSync({ mimetype: strToU8('application/epub+zip') }))).toBeNull()
  })
  it('font obfuscation only => not DRM', () => {
    expect(detectEpubDrm(zipSync({ 'META-INF/encryption.xml': strToU8(enc('http://www.idpf.org/2008/embedding')) }))).toBeNull()
    expect(detectEpubDrm(zipSync({ 'META-INF/encryption.xml': strToU8(enc('http://ns.adobe.com/pdf/enc#RC')) }))).toBeNull()
  })
  it('real encryption => DRM', () => {
    expect(detectEpubDrm(zipSync({ 'META-INF/encryption.xml': strToU8(enc('http://www.w3.org/2001/04/xmlenc#aes128-cbc')) }))).toMatch(/DRM/)
  })
  it('rights.xml => Adobe DRM', () => {
    expect(detectEpubDrm(zipSync({ 'META-INF/rights.xml': strToU8('<rights/>') }))).toMatch(/Adobe DRM/)
  })
})

function mobi(encryption: number): Buffer {
  const header = Buffer.alloc(86)
  header.write('BOOKMOBI', 60, 'latin1')
  header.writeUInt16BE(1, 76) // record count
  header.writeUInt32BE(86, 78) // record 0 offset
  const rec0 = Buffer.alloc(16)
  rec0.writeUInt16BE(encryption, 12)
  return Buffer.concat([header, rec0])
}

describe('mobi drm', () => {
  it('reads the encryption field of record 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sr-drm-'))
    await writeFile(join(dir, 'free.mobi'), mobi(0))
    await writeFile(join(dir, 'locked.azw3'), mobi(2))
    expect(await detectDrm(join(dir, 'free.mobi'), 'mobi')).toBeNull()
    expect(await detectDrm(join(dir, 'locked.azw3'), 'azw3')).toMatch(/Kindle DRM/)
  })
  it('garbage input is not DRM and does not throw', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sr-drm-'))
    await writeFile(join(dir, 'junk.epub'), 'not a zip')
    await writeFile(join(dir, 'junk.mobi'), 'short')
    expect(await detectDrm(join(dir, 'junk.epub'), 'epub')).toBeNull()
    expect(await detectDrm(join(dir, 'junk.mobi'), 'mobi')).toBeNull()
  })
})
```

`tests/unit/settings.test.ts`:
```ts
import { it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from '../../src/main/settings'
import { DEFAULT_SETTINGS } from '../../src/shared/types'

it('returns defaults, merges partial files, patches nested pomodoro, remembers libraries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sr-set-'))
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ libraryPath: '/books' }))
  const s = new SettingsStore(dir)
  expect(await s.get()).toEqual({ ...DEFAULT_SETTINGS, libraryPath: '/books' })
  const u = await s.update({ pomodoro: { ...DEFAULT_SETTINGS.pomodoro, workMin: 50 } })
  expect(u.pomodoro.workMin).toBe(50)
  expect(u.pomodoro.breakMin).toBe(5)
  for (const p of ['/a', '/b', '/c', '/d', '/e', '/a', '/f']) await s.rememberLibrary(p)
  const r = await s.get()
  expect(r.libraryPath).toBe('/f')
  expect(r.recentLibraries).toEqual(['/f', '/a', '/e', '/d', '/c'])
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/library.test.ts tests/unit/drm.test.ts tests/unit/settings.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement `ids.ts`, `scan.ts`, `drm.ts`**

`src/main/library/ids.ts`:
```ts
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { BookFormat } from '../../shared/types'

const HEAD_BYTES = 1024 * 1024

export async function computeBookId(absPath: string): Promise<string> {
  const fh = await open(absPath, 'r')
  try {
    const { size } = await fh.stat()
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, size))
    await fh.read(buf, 0, buf.length, 0)
    return createHash('sha256').update(buf).update(String(size)).digest('hex').slice(0, 16)
  } finally {
    await fh.close()
  }
}

const EXT: Record<string, BookFormat> = {
  '.epub': 'epub', '.mobi': 'mobi', '.azw3': 'azw3', '.azw': 'azw', '.fb2': 'fb2', '.cbz': 'cbz', '.pdf': 'pdf'
}

export function formatFromPath(p: string): BookFormat | null {
  return EXT[extname(p).toLowerCase()] ?? null
}

export function slugify(title: string, id: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '')
  return `${base || 'book'}-${id.slice(0, 6)}`
}

export function titleFromFilename(relPath: string): string {
  const name = basename(relPath, extname(relPath))
  return name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled'
}
```

`src/main/library/scan.ts`:
```ts
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { formatFromPath } from './ids'

const SKIP_DIRS = new Set(['knowledge', 'node_modules'])

export async function scanFolder(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(abs)
      } else if (e.isFile() && formatFromPath(e.name)) {
        out.push(relative(root, abs).split(sep).join('/'))
      }
    }
  }
  await walk(root)
  return out.sort()
}
```

`src/main/library/drm.ts`:
```ts
import { open, readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import type { BookFormat } from '../../shared/types'

const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'])

export async function detectDrm(absPath: string, format: BookFormat): Promise<string | null> {
  try {
    if (format === 'epub') return detectEpubDrm(new Uint8Array(await readFile(absPath)))
    if (format === 'mobi' || format === 'azw' || format === 'azw3') {
      const fh = await open(absPath, 'r')
      try {
        const head = Buffer.alloc(82)
        const { bytesRead } = await fh.read(head, 0, 82, 0)
        if (bytesRead < 82) return null
        return await detectMobiDrmBuffer(head, async (offset, len) => {
          const b = Buffer.alloc(len)
          await fh.read(b, 0, len, offset)
          return b
        })
      } finally {
        await fh.close()
      }
    }
    return null
  } catch {
    return null // unreadable files are reported when the reader fails to open them
  }
}

export function detectEpubDrm(zip: Uint8Array): string | null {
  const files = unzipSync(zip, {
    filter: f => f.name === 'META-INF/encryption.xml' || f.name === 'META-INF/rights.xml'
  })
  if (files['META-INF/rights.xml']) return 'Protected by Adobe DRM'
  const enc = files['META-INF/encryption.xml']
  if (!enc) return null
  const xml = strFromU8(enc)
  const algorithms = [...xml.matchAll(/<(?:[\w-]+:)?EncryptionMethod[^>]*Algorithm\s*=\s*"([^"]+)"/g)].map(m => m[1])
  return algorithms.some(a => !FONT_OBFUSCATION.has(a)) ? 'Encrypted with DRM' : null
}

// PalmDB header: type/creator at 60..68, record 0 offset at 78. MOBI record 0: encryption type at +12.
export async function detectMobiDrmBuffer(
  head: Buffer,
  readAt: (offset: number, len: number) => Promise<Buffer>
): Promise<string | null> {
  if (head.toString('latin1', 60, 68) !== 'BOOKMOBI') return null
  const rec0 = head.readUInt32BE(78)
  const field = await readAt(rec0 + 12, 2)
  if (field.length < 2) return null
  return field.readUInt16BE(0) !== 0 ? 'Protected by Kindle DRM' : null
}
```

- [ ] **Step 4: Implement `libraryService.ts` and `settings.ts`**

`src/main/library/libraryService.ts`:
```ts
import { mkdir, readFile, rename, stat, writeFile, access } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Book, BookStatus, LibraryFile } from '../../shared/types'
import { jsonFile, type JsonFile } from '../store/jsonFile'
import { computeBookId, formatFromPath, slugify, titleFromFilename } from './ids'
import { scanFolder } from './scan'
import { detectDrm } from './drm'

export class BookNotFoundError extends Error {
  constructor(id: string) {
    super(`Book not found: ${id}`)
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export class LibraryService {
  readonly dataDir: string
  private file: JsonFile<LibraryFile>

  constructor(
    readonly root: string,
    private now: () => Date = () => new Date(),
    private hash: (abs: string) => Promise<string> = computeBookId
  ) {
    this.dataDir = join(root, '.smartreader')
    this.file = jsonFile<LibraryFile>(join(this.dataDir, 'library.json'), () => ({ version: 1, books: {} }))
  }

  async scan(): Promise<Book[]> {
    const rels = await scanFolder(this.root)
    const lib = await this.file.read()
    const byPath = new Map(Object.values(lib.books).map(b => [b.path, b]))
    const found: Array<{ rel: string; id: string; size: number; mtimeMs: number }> = []
    for (const rel of rels) {
      const abs = join(this.root, rel)
      let st
      try {
        st = await stat(abs)
      } catch {
        continue
      }
      const known = byPath.get(rel)
      const unchanged = known && known.fileSize === st.size && known.mtimeMs === st.mtimeMs
      const id = unchanged ? known.id : await this.hash(abs)
      found.push({ rel, id, size: st.size, mtimeMs: st.mtimeMs })
    }
    // Prefer the stored path when a book exists in several places, so duplicates never flip it.
    found.sort((a, b) => Number(lib.books[b.id]?.path === b.rel) - Number(lib.books[a.id]?.path === a.rel))

    const drm = new Map<string, string | null>()
    for (const f of found) {
      if (!lib.books[f.id] && !drm.has(f.id)) drm.set(f.id, await detectDrm(join(this.root, f.rel), formatFromPath(f.rel)!))
    }

    await this.file.update(draft => {
      for (const b of Object.values(draft.books)) b.missing = true
      const seen = new Set<string>()
      for (const f of found) {
        if (seen.has(f.id)) continue
        seen.add(f.id)
        const existing = draft.books[f.id]
        if (existing) {
          Object.assign(existing, { path: f.rel, fileSize: f.size, mtimeMs: f.mtimeMs, missing: false })
          continue
        }
        const title = titleFromFilename(f.rel)
        const reason = drm.get(f.id) ?? null
        draft.books[f.id] = {
          id: f.id,
          slug: slugify(title, f.id),
          path: f.rel,
          format: formatFromPath(f.rel)!,
          title,
          author: '',
          addedAt: this.now().toISOString(),
          lastOpenedAt: null,
          location: null,
          progress: 0,
          status: reason ? 'drm' : 'ok',
          statusReason: reason,
          fileSize: f.size,
          mtimeMs: f.mtimeMs,
          metadataExtracted: false,
          hasCover: false,
          missing: false
        }
      }
    })
    return this.list()
  }

  async list(): Promise<Book[]> {
    const lib = await this.file.read()
    return Object.values(lib.books)
      .filter(b => !b.missing)
      .sort((a, b) => {
        if (a.lastOpenedAt && b.lastOpenedAt) return b.lastOpenedAt.localeCompare(a.lastOpenedAt)
        if (a.lastOpenedAt) return -1
        if (b.lastOpenedAt) return 1
        return a.title.localeCompare(b.title)
      })
  }

  async get(id: string): Promise<Book> {
    const b = (await this.file.read()).books[id]
    if (!b) throw new BookNotFoundError(id)
    return b
  }

  async bookDir(id: string): Promise<string> {
    return join(this.dataDir, 'books', (await this.get(id)).slug)
  }

  async readBook(id: string): Promise<{ name: string; data: Buffer }> {
    const b = await this.get(id)
    return { name: basename(b.path), data: await readFile(join(this.root, b.path)) }
  }

  async getCover(id: string): Promise<Buffer | null> {
    try {
      return await readFile(join(await this.bookDir(id), 'cover.jpg'))
    } catch {
      return null
    }
  }

  async saveMetadata(id: string, meta: { title: string; author: string; cover: Uint8Array | null }): Promise<Book> {
    const book = await this.get(id)
    const title = meta.title.trim() || book.title
    let slug = book.slug
    const oldDir = join(this.dataDir, 'books', book.slug)
    const candidate = slugify(title, id)
    if (candidate !== slug && !(await exists(join(oldDir, 'highlights.json')))) {
      if (await exists(oldDir)) {
        await mkdir(join(this.dataDir, 'books'), { recursive: true })
        await rename(oldDir, join(this.dataDir, 'books', candidate))
      }
      slug = candidate
    }
    if (meta.cover && meta.cover.length > 0) {
      const dir = join(this.dataDir, 'books', slug)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'cover.jpg'), meta.cover)
    }
    const hasCover = book.hasCover || (meta.cover !== null && meta.cover.length > 0)
    await this.file.update(d => {
      Object.assign(d.books[id], { title, author: meta.author.trim(), slug, metadataExtracted: true, hasCover })
    })
    return this.get(id)
  }

  async saveProgress(id: string, location: string, progress: number): Promise<void> {
    await this.get(id)
    const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0))
    await this.file.update(d => {
      Object.assign(d.books[id], { location, progress: p })
    })
  }

  async markOpened(id: string): Promise<void> {
    await this.get(id)
    await this.file.update(d => {
      d.books[id].lastOpenedAt = this.now().toISOString()
    })
  }

  async setStatus(id: string, status: BookStatus, reason: string | null): Promise<void> {
    await this.get(id)
    await this.file.update(d => {
      Object.assign(d.books[id], { status, statusReason: reason })
    })
  }
}
```

`src/main/settings.ts`:
```ts
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { jsonFile, type JsonFile } from './store/jsonFile'

export class SettingsStore {
  private file: JsonFile<Partial<Settings>>

  constructor(userDataDir: string) {
    this.file = jsonFile<Partial<Settings>>(join(userDataDir, 'settings.json'), () => ({}))
  }

  async get(): Promise<Settings> {
    const s = await this.file.read()
    return { ...DEFAULT_SETTINGS, ...s, pomodoro: { ...DEFAULT_SETTINGS.pomodoro, ...s.pomodoro } }
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    await this.file.update(d => ({
      ...d,
      ...patch,
      pomodoro: { ...DEFAULT_SETTINGS.pomodoro, ...d.pomodoro, ...patch.pomodoro }
    }))
    return this.get()
  }

  async rememberLibrary(path: string): Promise<Settings> {
    const recent = (await this.get()).recentLibraries.filter(p => p !== path)
    return this.update({ libraryPath: path, recentLibraries: [path, ...recent].slice(0, 5) })
  }
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/library.test.ts tests/unit/drm.test.ts tests/unit/settings.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/library src/main/settings.ts tests/unit/library.test.ts tests/unit/drm.test.ts tests/unit/settings.test.ts
git commit -m "feat(main): library scan, content-hash ids, DRM detection, settings store"
```

---

### Task 3: Highlight store and Markdown mirror (sonnet, wave 1)

**Files:**
- Create: `src/main/highlights/highlightStore.ts`, `src/main/highlights/markdown.ts`
- Test: `tests/unit/highlights.test.ts`

**Interfaces:**
- Consumes: `Highlight`, `HighlightsFile`, `NewHighlight`, `HighlightPatch`, `HIGHLIGHT_COLORS`, `LIMITS` (shared/types); `jsonFile`, `writeFileAtomic`, `readJson` (main/store).
- Produces:
  - `interface BookRef { bookId: string; slug: string; title: string; author: string }`
  - `class HighlightStore { constructor(dataDir: string, resolveBook: (bookId: string) => Promise<BookRef>, now?: () => Date); list(bookId): Promise<Highlight[]>; add(bookId, h: NewHighlight): Promise<Highlight>; update(bookId, id, patch: HighlightPatch): Promise<Highlight>; remove(bookId, id): Promise<void>; listAllBooks(): Promise<Array<{ bookId: string; highlights: Highlight[] }>> }` (`list` excludes deleted, sorted by position; `listAllBooks` includes deleted)
  - `class HighlightError extends Error`
  - `renderHighlightsMarkdown(book: { title: string; author: string }, highlights: Highlight[]): string`

- [ ] **Step 1: Write the failing tests**

`tests/unit/highlights.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HighlightStore, type BookRef } from '../../src/main/highlights/highlightStore'
import { renderHighlightsMarkdown } from '../../src/main/highlights/markdown'
import type { NewHighlight } from '../../src/shared/types'

let dataDir: string
let store: HighlightStore
const books: Record<string, BookRef> = {
  b1: { bookId: 'b1', slug: 'deep-work-b1b1b1', title: 'Deep Work', author: 'Cal Newport' },
  b2: { bookId: 'b2', slug: 'other-b2b2b2', title: 'Other', author: '' }
}
let tick = 0
const now = () => new Date(Date.UTC(2026, 9, 20, 10, 0, tick++))

const nh = (over: Partial<NewHighlight> = {}): NewHighlight => ({
  location: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
  quote: { exact: 'Deep work is valuable', prefix: 'p', suffix: 's' },
  context: 'In short: Deep work is valuable and rare.',
  chapter: 'Chapter 1',
  position: 0.1,
  color: 'yellow',
  note: null,
  ...over
})

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'sr-hl-'))
  store = new HighlightStore(dataDir, async id => books[id], now)
})

describe('HighlightStore', () => {
  it('adds with generated id/timestamps and persists under the book slug', async () => {
    const h = await store.add('b1', nh())
    expect(h.id).toMatch(/^h_[0-9a-f-]{36}$/)
    expect(h.deleted).toBe(false)
    expect(h.createdAt).toBe(h.updatedAt)
    const file = JSON.parse(await readFile(join(dataDir, 'books/deep-work-b1b1b1/highlights.json'), 'utf8'))
    expect(file).toMatchObject({ version: 1, bookId: 'b1' })
    expect(file.highlights[0].id).toBe(h.id)
  })

  it('normalizes: trims note to null, caps context and affixes', async () => {
    const h = await store.add('b1', nh({
      note: '   ',
      context: 'x'.repeat(900),
      quote: { exact: 'Deep work', prefix: 'a'.repeat(100), suffix: 'b'.repeat(100) }
    }))
    expect(h.note).toBeNull()
    expect(h.context).toHaveLength(600)
    expect(h.quote.prefix).toHaveLength(64)
    expect(h.quote.suffix).toHaveLength(64)
  })

  it('rejects blank and oversized highlights and bad colors', async () => {
    await expect(store.add('b1', nh({ quote: { exact: '  \n ', prefix: '', suffix: '' } }))).rejects.toThrow('empty')
    await expect(store.add('b1', nh({ quote: { exact: 'x'.repeat(3001), prefix: '', suffix: '' } }))).rejects.toThrow('too long')
    await expect(store.add('b1', nh({ color: 'purple' as never }))).rejects.toThrow('color')
  })

  it('list returns non-deleted sorted by position', async () => {
    const a = await store.add('b1', nh({ position: 0.5 }))
    const b = await store.add('b1', nh({ position: 0.2 }))
    const c = await store.add('b1', nh({ position: 0.9 }))
    await store.remove('b1', c.id)
    expect((await store.list('b1')).map(h => h.id)).toEqual([b.id, a.id])
  })

  it('update changes color/note/location and bumps updatedAt', async () => {
    const h = await store.add('b1', nh())
    const u = await store.update('b1', h.id, { color: 'green', note: 'Why?', location: 'epubcfi(/6/8)' })
    expect(u).toMatchObject({ color: 'green', note: 'Why?', location: 'epubcfi(/6/8)' })
    expect(u.updatedAt > h.updatedAt).toBe(true)
    await expect(store.update('b1', 'h_missing', { color: 'blue' })).rejects.toThrow('not found')
  })

  it('remove soft-deletes; listAllBooks includes deleted across books', async () => {
    const h = await store.add('b1', nh())
    await store.add('b2', nh())
    await store.remove('b1', h.id)
    const all = await store.listAllBooks()
    expect(all.map(x => x.bookId).sort()).toEqual(['b1', 'b2'])
    expect(all.find(x => x.bookId === 'b1')!.highlights[0].deleted).toBe(true)
  })

  it('writes highlights.md mirror on every change', async () => {
    const h = await store.add('b1', nh({ note: 'remember this' }))
    let md = await readFile(join(dataDir, 'books/deep-work-b1b1b1/highlights.md'), 'utf8')
    expect(md).toContain('# Deep Work — Cal Newport')
    expect(md).toContain('> Deep work is valuable')
    expect(md).toContain(`- id: ${h.id}`)
    expect(md).toContain('- note: remember this')
    await store.remove('b1', h.id)
    md = await readFile(join(dataDir, 'books/deep-work-b1b1b1/highlights.md'), 'utf8')
    expect(md).not.toContain(h.id)
  })

  it('concurrent adds are all kept', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.add('b1', nh({ position: i / 10 }))))
    expect(await store.list('b1')).toHaveLength(10)
  })
})

describe('renderHighlightsMarkdown', () => {
  it('groups consecutive highlights by chapter in position order and quotes multi-line text', () => {
    const base = { prefix: '', suffix: '' }
    const md = renderHighlightsMarkdown({ title: 'T', author: '' }, [
      { id: 'h_2', location: '', quote: { exact: 'second', ...base }, context: '', chapter: 'B', position: 0.6, color: 'blue', note: null, createdAt: '2026-10-20T00:00:00Z', updatedAt: '', deleted: false },
      { id: 'h_1', location: '', quote: { exact: 'line one\nline two', ...base }, context: '', chapter: 'A', position: 0.1, color: 'yellow', note: 'n', createdAt: '2026-10-19T00:00:00Z', updatedAt: '', deleted: false },
      { id: 'h_3', location: '', quote: { exact: 'gone', ...base }, context: '', chapter: 'A', position: 0.2, color: 'yellow', note: null, createdAt: '2026-10-19T00:00:00Z', updatedAt: '', deleted: true }
    ])
    expect(md.indexOf('## A')).toBeLessThan(md.indexOf('## B'))
    expect(md).toContain('> line one\n> line two')
    expect(md).toContain('- id: h_1 · color: yellow · 2026-10-19')
    expect(md).not.toContain('gone')
    expect(md.startsWith('# T\n')).toBe(true)
  })

  it('renders an empty-state line', () => {
    expect(renderHighlightsMarkdown({ title: 'T', author: 'A' }, [])).toContain('_No highlights yet._')
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/highlights.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `markdown.ts`**

```ts
import type { Highlight } from '../../shared/types'

export function renderHighlightsMarkdown(book: { title: string; author: string }, highlights: Highlight[]): string {
  const live = highlights.filter(h => !h.deleted).sort((a, b) => a.position - b.position)
  const lines = [`# ${book.title}${book.author ? ` — ${book.author}` : ''}`, '<!-- generated by Smart Reader; do not edit -->', '']
  let chapter: string | undefined
  for (const h of live) {
    const ch = h.chapter ?? 'Untitled section'
    if (ch !== chapter) {
      lines.push(`## ${ch}`, '')
      chapter = ch
    }
    lines.push(...h.quote.exact.trim().split('\n').map(l => `> ${l}`))
    lines.push(`- id: ${h.id} · color: ${h.color} · ${h.createdAt.slice(0, 10)}`)
    if (h.note) lines.push(`- note: ${h.note.replace(/\n/g, ' ')}`)
    lines.push('')
  }
  if (live.length === 0) lines.push('_No highlights yet._', '')
  return lines.join('\n')
}
```

- [ ] **Step 4: Implement `highlightStore.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { HIGHLIGHT_COLORS, LIMITS, type Highlight, type HighlightPatch, type HighlightsFile, type NewHighlight } from '../../shared/types'
import { jsonFile, type JsonFile } from '../store/jsonFile'
import { writeFileAtomic } from '../store/atomic'
import { renderHighlightsMarkdown } from './markdown'

export interface BookRef { bookId: string; slug: string; title: string; author: string }

export class HighlightError extends Error {}

export class HighlightStore {
  private files = new Map<string, JsonFile<HighlightsFile>>()

  constructor(
    private dataDir: string,
    private resolveBook: (bookId: string) => Promise<BookRef>,
    private now: () => Date = () => new Date()
  ) {}

  private fileAt(dir: string, bookId: string): JsonFile<HighlightsFile> {
    const path = join(dir, 'highlights.json')
    let f = this.files.get(path)
    if (!f) {
      f = jsonFile<HighlightsFile>(path, () => ({ version: 1, bookId, highlights: [] }), {
        afterWrite: async value => {
          const book = await this.resolveBook(value.bookId)
          await writeFileAtomic(join(dir, 'highlights.md'), renderHighlightsMarkdown(book, value.highlights))
        }
      })
      this.files.set(path, f)
    }
    return f
  }

  private async fileFor(bookId: string): Promise<JsonFile<HighlightsFile>> {
    const ref = await this.resolveBook(bookId)
    return this.fileAt(join(this.dataDir, 'books', ref.slug), bookId)
  }

  async list(bookId: string): Promise<Highlight[]> {
    const f = await this.fileFor(bookId)
    return (await f.read()).highlights.filter(h => !h.deleted).sort((a, b) => a.position - b.position)
  }

  async add(bookId: string, input: NewHighlight): Promise<Highlight> {
    const exact = input.quote.exact
    if (!exact.trim()) throw new HighlightError('Highlight is empty')
    if (exact.length > LIMITS.exactMaxChars) throw new HighlightError('Highlight is too long')
    if (!HIGHLIGHT_COLORS.includes(input.color)) throw new HighlightError(`Unknown color: ${input.color}`)
    const ts = this.now().toISOString()
    const h: Highlight = {
      id: `h_${randomUUID()}`,
      location: input.location,
      quote: {
        exact,
        prefix: input.quote.prefix.slice(-LIMITS.quoteAffixChars),
        suffix: input.quote.suffix.slice(0, LIMITS.quoteAffixChars)
      },
      context: input.context.slice(0, LIMITS.contextChars),
      chapter: input.chapter,
      position: Math.min(1, Math.max(0, input.position || 0)),
      color: input.color,
      note: input.note?.trim() || null,
      createdAt: ts,
      updatedAt: ts,
      deleted: false
    }
    const f = await this.fileFor(bookId)
    await f.update(d => {
      d.highlights.push(h)
    })
    return h
  }

  async update(bookId: string, id: string, patch: HighlightPatch): Promise<Highlight> {
    if (patch.color && !HIGHLIGHT_COLORS.includes(patch.color)) throw new HighlightError(`Unknown color: ${patch.color}`)
    const f = await this.fileFor(bookId)
    let result: Highlight | undefined
    await f.update(d => {
      const h = d.highlights.find(x => x.id === id && !x.deleted)
      if (!h) throw new HighlightError(`Highlight not found: ${id}`)
      if (patch.color) h.color = patch.color
      if (patch.note !== undefined) h.note = patch.note?.trim() || null
      if (patch.location) h.location = patch.location
      h.updatedAt = this.now().toISOString()
      result = { ...h }
    })
    return result!
  }

  async remove(bookId: string, id: string): Promise<void> {
    const f = await this.fileFor(bookId)
    await f.update(d => {
      const h = d.highlights.find(x => x.id === id)
      if (!h) throw new HighlightError(`Highlight not found: ${id}`)
      h.deleted = true
      h.updatedAt = this.now().toISOString()
    })
  }

  async listAllBooks(): Promise<Array<{ bookId: string; highlights: Highlight[] }>> {
    const booksDir = join(this.dataDir, 'books')
    let dirs: string[]
    try {
      dirs = (await readdir(booksDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name)
    } catch {
      return []
    }
    const out: Array<{ bookId: string; highlights: Highlight[] }> = []
    for (const name of dirs) {
      const f = this.fileAt(join(booksDir, name), '')
      const v = await f.read()
      if (v.bookId && v.highlights.length) out.push({ bookId: v.bookId, highlights: v.highlights })
    }
    return out
  }
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/highlights.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/highlights tests/unit/highlights.test.ts
git commit -m "feat(main): highlight store with soft delete and markdown mirror"
```

---

### Task 4: Review engine: FSRS, prompts, cloze, watcher (sonnet, wave 1)

**Files:**
- Create: `src/main/review/scheduler.ts`, `src/main/review/cards.ts`, `src/main/review/prompts.ts`, `src/main/review/reviewService.ts`
- Test: `tests/unit/scheduler.test.ts`, `tests/unit/cards.test.ts`, `tests/unit/prompts.test.ts`, `tests/unit/reviewService.test.ts`

**Interfaces:**
- Consumes: `CardState`, `Rating`, `Highlight`, `PromptLine`, `ReviewCard`, `ReviewLogEntry`, `ReviewStateFile`, `PromptIssues`, `PromptType` (shared/types); `localDay` (shared/dates); `jsonFile`, `appendJsonl`, `readJsonl` (main/store). Does **not** import Task 3. Highlights arrive through the `HighlightSource` interface.
- Produces:
  - `newCardState(bookId: string, due: Date): CardState`, `schedule(c: CardState, rating: Rating, now: Date, retention?: number): CardState`, `retrievability(c: CardState, now: Date, retention?: number): number` (0 for never-reviewed)
  - `makeCloze(context: string, exact: string): string`, `buildPrompt(h: Highlight, ai?: PromptLine): { promptType: PromptType; prompt: string; aiAnswer: string | null }`
  - `parsePromptLines(items: unknown[]): { prompts: Map<string, PromptLine>; invalid: number }`, `class PromptWatcher { constructor(file: string, onChange?: () => void); load(): Promise<void>; start(intervalMs?: number): void; stop(): void; get(id: string): PromptLine | undefined; ids(): string[]; readonly invalidLines: number }`
  - `interface HighlightSource { listAllBooks(): Promise<Array<{ bookId: string; highlights: Highlight[] }>> }`
  - `class ReviewService { constructor(deps: ReviewDeps); sync(): Promise<void>; cards(): Promise<Record<string, CardState>>; queue(): Promise<ReviewCard[]>; dueCount(): Promise<number>; rate(highlightId: string, rating: Rating, durationMs: number, promptType: PromptType): Promise<ReviewLogEntry>; promptIssues(): Promise<PromptIssues>; readonly desiredRetention: number }`
  - `interface ReviewDeps { dataDir: string; highlights: HighlightSource; bookTitle: (bookId: string) => Promise<string>; prompts: Pick<PromptWatcher, 'get' | 'ids' | 'invalidLines'>; newCardsPerDay: () => Promise<number>; now?: () => Date }`

- [ ] **Step 1: Write the failing tests**

`tests/unit/scheduler.test.ts`:
```ts
import { it, expect } from 'vitest'
import { newCardState, schedule, retrievability } from '../../src/main/review/scheduler'

const t0 = new Date('2026-10-20T10:00:00Z')

it('new card is New, due at creation, zero retrievability', () => {
  const c = newCardState('b1', t0)
  expect(c).toMatchObject({ bookId: 'b1', state: 0, reps: 0, suspended: false, last_review: null, due: t0.toISOString() })
  expect(retrievability(c, t0)).toBe(0)
})

it('good on a new card moves to learning; repeated good reaches review with growing intervals', () => {
  let c = newCardState('b1', t0)
  c = schedule(c, 'good', t0)
  expect(c.state).toBe(1)
  expect(c.reps).toBe(1)
  expect(c.last_review).toBe(t0.toISOString())
  let now = new Date(c.due)
  c = schedule(c, 'good', now)
  expect(c.state).toBe(2)
  const firstInterval = new Date(c.due).getTime() - now.getTime()
  now = new Date(c.due)
  c = schedule(c, 'good', now)
  expect(new Date(c.due).getTime() - now.getTime()).toBeGreaterThan(firstInterval)
})

it('again on a review card increments lapses; retrievability decays over time', () => {
  let c = schedule(newCardState('b1', t0), 'easy', t0)
  const r1 = retrievability(c, new Date(t0.getTime() + 86400000))
  const r30 = retrievability(c, new Date(t0.getTime() + 30 * 86400000))
  expect(r1).toBeGreaterThan(r30)
  expect(r1).toBeLessThanOrEqual(1)
  c = schedule(c, 'again', new Date(c.due))
  expect(c.lapses).toBe(1)
})

it('preserves suspended flag and bookId through scheduling', () => {
  const c = { ...newCardState('bX', t0), suspended: true }
  expect(schedule(c, 'good', t0)).toMatchObject({ bookId: 'bX', suspended: true })
})
```

`tests/unit/cards.test.ts`:
```ts
import { it, expect } from 'vitest'
import { makeCloze, buildPrompt } from '../../src/main/review/cards'
import type { Highlight } from '../../src/shared/types'

const h = (over: Partial<Highlight> = {}): Highlight => ({
  id: 'h_1', location: 'cfi', quote: { exact: 'deliberate practice', prefix: '', suffix: '' },
  context: 'Experts rely on deliberate practice to improve.', chapter: 'Ch 2', position: 0.2,
  color: 'yellow', note: null, createdAt: '', updatedAt: '', deleted: false, ...over
})

it('blanks the highlight inside its context with a word count', () => {
  expect(makeCloze('Experts rely on deliberate practice to improve.', 'deliberate practice'))
    .toBe('Experts rely on ▁▁▁▁ (~2 words) to improve.')
  expect(makeCloze('A word here.', 'word')).toBe('A ▁▁▁▁ (~1 word) here.')
})

it('long highlights keep the first 6 words as a cue', () => {
  const words = Array.from({ length: 45 }, (_, i) => `w${i}`).join(' ')
  expect(makeCloze(`Start ${words} end`, words)).toBe('Start w0 w1 w2 w3 w4 w5 ▁▁▁▁ (~39 more words) end')
})

it('matches across whitespace differences', () => {
  expect(makeCloze('one  two\nthree four', 'two three')).toBe('one ▁▁▁▁ (~2 words) four')
})

it('cloze falls back when quote not in context', () => {
  expect(makeCloze('unrelated context', 'missing words')).toBe('▁▁▁▁ (~2 words)')
})

it('prompt priority: ai > note question > cloze', () => {
  expect(buildPrompt(h(), { highlightId: 'h_1', question: 'Why practice?', answer: 'Because.' }))
    .toEqual({ promptType: 'ai', prompt: 'Why practice?', aiAnswer: 'Because.' })
  expect(buildPrompt(h({ note: ' What makes practice deliberate? ' })))
    .toEqual({ promptType: 'note', prompt: 'What makes practice deliberate?', aiAnswer: null })
  expect(buildPrompt(h({ note: 'just a note' })).promptType).toBe('cloze')
  expect(buildPrompt(h({ note: 'just a note' })).prompt).toBe('Experts rely on ▁▁▁▁ (~2 words) to improve.')
})
```

`tests/unit/prompts.test.ts`:
```ts
import { it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, appendFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePromptLines, PromptWatcher } from '../../src/main/review/prompts'

it('keeps the last valid line per highlight and counts invalid objects', () => {
  const r = parsePromptLines([
    { highlightId: 'h_1', question: 'Q1' },
    { highlightId: 'h_1', question: 'Q1 better', answer: 'A' },
    { highlightId: 'h_2' },
    { question: 'no id' },
    { highlightId: 'h_3', question: '   ' }
  ])
  expect(r.prompts.get('h_1')).toEqual({ highlightId: 'h_1', question: 'Q1 better', answer: 'A' })
  expect(r.prompts.size).toBe(1)
  expect(r.invalid).toBe(3)
})

it('partial trailing line is skipped then picked up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sr-pr-'))
  const file = join(dir, 'prompts.jsonl')
  await writeFile(file, '{"highlightId":"h_1","question":"Q1"}\n{"highlightId":"h_2","quest')
  const onChange = vi.fn()
  const w = new PromptWatcher(file, onChange)
  await w.load()
  expect(w.get('h_1')?.question).toBe('Q1')
  expect(w.get('h_2')).toBeUndefined()
  expect(w.invalidLines).toBe(1)
  w.start(50)
  await appendFile(file, 'ion":"Q2"}\n')
  await vi.waitFor(() => expect(w.get('h_2')?.question).toBe('Q2'), { timeout: 3000 })
  expect(onChange).toHaveBeenCalled()
  expect(w.invalidLines).toBe(0)
  w.stop()
})

it('survives the file being replaced via rename and being absent at start', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sr-pr-'))
  const file = join(dir, 'prompts.jsonl')
  const w = new PromptWatcher(file)
  await w.load()
  expect(w.ids()).toEqual([])
  w.start(50)
  await writeFile(join(dir, 'tmp'), '{"highlightId":"h_9","question":"Q9"}\n')
  await rename(join(dir, 'tmp'), file)
  await vi.waitFor(() => expect(w.get('h_9')?.question).toBe('Q9'), { timeout: 3000 })
  w.stop()
})
```

`tests/unit/reviewService.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewService, type HighlightSource } from '../../src/main/review/reviewService'
import type { Highlight, PromptLine } from '../../src/shared/types'

let dataDir: string
let clock: Date
let books: Array<{ bookId: string; highlights: Highlight[] }>
let prompts: Map<string, PromptLine>
let quota: number

const hl = (id: string, over: Partial<Highlight> = {}): Highlight => ({
  id, location: `cfi-${id}`, quote: { exact: `text ${id}`, prefix: '', suffix: '' }, context: `ctx text ${id} end`,
  chapter: 'C', position: 0, color: 'yellow', note: null, createdAt: '2026-10-20T08:00:00.000Z',
  updatedAt: '', deleted: false, ...over
})

function service(): ReviewService {
  const source: HighlightSource = { listAllBooks: async () => books }
  return new ReviewService({
    dataDir,
    highlights: source,
    bookTitle: async id => `Title ${id}`,
    prompts: { get: id => prompts.get(id), ids: () => [...prompts.keys()], invalidLines: 2 },
    newCardsPerDay: async () => quota,
    now: () => clock
  })
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'sr-rev-'))
  clock = new Date('2026-10-20T12:00:00')
  books = [{ bookId: 'b1', highlights: [hl('h_1'), hl('h_2', { createdAt: '2026-10-20T09:00:00.000Z' })] }]
  prompts = new Map()
  quota = 20
})

describe('ReviewService', () => {
  it('creates a New card for each highlight and builds cloze cards', async () => {
    const q = await service().queue()
    expect(q.map(c => c.highlightId)).toEqual(['h_1', 'h_2'])
    expect(q[0]).toMatchObject({
      bookId: 'b1', bookTitle: 'Title b1', chapter: 'C', location: 'cfi-h_1', promptType: 'cloze',
      prompt: 'ctx ▁▁▁▁ (~2 words) end', answer: 'text h_1', isNew: true, aiAnswer: null
    })
    const state = JSON.parse(await readFile(join(dataDir, 'review-state.json'), 'utf8'))
    expect(state.desiredRetention).toBe(0.9)
    expect(Object.keys(state.cards).sort()).toEqual(['h_1', 'h_2'])
  })

  it('uses AI prompts when present', async () => {
    prompts.set('h_2', { highlightId: 'h_2', question: 'Explain h2?', answer: 'Because' })
    const q = await service().queue()
    expect(q.find(c => c.highlightId === 'h_2')).toMatchObject({ promptType: 'ai', prompt: 'Explain h2?', aiAnswer: 'Because' })
  })

  it('rate schedules, logs, and removes the card from the immediate queue', async () => {
    const s = service()
    const entry = await s.rate('h_1', 'good', 4200.6, 'cloze')
    expect(entry).toMatchObject({ highlightId: 'h_1', bookId: 'b1', rating: 'good', promptType: 'cloze', durationMs: 4201, retrievabilityBefore: 0, wasNew: true })
    const log = (await readFile(join(dataDir, 'review-log.jsonl'), 'utf8')).trim().split('\n')
    expect(log).toHaveLength(1)
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_2'])
    clock = new Date(clock.getTime() + 60 * 60 * 1000)
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_1', 'h_2'])
  })

  it('due review cards come first, ordered by lowest retrievability', async () => {
    books = [{ bookId: 'b1', highlights: [hl('h_a'), hl('h_b'), hl('h_new')] }]
    const s = service()
    await s.rate('h_a', 'easy', 1, 'cloze')
    await s.rate('h_b', 'hard', 1, 'cloze')
    clock = new Date('2026-12-31T12:00:00')
    const q = await s.queue()
    expect(q.slice(0, 2).map(c => c.highlightId).sort()).toEqual(['h_a', 'h_b'])
    expect(q[2].highlightId).toBe('h_new')
    expect(q[0].isNew).toBe(false)
  })

  it('enforces the new-cards-per-day quota using today\'s log', async () => {
    quota = 1
    books = [{ bookId: 'b1', highlights: [hl('h_1'), hl('h_2'), hl('h_3')] }]
    const s = service()
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_1'])
    await s.rate('h_1', 'good', 1, 'cloze')
    expect(await s.queue()).toEqual([])
    expect(await s.dueCount()).toBe(0)
    clock = new Date('2026-10-21T12:00:00')
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_1', 'h_2'])
  })

  it('deleted highlights suspend their cards', async () => {
    const s = service()
    await s.queue()
    books = [{ bookId: 'b1', highlights: [hl('h_1', { deleted: true }), hl('h_2')] }]
    expect((await s.queue()).map(c => c.highlightId)).toEqual(['h_2'])
    expect((await s.cards())['h_1'].suspended).toBe(true)
  })

  it('rate on unknown card rejects', async () => {
    await expect(service().rate('h_zzz', 'good', 1, 'cloze')).rejects.toThrow('No card')
  })

  it('reports prompt issues', async () => {
    prompts.set('h_1', { highlightId: 'h_1', question: 'ok' })
    prompts.set('h_ghost', { highlightId: 'h_ghost', question: 'ghost' })
    const s = service()
    await s.queue()
    expect(await s.promptIssues()).toEqual({ invalidLines: 2, unknownHighlightIds: 1 })
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/scheduler.test.ts tests/unit/cards.test.ts tests/unit/prompts.test.ts tests/unit/reviewService.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `scheduler.ts` and `cards.ts`**

`src/main/review/scheduler.ts`:
```ts
import { createEmptyCard, fsrs, generatorParameters, Rating as FsrsRating, type Card, type FSRS, type Grade, type State } from 'ts-fsrs'
import type { CardState, FsrsState, Rating } from '../../shared/types'

const GRADE: Record<Rating, Grade> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy
}

const schedulers = new Map<number, FSRS>()
function scheduler(retention: number): FSRS {
  let s = schedulers.get(retention)
  if (!s) {
    s = fsrs(generatorParameters({ request_retention: retention, enable_fuzz: false }))
    schedulers.set(retention, s)
  }
  return s
}

function toFsrs(c: CardState): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as State,
    last_review: c.last_review ? new Date(c.last_review) : undefined
  } as Card
}

function fromFsrs(card: Card, bookId: string, suspended: boolean): CardState {
  return {
    bookId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as FsrsState,
    last_review: card.last_review ? card.last_review.toISOString() : null,
    suspended
  }
}

export function newCardState(bookId: string, due: Date): CardState {
  return fromFsrs(createEmptyCard(due), bookId, false)
}

export function schedule(c: CardState, rating: Rating, now: Date, retention = 0.9): CardState {
  const { card } = scheduler(retention).next(toFsrs(c), now, GRADE[rating])
  return fromFsrs(card, c.bookId, c.suspended)
}

// Never-reviewed cards count as 0: exposure is not retention.
export function retrievability(c: CardState, now: Date, retention = 0.9): number {
  if (c.state === 0 || c.reps === 0) return 0
  return scheduler(retention).get_retrievability(toFsrs(c), now, false)
}
```

`src/main/review/cards.ts`:
```ts
import type { Highlight, PromptLine, PromptType } from '../../shared/types'

function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

export function makeCloze(context: string, exact: string): string {
  const ex = exact.trim()
  const n = wordCount(ex)
  const blank = n > 40
    ? `${ex.split(/\s+/).slice(0, 6).join(' ')} ▁▁▁▁ (~${n - 6} more words)`
    : `▁▁▁▁ (~${n} word${n === 1 ? '' : 's'})`
  const i = context.indexOf(ex)
  if (i >= 0) return context.slice(0, i) + blank + context.slice(i + ex.length)
  const norm = (s: string): string => s.replace(/\s+/g, ' ')
  const nc = norm(context)
  const ne = norm(ex)
  const j = nc.indexOf(ne)
  if (j >= 0) return nc.slice(0, j) + blank + nc.slice(j + ne.length)
  return blank
}

export function buildPrompt(h: Highlight, ai?: PromptLine): { promptType: PromptType; prompt: string; aiAnswer: string | null } {
  if (ai) return { promptType: 'ai', prompt: ai.question, aiAnswer: ai.answer ?? null }
  const note = h.note?.trim()
  if (note && note.endsWith('?')) return { promptType: 'note', prompt: note, aiAnswer: null }
  return { promptType: 'cloze', prompt: makeCloze(h.context, h.quote.exact), aiAnswer: null }
}
```

- [ ] **Step 4: Implement `prompts.ts`**

```ts
import { unwatchFile, watchFile } from 'node:fs'
import type { PromptLine } from '../../shared/types'
import { readJsonl } from '../store/jsonl'

export function parsePromptLines(items: unknown[]): { prompts: Map<string, PromptLine>; invalid: number } {
  const prompts = new Map<string, PromptLine>()
  let invalid = 0
  for (const it of items) {
    const o = it as Partial<PromptLine>
    if (typeof o.highlightId !== 'string' || typeof o.question !== 'string' || !o.question.trim()) {
      invalid++
      continue
    }
    const line: PromptLine = { highlightId: o.highlightId, question: o.question.trim() }
    if (typeof o.answer === 'string' && o.answer.trim()) line.answer = o.answer.trim()
    if (typeof o.createdAt === 'string') line.createdAt = o.createdAt
    if (typeof o.by === 'string') line.by = o.by
    prompts.set(o.highlightId, line)
  }
  return { prompts, invalid }
}

// Polls with fs.watchFile so it survives agents replacing the file via rename.
export class PromptWatcher {
  private prompts = new Map<string, PromptLine>()
  private invalid = 0
  private watching = false

  constructor(private file: string, private onChange: () => void = () => {}) {}

  get invalidLines(): number {
    return this.invalid
  }

  async load(): Promise<void> {
    const { items, skipped } = await readJsonl<unknown>(this.file)
    const r = parsePromptLines(items)
    this.prompts = r.prompts
    this.invalid = skipped + r.invalid
  }

  start(intervalMs = 1000): void {
    if (this.watching) return
    this.watching = true
    watchFile(this.file, { interval: intervalMs }, (cur, prev) => {
      if (cur.mtimeMs !== prev.mtimeMs || cur.size !== prev.size || cur.ino !== prev.ino) {
        void this.load().then(() => this.onChange(), () => undefined)
      }
    })
  }

  stop(): void {
    if (!this.watching) return
    unwatchFile(this.file)
    this.watching = false
  }

  get(highlightId: string): PromptLine | undefined {
    return this.prompts.get(highlightId)
  }

  ids(): string[] {
    return [...this.prompts.keys()]
  }
}
```

- [ ] **Step 5: Implement `reviewService.ts`**

```ts
import { join } from 'node:path'
import type { CardState, Highlight, PromptIssues, PromptLine, PromptType, Rating, ReviewCard, ReviewLogEntry, ReviewStateFile } from '../../shared/types'
import { localDay } from '../../shared/dates'
import { jsonFile, type JsonFile } from '../store/jsonFile'
import { appendJsonl, readJsonl } from '../store/jsonl'
import { newCardState, retrievability, schedule } from './scheduler'
import { buildPrompt } from './cards'

export interface HighlightSource {
  listAllBooks(): Promise<Array<{ bookId: string; highlights: Highlight[] }>>
}

export interface ReviewDeps {
  dataDir: string
  highlights: HighlightSource
  bookTitle: (bookId: string) => Promise<string>
  prompts: { get(id: string): PromptLine | undefined; ids(): string[]; readonly invalidLines: number }
  newCardsPerDay: () => Promise<number>
  now?: () => Date
}

export class ReviewService {
  readonly desiredRetention = 0.9
  private state: JsonFile<ReviewStateFile>
  private logPath: string
  private now: () => Date

  constructor(private deps: ReviewDeps) {
    this.now = deps.now ?? (() => new Date())
    this.state = jsonFile<ReviewStateFile>(join(deps.dataDir, 'review-state.json'), () => ({
      version: 1,
      desiredRetention: this.desiredRetention,
      cards: {}
    }))
    this.logPath = join(deps.dataDir, 'review-log.jsonl')
  }

  private async liveHighlights(): Promise<Map<string, { bookId: string; h: Highlight }>> {
    const map = new Map<string, { bookId: string; h: Highlight }>()
    for (const { bookId, highlights } of await this.deps.highlights.listAllBooks()) {
      for (const h of highlights) if (!h.deleted) map.set(h.id, { bookId, h })
    }
    return map
  }

  async sync(): Promise<void> {
    const books = await this.deps.highlights.listAllBooks()
    await this.state.update(d => {
      for (const { bookId, highlights } of books) {
        for (const h of highlights) {
          const c = d.cards[h.id]
          if (h.deleted) {
            if (c) c.suspended = true
          } else if (!c) {
            d.cards[h.id] = newCardState(bookId, new Date(h.createdAt))
          }
        }
      }
    })
  }

  async cards(): Promise<Record<string, CardState>> {
    await this.sync()
    return (await this.state.read()).cards
  }

  private async newIntroducedToday(): Promise<number> {
    const { items } = await readJsonl<ReviewLogEntry>(this.logPath)
    const today = localDay(this.now())
    return new Set(items.filter(e => e.wasNew && localDay(new Date(e.ts)) === today).map(e => e.highlightId)).size
  }

  async queue(): Promise<ReviewCard[]> {
    await this.sync()
    const now = this.now()
    const st = await this.state.read()
    const live = await this.liveHighlights()
    const due: Array<{ id: string; r: number }> = []
    const fresh: Array<{ id: string; created: string }> = []
    for (const [id, c] of Object.entries(st.cards)) {
      const entry = live.get(id)
      if (c.suspended || !entry) continue
      if (c.state === 0) fresh.push({ id, created: entry.h.createdAt })
      else if (new Date(c.due) <= now) due.push({ id, r: retrievability(c, now, st.desiredRetention) })
    }
    due.sort((a, b) => a.r - b.r)
    fresh.sort((a, b) => a.created.localeCompare(b.created))
    const quota = Math.max(0, (await this.deps.newCardsPerDay()) - (await this.newIntroducedToday()))
    const ids = [...due.map(d => d.id), ...fresh.slice(0, quota).map(f => f.id)]

    const titles = new Map<string, string>()
    const cards: ReviewCard[] = []
    for (const id of ids) {
      const { bookId, h } = live.get(id)!
      if (!titles.has(bookId)) titles.set(bookId, await this.deps.bookTitle(bookId).catch(() => 'Unknown book'))
      cards.push({
        highlightId: id,
        bookId,
        bookTitle: titles.get(bookId)!,
        chapter: h.chapter,
        location: h.location,
        ...buildPrompt(h, this.deps.prompts.get(id)),
        answer: h.quote.exact,
        note: h.note,
        isNew: st.cards[id].state === 0
      })
    }
    return cards
  }

  async dueCount(): Promise<number> {
    return (await this.queue()).length
  }

  async rate(highlightId: string, rating: Rating, durationMs: number, promptType: PromptType): Promise<ReviewLogEntry> {
    const now = this.now()
    let entry: ReviewLogEntry | undefined
    await this.state.update(d => {
      const c = d.cards[highlightId]
      if (!c) throw new Error(`No card for ${highlightId}`)
      const before = retrievability(c, now, d.desiredRetention)
      entry = {
        ts: now.toISOString(),
        highlightId,
        bookId: c.bookId,
        rating,
        promptType,
        durationMs: Math.max(0, Math.round(durationMs)),
        retrievabilityBefore: Math.round(before * 1000) / 1000,
        wasNew: c.state === 0
      }
      d.cards[highlightId] = schedule(c, rating, now, d.desiredRetention)
    })
    await appendJsonl(this.logPath, entry)
    return entry!
  }

  async promptIssues(): Promise<PromptIssues> {
    const known = new Set(Object.keys((await this.state.read()).cards))
    return {
      invalidLines: this.deps.prompts.invalidLines,
      unknownHighlightIds: this.deps.prompts.ids().filter(id => !known.has(id)).length
    }
  }
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/scheduler.test.ts tests/unit/cards.test.ts tests/unit/prompts.test.ts tests/unit/reviewService.test.ts && npm run typecheck`
Expected: PASS. If the ts-fsrs `Card` type requires fields not listed in `toFsrs`, add them with values from `createEmptyCard()`. Do not change `CardState` in shared types without reporting `NEEDS_CONTEXT`.

- [ ] **Step 7: Commit**

```bash
git add src/main/review tests/unit/scheduler.test.ts tests/unit/cards.test.ts tests/unit/prompts.test.ts tests/unit/reviewService.test.ts
git commit -m "feat(main): FSRS review engine, cloze prompts, AI prompt watcher"
```

---

### Task 5: Sessions, metrics and stats (sonnet, wave 1)

**Files:**
- Create: `src/main/metrics/sessions.ts`, `src/main/metrics/metrics.ts`, `src/main/metrics/stats.ts`
- Test: `tests/unit/metrics.test.ts`, `tests/unit/stats.test.ts`

**Interfaces:**
- Consumes: `SessionEntry`, `MetricSnapshot`, `Stats`, `CardState`, `ReviewLogEntry` (shared/types); `localDay`, `addDays` (shared/dates); `appendJsonl`, `readJsonl` (main/store). Does **not** import Task 4. `retrievability` is injected.
- Produces:
  - `class SessionLog { constructor(dataDir: string); append(e: Omit<SessionEntry, 'minutes'>): Promise<SessionEntry | null>; all(): Promise<SessionEntry[]> }` (null when shorter than 0.1 min)
  - `computeK(cards: CardState[], now: Date, retr: (c: CardState, now: Date) => number): number`
  - `cumulativeMinutes(sessions: SessionEntry[]): number`
  - `knowledgePerHour(snapshots: MetricSnapshot[], current: { K: number; cumulativeMinutes: number }, now: Date): number | null`
  - `class MetricsLog { constructor(dataDir: string); all(): Promise<MetricSnapshot[]>; ensureToday(now: Date, K: number, cumulativeMinutes: number): Promise<void> }`
  - `buildStats(input: StatsInput): Stats`, `interface StatsInput`
  - `class StatsService { constructor(deps: StatsDeps); get(): Promise<Stats> }`, `interface StatsDeps { dataDir: string; getCards: () => Promise<Record<string, CardState>>; dueCount: () => Promise<number>; books: () => Promise<Array<{ id: string; title: string }>>; sessions: SessionLog; retrievability: (c: CardState, now: Date) => number; now?: () => Date }`

- [ ] **Step 1: Write the failing tests**

`tests/unit/metrics.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionLog } from '../../src/main/metrics/sessions'
import { computeK, cumulativeMinutes, knowledgePerHour, MetricsLog } from '../../src/main/metrics/metrics'
import type { CardState } from '../../src/shared/types'

const card = (over: Partial<CardState>): CardState => ({
  bookId: 'b', due: '', stability: 1, difficulty: 1, elapsed_days: 0, scheduled_days: 0, learning_steps: 0,
  reps: 1, lapses: 0, state: 2, last_review: '', suspended: false, ...over
})

describe('SessionLog', () => {
  it('computes minutes, drops tiny sessions, rejects invalid ranges', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sr-s-'))
    const log = new SessionLog(dir)
    const e = await log.append({ start: '2026-10-20T10:00:00Z', end: '2026-10-20T10:25:30Z', kind: 'reading', bookId: 'b', pomodoro: true })
    expect(e?.minutes).toBe(25.5)
    expect(await log.append({ start: '2026-10-20T10:00:00Z', end: '2026-10-20T10:00:03Z', kind: 'reading', bookId: 'b', pomodoro: false })).toBeNull()
    await expect(log.append({ start: '2026-10-20T10:00:00Z', end: '2026-10-20T09:00:00Z', kind: 'reading', bookId: null, pomodoro: false })).rejects.toThrow('Invalid session')
    expect(await log.all()).toHaveLength(1)
    expect((await readFile(join(dir, 'sessions.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1)
  })
})

describe('metrics', () => {
  it('K sums retrievability of reviewed, unsuspended cards', () => {
    const cards = [card({}), card({ reps: 0, state: 0 }), card({ suspended: true }), card({})]
    expect(computeK(cards, new Date(), () => 0.8)).toBe(1.6)
  })

  it('cumulative minutes excludes breaks', () => {
    expect(cumulativeMinutes([
      { start: '', end: '', kind: 'reading', bookId: null, minutes: 20, pomodoro: false },
      { start: '', end: '', kind: 'review', bookId: null, minutes: 5, pomodoro: false },
      { start: '', end: '', kind: 'break', bookId: null, minutes: 5, pomodoro: true }
    ])).toBe(25)
  })

  it('knowledgePerHour uses the snapshot ~30 days back, else the earliest', () => {
    const now = new Date('2026-12-01T12:00:00')
    const snaps = [
      { date: '2026-10-01', K: 0, cumulativeMinutes: 0 },
      { date: '2026-10-30', K: 10, cumulativeMinutes: 600 },
      { date: '2026-11-20', K: 30, cumulativeMinutes: 1200 }
    ]
    expect(knowledgePerHour(snaps, { K: 40, cumulativeMinutes: 1800 }, now)).toBe(1.5)
    expect(knowledgePerHour(snaps.slice(2), { K: 40, cumulativeMinutes: 1800 }, now)).toBe(1)
    expect(knowledgePerHour([], { K: 1, cumulativeMinutes: 10 }, now)).toBeNull()
    expect(knowledgePerHour(snaps.slice(2), { K: 31, cumulativeMinutes: 1210 }, now)).toBeNull()
  })

  it('ensureToday appends at most one snapshot per local day', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sr-m-'))
    const m = new MetricsLog(dir)
    await m.ensureToday(new Date('2026-10-20T09:00:00'), 1, 10)
    await m.ensureToday(new Date('2026-10-20T18:00:00'), 2, 20)
    await m.ensureToday(new Date('2026-10-21T09:00:00'), 3, 30)
    expect(await m.all()).toEqual([
      { date: '2026-10-20', K: 1, cumulativeMinutes: 10 },
      { date: '2026-10-21', K: 3, cumulativeMinutes: 30 }
    ])
  })
})
```

`tests/unit/stats.test.ts`:
```ts
import { it, expect } from 'vitest'
import { buildStats } from '../../src/main/metrics/stats'
import type { CardState, ReviewLogEntry } from '../../src/shared/types'

const now = new Date('2026-10-20T12:00:00')
const card = (over: Partial<CardState>): CardState => ({
  bookId: 'b1', due: '2026-10-20T08:00:00', stability: 1, difficulty: 1, elapsed_days: 0, scheduled_days: 0,
  learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: '', suspended: false, ...over
})
const log = (ts: string): ReviewLogEntry => ({ ts, highlightId: 'h', bookId: 'b1', rating: 'good', promptType: 'cloze', durationMs: 1, retrievabilityBefore: 0, wasNew: false })

it('builds forecast, streak, minutes, trend and per-book counts', () => {
  const s = buildStats({
    now,
    cards: {
      a: card({ due: '2026-10-18T08:00:00' }),
      b: card({ due: '2026-10-20T20:00:00' }),
      c: card({ due: '2026-10-22T08:00:00', bookId: 'b2' }),
      d: card({ state: 0, reps: 0 }),
      e: card({ suspended: true })
    },
    reviewLog: [log('2026-10-18T10:00:00'), log('2026-10-19T10:00:00'), log('2026-10-20T10:00:00')],
    sessions: [
      { start: '2026-10-20T09:00:00', end: '', kind: 'reading', bookId: 'b1', minutes: 30, pomodoro: true },
      { start: '2026-10-19T09:00:00', end: '', kind: 'review', bookId: null, minutes: 10, pomodoro: false },
      { start: '2026-10-19T09:30:00', end: '', kind: 'break', bookId: null, minutes: 5, pomodoro: true }
    ],
    snapshots: [{ date: '2026-10-19', K: 1, cumulativeMinutes: 10 }],
    books: [{ id: 'b1', title: 'Book One' }, { id: 'b2', title: 'Book Two' }],
    retrievability: () => 0.9,
    dueToday: 3
  })
  expect(s.K).toBe(2.7)
  expect(s.dueToday).toBe(3)
  expect(s.forecast).toHaveLength(14)
  expect(s.forecast[0]).toEqual({ date: '2026-10-20', count: 2 })
  expect(s.forecast[2]).toEqual({ date: '2026-10-22', count: 1 })
  expect(s.streakDays).toBe(3)
  expect(s.minutesByDay).toHaveLength(30)
  expect(s.minutesByDay.at(-1)).toEqual({ date: '2026-10-20', minutes: 30 })
  expect(s.minutesByDay.at(-2)).toEqual({ date: '2026-10-19', minutes: 10 })
  expect(s.kTrend).toEqual([{ date: '2026-10-19', K: 1 }, { date: '2026-10-20', K: 2.7 }])
  expect(s.knowledgePerHour).toBe(3.4) // (2.7 - 1) / ((40 - 10) / 60)
  expect(s.perBook).toEqual([
    { bookId: 'b1', title: 'Book One', cards: 3 },
    { bookId: 'b2', title: 'Book Two', cards: 1 }
  ])
})

it('streak counts from yesterday when nothing reviewed today, and is 0 after a gap', () => {
  const base = { now, cards: {}, sessions: [], snapshots: [], books: [], retrievability: () => 0, dueToday: 0 }
  expect(buildStats({ ...base, reviewLog: [log('2026-10-18T10:00:00'), log('2026-10-19T10:00:00')] }).streakDays).toBe(2)
  expect(buildStats({ ...base, reviewLog: [log('2026-10-17T10:00:00')] }).streakDays).toBe(0)
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/metrics.test.ts tests/unit/stats.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `sessions.ts` and `metrics.ts`**

`src/main/metrics/sessions.ts`:
```ts
import { join } from 'node:path'
import type { SessionEntry } from '../../shared/types'
import { appendJsonl, readJsonl } from '../store/jsonl'

export class SessionLog {
  private path: string

  constructor(dataDir: string) {
    this.path = join(dataDir, 'sessions.jsonl')
  }

  async append(e: Omit<SessionEntry, 'minutes'>): Promise<SessionEntry | null> {
    const start = new Date(e.start).getTime()
    const end = new Date(e.end).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Invalid session range')
    const minutes = Math.round((end - start) / 600) / 100
    if (minutes < 0.1) return null
    const entry: SessionEntry = { ...e, minutes }
    await appendJsonl(this.path, entry)
    return entry
  }

  async all(): Promise<SessionEntry[]> {
    return (await readJsonl<SessionEntry>(this.path)).items
  }
}
```
(`'Invalid session range'` matches the test's `toThrow('Invalid session')` substring.)

`src/main/metrics/metrics.ts`:
```ts
import { join } from 'node:path'
import type { CardState, MetricSnapshot, SessionEntry } from '../../shared/types'
import { addDays, localDay } from '../../shared/dates'
import { appendJsonl, readJsonl } from '../store/jsonl'

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places

export function computeK(cards: CardState[], now: Date, retr: (c: CardState, now: Date) => number): number {
  let k = 0
  for (const c of cards) if (!c.suspended && c.reps > 0) k += retr(c, now)
  return round(k, 3)
}

export function cumulativeMinutes(sessions: SessionEntry[]): number {
  return round(sessions.filter(s => s.kind !== 'break').reduce((a, s) => a + s.minutes, 0), 2)
}

export function knowledgePerHour(
  snapshots: MetricSnapshot[],
  current: { K: number; cumulativeMinutes: number },
  now: Date
): number | null {
  if (snapshots.length === 0) return null
  const cutoff = localDay(addDays(now, -30))
  const older = snapshots.filter(s => s.date <= cutoff)
  const base = older.length ? older[older.length - 1] : snapshots[0]
  const hours = (current.cumulativeMinutes - base.cumulativeMinutes) / 60
  if (hours < 0.25) return null
  return round((current.K - base.K) / hours, 2)
}

export class MetricsLog {
  private path: string

  constructor(dataDir: string) {
    this.path = join(dataDir, 'metrics.jsonl')
  }

  async all(): Promise<MetricSnapshot[]> {
    return (await readJsonl<MetricSnapshot>(this.path)).items
  }

  async ensureToday(now: Date, K: number, cumulativeMinutes: number): Promise<void> {
    const today = localDay(now)
    const all = await this.all()
    if (all.length && all[all.length - 1].date === today) return
    await appendJsonl(this.path, { date: today, K, cumulativeMinutes })
  }
}
```

- [ ] **Step 4: Implement `stats.ts`**

```ts
import { join } from 'node:path'
import type { CardState, MetricSnapshot, ReviewLogEntry, SessionEntry, Stats } from '../../shared/types'
import { addDays, localDay } from '../../shared/dates'
import { readJsonl } from '../store/jsonl'
import { computeK, cumulativeMinutes, knowledgePerHour, MetricsLog } from './metrics'
import type { SessionLog } from './sessions'

export interface StatsInput {
  now: Date
  cards: Record<string, CardState>
  reviewLog: ReviewLogEntry[]
  sessions: SessionEntry[]
  snapshots: MetricSnapshot[]
  books: Array<{ id: string; title: string }>
  retrievability: (c: CardState, now: Date) => number
  dueToday: number
}

export function buildStats(input: StatsInput): Stats {
  const { now } = input
  const today = localDay(now)
  const cards = Object.values(input.cards)
  const K = computeK(cards, now, input.retrievability)
  const minutes = cumulativeMinutes(input.sessions)

  const forecast = Array.from({ length: 14 }, (_, i) => ({ date: localDay(addDays(now, i)), count: 0 }))
  for (const c of cards) {
    if (c.suspended || c.state === 0) continue
    const d = localDay(new Date(c.due))
    const slot = d <= today ? forecast[0] : forecast.find(f => f.date === d)
    if (slot) slot.count++
  }

  const reviewDays = new Set(input.reviewLog.map(e => localDay(new Date(e.ts))))
  let streakDays = 0
  let cursor = reviewDays.has(today) ? now : addDays(now, -1)
  while (reviewDays.has(localDay(cursor))) {
    streakDays++
    cursor = addDays(cursor, -1)
  }

  const minutesByDay = Array.from({ length: 30 }, (_, i) => ({ date: localDay(addDays(now, i - 29)), minutes: 0 }))
  for (const s of input.sessions) {
    if (s.kind === 'break') continue
    const slot = minutesByDay.find(m => m.date === localDay(new Date(s.start)))
    if (slot) slot.minutes = Math.round((slot.minutes + s.minutes) * 100) / 100
  }

  const kTrend = input.snapshots.filter(s => s.date !== today).slice(-59).map(s => ({ date: s.date, K: s.K }))
  kTrend.push({ date: today, K })

  const counts = new Map<string, number>()
  for (const c of cards) if (!c.suspended) counts.set(c.bookId, (counts.get(c.bookId) ?? 0) + 1)
  const titles = new Map(input.books.map(b => [b.id, b.title]))
  const perBook = [...counts.entries()]
    .map(([bookId, n]) => ({ bookId, title: titles.get(bookId) ?? 'Unknown book', cards: n }))
    .sort((a, b) => b.cards - a.cards)

  return {
    K,
    knowledgePerHour: knowledgePerHour(input.snapshots, { K, cumulativeMinutes: minutes }, now),
    dueToday: input.dueToday,
    streakDays,
    forecast,
    minutesByDay,
    kTrend,
    perBook
  }
}

export interface StatsDeps {
  dataDir: string
  getCards: () => Promise<Record<string, CardState>>
  dueCount: () => Promise<number>
  books: () => Promise<Array<{ id: string; title: string }>>
  sessions: SessionLog
  retrievability: (c: CardState, now: Date) => number
  now?: () => Date
}

export class StatsService {
  private metrics: MetricsLog

  constructor(private deps: StatsDeps) {
    this.metrics = new MetricsLog(deps.dataDir)
  }

  async get(): Promise<Stats> {
    const now = (this.deps.now ?? (() => new Date()))()
    const [cards, sessions, reviewLog, books, dueToday] = await Promise.all([
      this.deps.getCards(),
      this.deps.sessions.all(),
      readJsonl<ReviewLogEntry>(join(this.deps.dataDir, 'review-log.jsonl')).then(r => r.items),
      this.deps.books(),
      this.deps.dueCount()
    ])
    const K = computeK(Object.values(cards), now, this.deps.retrievability)
    await this.metrics.ensureToday(now, K, cumulativeMinutes(sessions))
    const snapshots = await this.metrics.all()
    return buildStats({ now, cards, reviewLog, sessions, snapshots, books, retrievability: this.deps.retrievability, dueToday })
  }
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/metrics.test.ts tests/unit/stats.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/metrics tests/unit/metrics.test.ts tests/unit/stats.test.ts
git commit -m "feat(main): session log, daily K snapshots, knowledge-per-hour and stats"
```

---
### Task 6: Workspace setup and coach skills (sonnet, wave 1)

**Files:**
- Create: `src/main/setup/workspaceSetup.ts`
- Create: `resources/workspace-template/root/CLAUDE.md`, `resources/workspace-template/root/AGENTS.md`, `resources/workspace-template/root/GEMINI.md`
- Create: `resources/workspace-template/knowledge/index.md`, `resources/workspace-template/knowledge/prompts.jsonl` (empty), `resources/workspace-template/knowledge/coach-log.jsonl` (empty), `resources/workspace-template/knowledge/concepts/README.md`, `resources/workspace-template/knowledge/books/README.md`
- Create: `resources/workspace-template/skills/{learning-coach,distill,preview,recall,drill,ask,weekly}/SKILL.md`, `resources/workspace-template/skills/learning-coach/methodology.md` (exact copy of `docs/methodology.md`)
- Test: `tests/unit/workspaceSetup.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic`, `readJson`, `writeJson` (main/store).
- Produces: `setupWorkspace(root: string, templateDir: string): Promise<SetupResult>`, `interface SetupResult { created: string[]; updated: string[]; skipped: string[] }`. Template mapping: `root/*` → library root; `knowledge/**` → `knowledge/**` (create-only); `skills/<name>/**` → both `.claude/skills/<name>/**` and `.agents/skills/<name>/**` (managed). Manifest: `.smartreader/template-manifest.json` = `{ "version": 1, "files": { "<dest rel path>": "<sha256 of content last written>" } }`.

**Update rules (managed files):** if the destination is missing, write it (created). If it exists and its hash equals the manifest hash (so the user hasn't edited it) and the template differs, overwrite it (updated). If it exists and equals the template, record it (skipped). Otherwise the user edited it, so leave it alone (skipped). **Create-only files** (`knowledge/**`) are written only when missing.

- [ ] **Step 1: Write the failing tests**

`tests/unit/workspaceSetup.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setupWorkspace } from '../../src/main/setup/workspaceSetup'

const REAL_TEMPLATE = resolve(__dirname, '../../resources/workspace-template')
let root: string
let tpl: string

async function put(base: string, rel: string, content: string): Promise<void> {
  await mkdir(join(base, rel, '..'), { recursive: true })
  await writeFile(join(base, rel), content)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sr-ws-'))
  tpl = await mkdtemp(join(tmpdir(), 'sr-tpl-'))
  await put(tpl, 'root/CLAUDE.md', 'claude v1')
  await put(tpl, 'knowledge/index.md', 'index v1')
  await put(tpl, 'knowledge/prompts.jsonl', '')
  await put(tpl, 'skills/recall/SKILL.md', 'recall v1')
})

describe('setupWorkspace', () => {
  it('creates root files, knowledge files and skills in both agent dirs', async () => {
    const r = await setupWorkspace(root, tpl)
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('claude v1')
    expect(await readFile(join(root, 'knowledge/index.md'), 'utf8')).toBe('index v1')
    expect(existsSync(join(root, 'knowledge/prompts.jsonl'))).toBe(true)
    expect(await readFile(join(root, '.claude/skills/recall/SKILL.md'), 'utf8')).toBe('recall v1')
    expect(await readFile(join(root, '.agents/skills/recall/SKILL.md'), 'utf8')).toBe('recall v1')
    expect(r.created.sort()).toEqual(['.agents/skills/recall/SKILL.md', '.claude/skills/recall/SKILL.md', 'CLAUDE.md', 'knowledge/index.md', 'knowledge/prompts.jsonl'])
    expect(existsSync(join(root, '.smartreader/template-manifest.json'))).toBe(true)
  })

  it('is idempotent', async () => {
    await setupWorkspace(root, tpl)
    const r = await setupWorkspace(root, tpl)
    expect(r.created).toEqual([])
    expect(r.updated).toEqual([])
  })

  it('updates unedited managed files when the template changes', async () => {
    await setupWorkspace(root, tpl)
    await put(tpl, 'skills/recall/SKILL.md', 'recall v2')
    await put(tpl, 'root/CLAUDE.md', 'claude v2')
    const r = await setupWorkspace(root, tpl)
    expect(await readFile(join(root, '.claude/skills/recall/SKILL.md'), 'utf8')).toBe('recall v2')
    expect(r.updated).toContain('CLAUDE.md')
  })

  it('never clobbers user-edited managed files or any knowledge file', async () => {
    await setupWorkspace(root, tpl)
    await writeFile(join(root, 'CLAUDE.md'), 'my own notes')
    await writeFile(join(root, 'knowledge/index.md'), 'agent wrote this')
    await put(tpl, 'root/CLAUDE.md', 'claude v2')
    await put(tpl, 'knowledge/index.md', 'index v2')
    await setupWorkspace(root, tpl)
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('my own notes')
    expect(await readFile(join(root, 'knowledge/index.md'), 'utf8')).toBe('agent wrote this')
  })

  it('does not overwrite pre-existing files that were never written by the app', async () => {
    await put(root, 'CLAUDE.md', 'pre-existing user file')
    await setupWorkspace(root, tpl)
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('pre-existing user file')
  })

  it('creates empty concepts/ and books/ dirs from the real template', async () => {
    await setupWorkspace(root, REAL_TEMPLATE)
    expect(existsSync(join(root, 'knowledge/concepts'))).toBe(true)
    expect(existsSync(join(root, 'knowledge/books'))).toBe(true)
    for (const s of ['learning-coach', 'distill', 'preview', 'recall', 'drill', 'ask', 'weekly']) {
      expect(existsSync(join(root, `.claude/skills/${s}/SKILL.md`))).toBe(true)
    }
  })
})

describe('real template content', () => {
  it('bundled methodology matches docs/methodology.md', async () => {
    const a = await readFile(resolve(__dirname, '../../docs/methodology.md'), 'utf8')
    const b = await readFile(join(REAL_TEMPLATE, 'skills/learning-coach/methodology.md'), 'utf8')
    expect(b).toBe(a)
  })

  it('every SKILL.md has name + description frontmatter matching its folder', async () => {
    for (const s of ['learning-coach', 'distill', 'preview', 'recall', 'drill', 'ask', 'weekly']) {
      const md = await readFile(join(REAL_TEMPLATE, `skills/${s}/SKILL.md`), 'utf8')
      expect(md).toMatch(new RegExp(`^---\\nname: ${s}\\ndescription: .{20,}\\n`))
    }
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/workspaceSetup.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `workspaceSetup.ts`**

```ts
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { readJson, writeFileAtomic, writeJson } from '../store/atomic'

export interface SetupResult { created: string[]; updated: string[]; skipped: string[] }
interface Manifest { version: 1; files: Record<string, string> }

const sha = (s: Buffer | string): string => createHash('sha256').update(s).digest('hex')

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string): Promise<void> {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = join(d, e.name)
      if (e.isDirectory()) await walk(abs)
      else if (e.isFile()) out.push(relative(dir, abs).split(sep).join('/'))
    }
  }
  await walk(dir)
  return out.sort()
}

async function readMaybe(p: string): Promise<Buffer | null> {
  try {
    return await readFile(p)
  } catch {
    return null
  }
}

export async function setupWorkspace(root: string, templateDir: string): Promise<SetupResult> {
  const result: SetupResult = { created: [], updated: [], skipped: [] }
  const manifestPath = join(root, '.smartreader', 'template-manifest.json')
  const manifest = await readJson<Manifest>(manifestPath, () => ({ version: 1, files: {} }))

  const plan: Array<{ src: string; dest: string; createOnly: boolean }> = []
  for (const rel of await listFiles(templateDir)) {
    const [top, ...rest] = rel.split('/')
    const tail = rest.join('/')
    if (top === 'root') plan.push({ src: rel, dest: tail, createOnly: false })
    else if (top === 'knowledge') plan.push({ src: rel, dest: `knowledge/${tail}`, createOnly: true })
    else if (top === 'skills') {
      plan.push({ src: rel, dest: `.claude/skills/${tail}`, createOnly: false })
      plan.push({ src: rel, dest: `.agents/skills/${tail}`, createOnly: false })
    }
  }

  for (const { src, dest, createOnly } of plan) {
    const template = await readFile(join(templateDir, src))
    const tHash = sha(template)
    const destAbs = join(root, dest)
    const current = await readMaybe(destAbs)
    if (current === null) {
      await writeFileAtomic(destAbs, template)
      if (!createOnly) manifest.files[dest] = tHash
      result.created.push(dest)
      continue
    }
    if (createOnly) {
      result.skipped.push(dest)
      continue
    }
    const cHash = sha(current)
    if (cHash === tHash) {
      manifest.files[dest] = tHash
      result.skipped.push(dest)
    } else if (manifest.files[dest] === cHash) {
      await writeFileAtomic(destAbs, template)
      manifest.files[dest] = tHash
      result.updated.push(dest)
    } else {
      result.skipped.push(dest) // edited by the user: never clobber
    }
  }

  await mkdir(join(root, 'knowledge', 'concepts'), { recursive: true })
  await mkdir(join(root, 'knowledge', 'books'), { recursive: true })
  await writeJson(manifestPath, manifest)
  return result
}
```
Note: `writeFileAtomic` accepts `Uint8Array`, and `Buffer` is a `Uint8Array`.

- [ ] **Step 4: Write the template files**

`resources/workspace-template/root/CLAUDE.md`:
````markdown
# Smart Reader library

This folder is a **Smart Reader** library: the user's non-fiction ebooks, their highlights, and a knowledge base you maintain. The user reads in the Smart Reader app; you are the **optional learning coach** in its side terminal. The user's goal is to maximize *retrievable knowledge per hour*: what they highlighted is what matters most.

**In every coaching interaction, follow `.claude/skills/learning-coach/SKILL.md`.** Its rules come from `.claude/skills/learning-coach/methodology.md`.

## Start of every session

1. Read `knowledge/index.md`.
2. If the user has not said what they want, offer (one line each): **distill** new highlights · **preview** a chapter · **recall** session · **drill** weak spots · **ask** what I know about X · **weekly** review.

## Files

| Path | Writer | Contents |
|---|---|---|
| `.smartreader/library.json` | app — read only for you | books: `id`, `slug`, `title`, `author`, `path`, `progress` |
| `.smartreader/books/<slug>/highlights.md` | app — read only | readable highlights with ids, grouped by chapter |
| `.smartreader/books/<slug>/highlights.json` | app — read only | full records: `id`, `quote.exact`, `context`, `chapter`, `note`, `createdAt`, `deleted` |
| `.smartreader/review-state.json` | app — read only | FSRS state per highlight id (`state` 0 new/1 learning/2 review/3 relearning, `lapses`, `due`) |
| `.smartreader/review-log.jsonl` | app — read only | every flashcard review: `highlightId`, `rating` (again/hard/good/easy), `ts` |
| `.smartreader/sessions.jsonl` | app — read only | reading/review minutes |
| `knowledge/index.md` | you | entry point: books, core concepts, weak spots, recent sessions |
| `knowledge/concepts/<concept-slug>.md` | you | one concept per file (format in the distill skill) |
| `knowledge/books/<book-slug>.md` | you | one page per book: thesis, key concepts, links |
| `knowledge/prompts.jsonl` | you (append only) | better review questions for highlights |
| `knowledge/coach-log.jsonl` | you (append only) | results of coached recall attempts |

**Never modify `.smartreader/` or any ebook file.** Never delete or rewrite existing lines in `.jsonl` files; only append.

## Skills

- **distill**: turn new highlights into concept notes, cross-book links and better review questions.
- **preview**: before a chapter: set purpose, ask prediction questions, check prerequisites.
- **recall**: closed-book recall on a chapter or recent highlights, with feedback and scoring.
- **drill**: practice weak spots (failed cards, low scores) with varied and interleaved questions.
- **ask**: answer "what do I know about X?" across all books, separating read vs. demonstrated.
- **weekly**: weekly synthesis, cue-free tests of older concepts, review-load check.
- **learning-coach**: the rules every other skill follows.

## Adding a review question for a highlight

Append one line to `knowledge/prompts.jsonl`:
```json
{"highlightId":"h_…","question":"Why does …?","answer":"short model answer","createdAt":"2026-10-20T10:00:00Z","by":"distill"}
```
The app shows the latest question for that highlight instead of the fill-in-the-blank card, usually within a second.
````

`resources/workspace-template/root/AGENTS.md`: same content as CLAUDE.md, with every `.claude/skills/` replaced by `.agents/skills/`, and the first bold line changed to: **"In every coaching interaction, read and follow `.agents/skills/learning-coach/SKILL.md`. When the user names a skill (distill, preview, recall, drill, ask, weekly), read `.agents/skills/<name>/SKILL.md` and follow it."**

`resources/workspace-template/root/GEMINI.md`: identical to AGENTS.md.

`resources/workspace-template/knowledge/index.md`:
```markdown
# Knowledge index

<!-- Maintained by the coach skills. Agents: read this first in every session. -->

## Books
_None distilled yet. Run the **distill** skill after reading._

## Core concepts
_None yet._

## Weak spots
_None yet. Filled by **drill**, **recall** and **weekly**._

## Recent sessions
_None yet._
```

`resources/workspace-template/knowledge/concepts/README.md`:
```markdown
One file per concept, named `<concept-slug>.md`. Format: see the distill skill.
```

`resources/workspace-template/knowledge/books/README.md`:
```markdown
One file per book, named `<book-slug>.md` (same slug as `.smartreader/books/<slug>/`). Format: see the distill skill.
```

`resources/workspace-template/knowledge/prompts.jsonl` and `coach-log.jsonl`: empty files.

`resources/workspace-template/skills/learning-coach/methodology.md`: `cp docs/methodology.md resources/workspace-template/skills/learning-coach/methodology.md`.

`resources/workspace-template/skills/learning-coach/SKILL.md`:
```markdown
---
name: learning-coach
description: Core rules for coaching the user's learning from their ebook highlights. Use for any coaching, quizzing, explaining or knowledge-base work in this Smart Reader library; every other coach skill follows these rules.
---

# Learning coach rules

You coach one adult learner reading non-fiction. Goal: **maximize durable, retrievable knowledge per hour**. Their **highlights are what they decided matters**; anchor everything to them. Full evidence base: `methodology.md` next to this file. Read it once per session if you have not.

## Non-negotiables
1. **Stored is not known.** A note in `knowledge/` or a highlight is *exposure*. Only an unaided, correct answer you observed counts as recall.
2. **Ask before you tell.** Pose the question first. Never lead with a summary. Teach directly only when the learner is truly stuck or lacks a prerequisite, then test again later.
3. **Attempt before answer.** Get a real attempt before revealing the model answer, unless the learner explicitly gives up.
4. **Feedback order:** (1) what was right → (2) what was missing or wrong, specifically → (3) what the source says (quote the highlight or cite its id) → (4) why the difference matters → (5) ask for a short repair attempt (skip for trivial slips).
5. **Hint ladder:** neutral nudge → conceptual hint → short source excerpt → full explanation. Record which level was used.
6. **Never praise an inaccurate answer as correct.** Never punish "I don't know". If the source is ambiguous or you are unsure, say so.
7. **Grounding.** Claims about a book must cite highlight ids or quotes. Label your own inferences "AI suggestion — unverified".
8. **Few, high-value questions.** 2–5 per unit. Prefer why/how, discrimination, counterexample and transfer over trivia. Free response before multiple choice.
9. **Respect attention (ADHD-friendly).** Short turns, one question at a time, no walls of text. Offer to stop at natural breaks. Never quiz mid-reading unless asked.
10. **Technical vs. general non-fiction.** Technical: mechanisms, assumptions, derivations, what-if-a-parameter-changes. General: thesis, evidence quality, causal model, objections, application to a real decision.

## Rubric (record per attempt; never merge into one score)
- accuracy 0–3: incorrect / materially incomplete / mostly correct / fully correct
- depth 0–3: labels only / description / mechanism / nuanced mechanism
- transfer 0–3 (only if a novel scenario was posed): unable / heavy help / small gaps / independent
- independence: `unaided` | `minor-hint` | `substantial-hint` | `answer-exposed`
- confidence 1–5: the learner's own estimate, asked **before** feedback

## Coach log
After every scored attempt, append one line to `knowledge/coach-log.jsonl`:
`{"ts":"<ISO>","skill":"recall","concept":"<concept-slug>","highlightIds":["h_…"],"question":"…","accuracy":2,"depth":2,"transfer":null,"independence":"unaided","confidence":3,"notes":"missed the boundary condition"}`

## Concept status (frontmatter `status` in `knowledge/concepts/*.md`)
- `exposed`: a note exists.
- `understood`: you observed a correct explanation (hints allowed).
- `recalled`: unaided accuracy ≥2 at least 1 day after the concept was first studied.
- `transfer`: unaided transfer ≥2 on a novel scenario.
Move status **only** on observed evidence in the coach log. Move it **down** after a failed unaided attempt.

## Data rules
Read the app's files in `.smartreader/` but never write them. Append to `.jsonl` files and never rewrite them. Keep `knowledge/index.md` current: it is the next session's memory.
```

`resources/workspace-template/skills/distill/SKILL.md`:
````markdown
---
name: distill
description: Turn the user's new ebook highlights into concept notes, a book page, cross-book links and better review questions in knowledge/. Use after a reading session or when the user says "distill", "process my highlights" or "update my knowledge graph".
---

# Distill highlights into the knowledge graph

Follow `../learning-coach/SKILL.md`.

## 1. Find what is new
- Read `.smartreader/library.json` for titles and slugs.
- Find the newest `createdAt` among lines in `knowledge/prompts.jsonl` with `"by":"distill"` (none → everything is new).
- For each book, read `.smartreader/books/<slug>/highlights.json` and keep highlights with `deleted: false` and `createdAt` after that time. If there are none, say so and stop.
- Tell the user: "N new highlights in M books. Distilling." Then ask **one** question: "Anything you want me to focus on, or is your purpose for any of these books Explore / Understand / Master?" Do not wait more than one turn; default to Understand.

## 2. Group into concepts
- Cluster highlights by idea, not by chapter. One concept = one claim, mechanism, distinction or procedure the learner would want to retrieve.
- Before creating a concept, search existing notes: `grep -ril "<key term>" knowledge/concepts`. Reuse or extend existing notes instead of duplicating.
- Concept slug: lowercase kebab, ≤5 words (`loss-aversion`, `deliberate-practice`).

## 3. Write or update `knowledge/concepts/<concept-slug>.md`
```markdown
---
concept: Loss aversion
status: exposed
sources:
  - book: thinking-fast-and-slow-a1b2c3
    highlights: [h_…, h_…]
related: ["[[prospect-theory]]", "[[endowment-effect]]"]
updated: 2026-10-20
---
## In my words
_Empty until the learner explains it in a recall session; never fill this yourself._

## What the sources say
- Losses loom larger than equivalent gains (h_…).

## Connections
- [[endowment-effect]]: authors-agree (Kahneman cites it as a consequence, h_…)
- [[sunk-cost]]: ai-suggested-analogy (unverified)

## Open questions
- Does the effect size hold outside lab gambles?
```
Rules: every claim under "What the sources say" cites a highlight id. Each connection is tagged `authors-agree` (a source actually makes the link) or `ai-suggested-analogy`. Never raise `status` here; new notes are `exposed`.

## 4. Write or update `knowledge/books/<book-slug>.md`
Frontmatter `title`, `author`, `slug`, `purpose` (explore/understand/master), `updated`. Sections: **Thesis (one sentence, cite highlights)**, **Key concepts** (`[[links]]`), **Highlights not yet distilled** (ids, if any were skipped as low value).

## 5. Write better review questions
For the **most valuable** highlights only (about 1 in 2 or fewer; skip anecdotes and trivia), append to `knowledge/prompts.jsonl`:
`{"highlightId":"h_…","question":"…","answer":"…","createdAt":"<now ISO>","by":"distill"}`
Question quality: answerable without seeing the passage; does not leak the answer; asks why/how/when/compare rather than "what is"; one target per question; the answer is 1–3 sentences grounded in the highlight. Technical books: mechanism or what-if. General non-fiction: claim + reason, or application.

## 6. Update `knowledge/index.md`
Add or refresh the book under **Books** (link `[[books/<slug>]]`), add new top concepts under **Core concepts**, and add a dated line under **Recent sessions**: `2026-10-20 · distill · 12 highlights → 5 concepts, 6 questions`.

## 7. Report and offer next step
Three lines maximum: what changed, one interesting cross-book connection (tagged), and the offer: "Want a 5-minute recall on these now?"
````

`resources/workspace-template/skills/preview/SKILL.md`:
```markdown
---
name: preview
description: Prime the user before reading a chapter or book — set purpose, ask prediction questions, check prerequisites against what they already know. Use when the user says "preview", "about to read", or names a chapter they are starting.
---

# Preview before reading

Follow `../learning-coach/SKILL.md`. Keep the whole preview under 3 minutes.

1. **Identify the unit.** Ask which book and chapter if unclear. Get headings by asking the user to paste the table of contents or chapter headings (you cannot open the ebook file), or use `knowledge/books/<slug>.md` if it already lists them.
2. **Purpose.** Ask: "Explore, Understand or Master for this chapter?" and "What question do you want this chapter to answer?"
3. **Activate prior knowledge.** Search `knowledge/concepts/` for related concepts. If any exist, ask one quick cue-free question about the most relevant one. That is also free retrieval practice; log it per the coach rules.
4. **Predict.** From the headings only, ask 1–3 prediction questions ("Based on the title X, what do you expect the author to argue about Y?"). Do **not** answer them, and don't summarize the chapter.
5. **Prerequisites.** If headings imply a concept the learner has no note on and it seems foundational, name it and offer a 2-sentence primer only if they want it.
6. **Send them to read.** End with: their purpose question, the 1–3 predictions to check while reading, and "Highlight what answers these. Run **recall** when you finish."
7. Record the purpose in `knowledge/books/<slug>.md` frontmatter (`purpose`) and a dated note under a `## Reading log` section.
```

`resources/workspace-template/skills/recall/SKILL.md`:
```markdown
---
name: recall
description: Run a closed-book recall session on a chapter the user just read or on recent highlights, with hint ladder, source-grounded feedback, rubric scoring and coach-log entries. Use when the user says "recall", "quiz me", "test me", or finishes a chapter.
---

# Closed-book recall session

Follow `../learning-coach/SKILL.md` strictly. The book stays closed: ask the user not to look.

## Select material
- Default: highlights created today, or since the last `recall` entry in `knowledge/coach-log.jsonl`, for the book they name.
- Read them from `.smartreader/books/<slug>/highlights.json` and the related concept notes. **Do not show them to the user.**

## Sequence (one question per turn)
1. **Free recall.** "Without looking, what were the main ideas you highlighted in <chapter>?" Wait. Ask for confidence 1–5.
2. **Compare.** List what they got, then what they missed, citing highlight ids and short quotes. Don't recite everything; focus on the 2–3 most important gaps.
3. **2–4 targeted questions** on the gaps and the most valuable highlights, mixing cued recall, causal "why/how", discrimination ("how is X different from Y?") and limitation ("when would this fail?"). Each one: ask for confidence → attempt → hint ladder if stuck → feedback in the 5-step order → short repair attempt for important errors.
4. **Score** each attempt with the rubric and append to `knowledge/coach-log.jsonl` (one line per attempt, `"skill":"recall"`).
5. **Update concepts.** For each concept touched: write the learner's best explanation into "In my words" (their words, lightly cleaned) and update `status` per the rules. A first-day session can reach `understood` but not `recalled`.
6. **Better cards.** If a highlight's flashcard should test what they struggled with, append an improved question to `knowledge/prompts.jsonl` with `"by":"recall"`.
7. **Close.** Two lines: what is solid, what to revisit. Add a **Recent sessions** line to `knowledge/index.md`, and list persistent errors under **Weak spots**.

Stop early if the learner signals fatigue. Five good minutes beats twenty tired ones.
```

`resources/workspace-template/skills/drill/SKILL.md`:
```markdown
---
name: drill
description: Practice the user's weakest material — flashcards they keep failing and concepts with low coach scores — using fresh, varied and interleaved questions. Use when the user says "drill", "practice weak spots", or "what am I bad at".
---

# Drill weak spots

Follow `../learning-coach/SKILL.md`.

1. **Find weak items** (cap at 5 for one drill):
   - `.smartreader/review-log.jsonl`: highlights with ≥2 `again` ratings in their last 5 reviews.
   - `.smartreader/review-state.json`: cards with `lapses` ≥2.
   - `knowledge/coach-log.jsonl`: concepts whose latest unaided accuracy is ≤1, or with independence `substantial-hint`/`answer-exposed`.
   - `knowledge/index.md` **Weak spots**.
   Prefer foundational, high-value items. Skip low-value trivia even if failed; suggest retiring it instead.
2. **Diagnose before drilling.** For a persistently failed item, check whether a prerequisite concept is missing. If so, fix the prerequisite first.
3. **Vary the prompt.** Never repeat the exact flashcard wording. Rotate: explain the mechanism, give an example, give a counterexample, compare with a neighbor concept, apply to a new scenario.
4. **Interleave** only related concepts the learner has basic familiarity with (e.g. two competing explanations of the same effect). The goal is choosing which principle applies and why.
5. Each attempt: confidence → attempt → hints → feedback → repair. Log each to `knowledge/coach-log.jsonl` (`"skill":"drill"`).
6. If a new phrasing worked better than the old card, append it to `knowledge/prompts.jsonl` (`"by":"drill"`).
7. Update **Weak spots** in `knowledge/index.md`: remove items now answered unaided with accuracy ≥2, keep the rest.
```

`resources/workspace-template/skills/ask/SKILL.md`:
```markdown
---
name: ask
description: Answer the user's questions about what they have read and learned across all their books ("what do I know about X", "where did I read about Y", "how do these books relate"), citing highlights and separating what was read from what was demonstrated. Read-only.
---

# Ask the knowledge base

Follow `../learning-coach/SKILL.md`. This skill is **read-only**. Do not write files unless the user asks you to save something (then use distill conventions).

1. **Search broadly, fast.** `grep -ril "<terms and synonyms>" knowledge/ .smartreader/books/*/highlights.md`. Follow `[[links]]` one hop from the matching concepts.
2. **Answer in layers**, short:
   - **You've demonstrated:** concepts with status `recalled`/`transfer` (cite the coach-log date).
   - **You've read and highlighted:** relevant highlights with book title and id (quote ≤1 line each).
   - **Connections:** links between books, each tagged `authors-agree` or `ai-suggested-analogy`.
   - **Gaps:** what the sources don't cover or where the learner's notes are uncertain.
3. Never present an AI inference as something the learner's books say.
4. If the question is a good test of understanding, offer: "Want to try answering it yourself first?" Ask before you tell.
5. If nothing relevant exists, say so plainly and suggest which book in the library might cover it (from titles in `.smartreader/library.json`).
```

`resources/workspace-template/skills/weekly/SKILL.md`:
```markdown
---
name: weekly
description: Weekly learning review — synthesize ideas across the week's reading, test older high-value concepts without cues, check whether the review load is sustainable, and refresh the knowledge index. Use when the user says "weekly", "weekly review", or at the start of a new week.
---

# Weekly review (10–20 minutes)

Follow `../learning-coach/SKILL.md`.

1. **Gather the week** (last 7 days): reading minutes per book from `.smartreader/sessions.jsonl`; new highlights; review counts and `again` rate from `.smartreader/review-log.jsonl`; coach-log entries.
2. **Show a 4-line snapshot:** minutes read, highlights added, reviews done (with the share of `again` ratings), concepts that moved status.
3. **Cross-book synthesis (1 question).** Pick two concepts from different books that plausibly interact. Ask the learner how they relate *before* offering your view. Tag the result `authors-agree` or `ai-suggested-analogy`.
4. **Cue-free test of older material (2–3 questions).** Pick high-value concepts last studied 2+ weeks ago. Ask without naming the book or showing a highlight. Score and log (`"skill":"weekly"`).
5. **Application (1 question).** "Where could you use <concept> this week?" Record the answer in the concept note under `## Applications`.
6. **Review load check.** If due cards per day (from `.smartreader/review-state.json` `due` dates) is above ~40, or the `again` rate is above 30%, suggest which low-value highlights to delete in the app (deleting suspends their cards). List ids and titles. Never edit app files yourself.
7. **Refresh `knowledge/index.md`:** Books, Core concepts (top 10 by value), Weak spots, and a dated Recent sessions line.
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/workspaceSetup.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/setup resources/workspace-template tests/unit/workspaceSetup.test.ts
git commit -m "feat: workspace setup with no-clobber templates and coach skills"
```

---
### Task 7: Main-process wiring: workspace, IPC, PTY, menu (sonnet, wave 2)

**Files:**
- Create: `src/main/workspace.ts`, `src/main/ipc.ts`, `src/main/pty/ptyService.ts`, `src/main/menu.ts`
- Modify: `src/main/index.ts` (add `bootstrap()`, which wires settings, IPC, menu, PTY and recovery toasts)
- Test: `tests/unit/workspace.test.ts`, `tests/e2e/ipc.spec.ts`

**Interfaces:**
- Consumes: `LibraryService`, `BookNotFoundError`, `SettingsStore` (T2); `HighlightStore` (T3); `ReviewService`, `PromptWatcher`, `retrievability` (T4); `SessionLog`, `StatsService` (T5); `setupWorkspace` (T6); `IPC`, `SmartReaderApi`, `MenuAction` (shared); `setRecoveryListener` (store).
- Produces:
  - `class WorkspaceError extends Error`
  - `class Workspace { static open(root: string, opts: WorkspaceOptions): Promise<Workspace>; readonly root: string; readonly library: LibraryService; readonly highlights: HighlightStore; readonly review: ReviewService; readonly sessions: SessionLog; readonly stats: StatsService; close(): void }`
  - `interface WorkspaceOptions { templateDir: string; newCardsPerDay: () => Promise<number>; onReviewChanged: () => void; now?: () => Date }`
  - `class PtyService { constructor(send: (channel: string, ...args: unknown[]) => void); create(cwd: string, cols: number, rows: number): string; write(id, data): void; resize(id, cols, rows): void; kill(id): void; killAll(): void }`
  - `registerIpc(ctx: IpcContext): { current(): Workspace | null; closeAll(): void }`
  - `buildMenu(send: (a: MenuAction) => void, recent: string[]): Menu`

- [ ] **Step 1: Write the failing workspace test**

`tests/unit/workspace.test.ts`:
```ts
import { it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Workspace } from '../../src/main/workspace'

const templateDir = resolve(__dirname, '../../resources/workspace-template')
let ws: Workspace | null = null
afterEach(() => { ws?.close(); ws = null })

const opts = { templateDir, newCardsPerDay: async () => 20, onReviewChanged: () => {} }

it('opens a folder end-to-end: setup, scan, highlight, review, stats', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sr-wsx-'))
  await writeFile(join(root, 'Some_Book.epub'), 'not really an epub')
  ws = await Workspace.open(root, opts)
  expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true)
  const [book] = await ws.library.list()
  expect(book.title).toBe('Some Book')
  const h = await ws.highlights.add(book.id, {
    location: 'epubcfi(/6/2)', quote: { exact: 'focus wins', prefix: '', suffix: '' },
    context: 'In the end focus wins every time.', chapter: 'One', position: 0.1, color: 'yellow', note: null
  })
  const q = await ws.review.queue()
  expect(q).toHaveLength(1)
  expect(q[0]).toMatchObject({ highlightId: h.id, bookTitle: 'Some Book', promptType: 'cloze' })
  await ws.review.rate(h.id, 'good', 3000, 'cloze')
  const stats = await ws.stats.get()
  expect(stats.K).toBeGreaterThan(0.9)
  expect(existsSync(join(root, '.smartreader/metrics.jsonl'))).toBe(true)
})

it('open rejects missing folder', async () => {
  await expect(Workspace.open('/definitely/not/here', opts)).rejects.toThrow('Folder not found')
})

it('open rejects an unwritable folder', async () => {
  if (process.getuid?.() === 0) return // root can write anywhere
  const root = await mkdtemp(join(tmpdir(), 'sr-ro-'))
  await chmod(root, 0o555)
  await expect(Workspace.open(root, opts)).rejects.toThrow('permission')
  await chmod(root, 0o755)
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/workspace.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `workspace.ts`** (no `electron` import, so it stays unit-testable)

```ts
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { LibraryService } from './library/libraryService'
import { HighlightStore } from './highlights/highlightStore'
import { PromptWatcher } from './review/prompts'
import { ReviewService } from './review/reviewService'
import { retrievability } from './review/scheduler'
import { SessionLog } from './metrics/sessions'
import { StatsService } from './metrics/stats'
import { setupWorkspace } from './setup/workspaceSetup'

export class WorkspaceError extends Error {}

export interface WorkspaceOptions {
  templateDir: string
  newCardsPerDay: () => Promise<number>
  onReviewChanged: () => void
  now?: () => Date
}

export class Workspace {
  private constructor(
    readonly root: string,
    readonly library: LibraryService,
    readonly highlights: HighlightStore,
    readonly review: ReviewService,
    readonly sessions: SessionLog,
    readonly stats: StatsService,
    private prompts: PromptWatcher
  ) {}

  static async open(root: string, opts: WorkspaceOptions): Promise<Workspace> {
    const now = opts.now ?? (() => new Date())
    const st = await stat(root).catch(() => null)
    if (!st?.isDirectory()) throw new WorkspaceError(`Folder not found: ${root}`)
    try {
      await access(root, constants.R_OK | constants.W_OK)
    } catch {
      throw new WorkspaceError(`No permission to write to ${root}`)
    }
    await setupWorkspace(root, opts.templateDir)
    const library = new LibraryService(root, now)
    await library.scan()
    const highlights = new HighlightStore(library.dataDir, async id => {
      const b = await library.get(id)
      return { bookId: id, slug: b.slug, title: b.title, author: b.author }
    }, now)
    const prompts = new PromptWatcher(join(root, 'knowledge', 'prompts.jsonl'), opts.onReviewChanged)
    await prompts.load()
    prompts.start()
    const review = new ReviewService({
      dataDir: library.dataDir,
      highlights,
      bookTitle: async id => (await library.get(id)).title,
      prompts,
      newCardsPerDay: opts.newCardsPerDay,
      now
    })
    const sessions = new SessionLog(library.dataDir)
    const stats = new StatsService({
      dataDir: library.dataDir,
      getCards: () => review.cards(),
      dueCount: () => review.dueCount(),
      books: async () => (await library.list()).map(b => ({ id: b.id, title: b.title })),
      sessions,
      retrievability: (c, t) => retrievability(c, t, review.desiredRetention),
      now
    })
    await stats.get() // records today's K snapshot
    return new Workspace(root, library, highlights, review, sessions, stats, prompts)
  }

  close(): void {
    this.prompts.stop()
  }
}
```
(The test's "permission" match: `'No permission to write'` contains `permission` ✓.)

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/unit/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `ptyService.ts`, `menu.ts`, `ipc.ts`**

`src/main/pty/ptyService.ts`:
```ts
import { spawn, type IPty } from 'node-pty'
import { IPC } from '../../shared/ipc'

export class PtyService {
  private ptys = new Map<string, IPty>()
  private seq = 0

  constructor(private send: (channel: string, ...args: unknown[]) => void) {}

  create(cwd: string, cols: number, rows: number): string {
    const id = `pty${++this.seq}`
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
    // A login shell (-l) loads the user's profile so PATH includes claude/codex/gemini when launched from Finder.
    const p = spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: Math.max(2, cols),
      rows: Math.max(2, rows),
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'SmartReader' } as Record<string, string>
    })
    p.onData(data => this.send(IPC.ptyData, id, data))
    p.onExit(({ exitCode }) => {
      this.ptys.delete(id)
      this.send(IPC.ptyExit, id, exitCode)
    })
    this.ptys.set(id, p)
    return id
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.ptys.get(id)?.resize(Math.max(2, cols), Math.max(2, rows))
    } catch {
      // resizing a pty that just exited throws; safe to ignore
    }
  }

  kill(id: string): void {
    this.ptys.get(id)?.kill()
    this.ptys.delete(id)
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id)
  }
}
```

`src/main/menu.ts`:
```ts
import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { basename } from 'node:path'
import type { MenuAction } from '../shared/api'

export function buildMenu(send: (a: MenuAction) => void, recent: string[]): Menu {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'Shift+CmdOrCtrl+O', click: () => send({ type: 'open-folder' }) },
        {
          label: 'Open Recent',
          enabled: recent.length > 0,
          submenu: recent.map(path => ({ label: basename(path), sublabel: path, click: () => send({ type: 'open-library', path }) }))
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Terminal', accelerator: 'CmdOrCtrl+J', click: () => send({ type: 'toggle-terminal' }) },
        { label: 'Start/Pause Pomodoro', accelerator: 'Alt+CmdOrCtrl+P', click: () => send({ type: 'toggle-pomodoro' }) },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  void app
  return Menu.buildFromTemplate(template)
}
```

`src/main/ipc.ts`:
```ts
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { homedir } from 'node:os'
import { IPC } from '../shared/ipc'
import type { OpenLibraryResult } from '../shared/api'
import type { Settings } from '../shared/types'
import { Workspace } from './workspace'
import type { SettingsStore } from './settings'
import type { PtyService } from './pty/ptyService'

export interface IpcContext {
  getWindow: () => BrowserWindow | null
  settings: SettingsStore
  templateDir: string
  pty: PtyService
  onSettingsChanged: (s: Settings) => void
}

export function registerIpc(ctx: IpcContext): { current(): Workspace | null; closeAll(): void } {
  let ws: Workspace | null = null
  const send = (channel: string, ...args: unknown[]): void => ctx.getWindow()?.webContents.send(channel, ...args)
  const need = (): Workspace => {
    if (!ws) throw new Error('No library is open')
    return ws
  }
  const reviewChanged = (): void => send(IPC.eventReviewChanged)
  const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (_e, ...args) => fn(...args))
  }

  handle(IPC.settingsGet, () => ctx.settings.get())
  handle(IPC.settingsUpdate, async (patch: Partial<Settings>) => {
    const s = await ctx.settings.update(patch)
    ctx.onSettingsChanged(s)
    return s
  })

  handle(IPC.libraryChooseFolder, async () => {
    const win = ctx.getWindow()
    const opts = { title: 'Choose your books folder', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  handle(IPC.libraryOpen, async (root: string): Promise<OpenLibraryResult> => {
    try {
      const next = await Workspace.open(root, {
        templateDir: ctx.templateDir,
        newCardsPerDay: async () => (await ctx.settings.get()).newCardsPerDay,
        onReviewChanged: reviewChanged
      })
      ws?.close()
      ctx.pty.killAll()
      ws = next
      ctx.onSettingsChanged(await ctx.settings.rememberLibrary(root))
      return { ok: true, root, books: await ws.library.list() }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  handle(IPC.libraryCurrent, () => ws?.root ?? null)
  handle(IPC.libraryList, () => need().library.list())
  handle(IPC.libraryRescan, () => need().library.scan())
  handle(IPC.libraryReadBook, (id: string) => need().library.readBook(id))
  handle(IPC.libraryGetCover, (id: string) => need().library.getCover(id))
  handle(IPC.librarySaveMetadata, async (id: string, meta: { title: string; author: string; cover: Uint8Array | null }) => {
    const b = await need().library.saveMetadata(id, meta)
    send(IPC.eventLibraryChanged)
    return b
  })
  handle(IPC.librarySaveProgress, (id: string, loc: string, p: number) => need().library.saveProgress(id, loc, p))
  handle(IPC.libraryMarkOpened, (id: string) => need().library.markOpened(id))
  handle(IPC.librarySetStatus, async (id: string, status, reason) => {
    await need().library.setStatus(id, status, reason)
    send(IPC.eventLibraryChanged)
  })

  handle(IPC.highlightsList, (bookId: string) => need().highlights.list(bookId))
  handle(IPC.highlightsAdd, async (bookId: string, h) => {
    const r = await need().highlights.add(bookId, h)
    reviewChanged()
    return r
  })
  handle(IPC.highlightsUpdate, async (bookId: string, id: string, patch) => {
    const r = await need().highlights.update(bookId, id, patch)
    reviewChanged()
    return r
  })
  handle(IPC.highlightsRemove, async (bookId: string, id: string) => {
    await need().highlights.remove(bookId, id)
    reviewChanged()
  })

  handle(IPC.reviewQueue, () => need().review.queue())
  handle(IPC.reviewRate, async (id: string, rating, ms: number, type) => {
    const r = await need().review.rate(id, rating, ms, type)
    reviewChanged()
    return r
  })
  handle(IPC.reviewDueCount, () => (ws ? ws.review.dueCount() : 0))
  handle(IPC.reviewPromptIssues, () => need().review.promptIssues())
  handle(IPC.sessionsLog, async entry => {
    await need().sessions.append(entry)
  })
  handle(IPC.statsGet, () => need().stats.get())

  handle(IPC.ptyCreate, (cols: number, rows: number) => ctx.pty.create(ws?.root ?? homedir(), cols, rows))
  ipcMain.on(IPC.ptyWrite, (_e, id: string, data: string) => ctx.pty.write(id, data))
  ipcMain.on(IPC.ptyResize, (_e, id: string, cols: number, rows: number) => ctx.pty.resize(id, cols, rows))
  ipcMain.on(IPC.ptyKill, (_e, id: string) => ctx.pty.kill(id))

  return {
    current: () => ws,
    closeAll: () => {
      ws?.close()
      ctx.pty.killAll()
    }
  }
}
```

- [ ] **Step 6: Wire `src/main/index.ts`**

Replace the `app.whenReady()` block from Task 1 with:
```ts
import { Menu } from 'electron'
import { IPC } from '../shared/ipc'
import { SettingsStore } from './settings'
import { PtyService } from './pty/ptyService'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { setRecoveryListener } from './store/atomic'

let mainWindow: BrowserWindow | null = null

function templateDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'workspace-template') : join(app.getAppPath(), 'resources', 'workspace-template')
}

async function bootstrap(): Promise<void> {
  registerAppProtocol()
  const send = (channel: string, ...args: unknown[]): void => mainWindow?.webContents.send(channel, ...args)
  const settings = new SettingsStore(app.getPath('userData'))
  const pty = new PtyService(send)
  const setMenu = (recent: string[]): void => Menu.setApplicationMenu(buildMenu(a => send(IPC.eventMenu, a), recent))
  const ipc = registerIpc({
    getWindow: () => mainWindow,
    settings,
    templateDir: templateDir(),
    pty,
    onSettingsChanged: s => setMenu(s.recentLibraries)
  })
  setRecoveryListener(e =>
    send(IPC.eventToast, {
      kind: 'warning',
      message: e.restoredFromBackup
        ? `A data file was damaged and restored from backup (${e.path}).`
        : `A data file was damaged and reset (${e.path}). The damaged copy was kept.`
    })
  )
  setMenu((await settings.get()).recentLibraries)
  mainWindow = createMainWindow()
  mainWindow.on('closed', () => {
    ipc.closeAll()
    mainWindow = null
  })
}

app.whenReady().then(bootstrap)
```
(Keep `registerAppProtocol`, `createMainWindow` and the `window-all-closed` handler from Task 1.)

- [ ] **Step 7: Write the IPC e2e test**

`tests/e2e/ipc.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('library open, highlight, review and pty over real IPC', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp()
  const result = await page.evaluate(async lib => {
    const r = await window.api.library.open(lib)
    if (!r.ok) return { error: r.error }
    const book = r.books.find(b => b.format === 'epub')!
    await window.api.highlights.add(book.id, {
      location: 'epubcfi(/6/4)', quote: { exact: 'all warfare is based on deception', prefix: '', suffix: '' },
      context: 'All warfare is based on deception.', chapter: 'I', position: 0.05, color: 'yellow', note: null
    })
    const q = await window.api.review.queue()
    const id = await window.api.pty.create(80, 24)
    const out = await new Promise<string>(resolve => {
      let buf = ''
      const off = window.api.pty.onData((pid, d) => {
        if (pid !== id) return
        buf += d
        if (buf.includes('SR_OK')) { off(); resolve(buf) }
      })
      window.api.pty.write(id, 'echo SR_OK\r')
    })
    window.api.pty.kill(id)
    return { books: r.books.length, queue: q.length, ptyOk: out.includes('SR_OK') }
  }, library)
  expect(result).toEqual({ books: 4, queue: 1, ptyOk: true })
  await app.close()
})

test('opening a missing folder returns an error instead of crashing', async () => {
  const { app, page } = await launchApp()
  const r = await page.evaluate(() => window.api.library.open('/no/such/folder'))
  expect(r).toEqual({ ok: false, error: expect.stringContaining('Folder not found') })
  await app.close()
})
```

- [ ] **Step 8: Run all the tests**

Run: `npm run typecheck && npm test && xvfb-run -a npx playwright test tests/e2e/ipc.spec.ts tests/e2e/smoke.spec.ts` (after `npm run build`)
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main tests/unit/workspace.test.ts tests/e2e/ipc.spec.ts
git commit -m "feat(main): workspace composition, IPC handlers, pty service, app menu"
```

---

### Task 8: Renderer shell and design system (sonnet, wave 2)

**Files:**
- Create: `src/renderer/src/styles/tokens.css`, `src/renderer/src/styles/global.css`
- Create: `src/renderer/src/state/appState.tsx`, `src/renderer/src/state/actions.ts`
- Create: `src/renderer/src/reader/bus.ts`, `src/renderer/src/reader/foliate.ts`
- Create: `src/renderer/src/components/{Sidebar,StatusBar,Toasts,Welcome}.tsx`
- Create **stubs owned by later tasks** (minimal, exactly as shown): `src/renderer/src/views/{LibraryView,ReaderView,ReviewView,StatsView}.tsx`, `src/renderer/src/components/HighlightsPanel.tsx`, `src/renderer/src/terminal/TerminalPanel.tsx`, `src/renderer/src/pomodoro/PomodoroProvider.tsx`, `src/renderer/src/sessions/useReadingTracker.ts`, `src/renderer/src/stats/KnowledgeRate.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/main.tsx`
- Test: `tests/unit/appState.test.ts`, `tests/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `window.api` (`SmartReaderApi`), shared types.
- Produces (later UI tasks import exactly these):
  - `type View = { name: 'library' } | { name: 'reader'; bookId: string; target?: string } | { name: 'review' } | { name: 'stats' }`
  - `type SidebarTab = 'library' | 'highlights' | 'review' | 'stats'`
  - `interface AppState { status: 'loading' | 'ready'; root: string | null; books: Book[]; view: View; sidebarTab: SidebarTab; terminalOpen: boolean; terminalMounted: boolean; settings: Settings | null; toasts: Array<Toast & { id: number }>; dueCount: number }`
  - `reducer(state: AppState, action: Action): AppState`, `initialState`, `AppStateProvider`, `useAppState(): { state: AppState; dispatch: Dispatch<Action> }`
  - `openLibrary(dispatch, path: string): Promise<boolean>`, `chooseAndOpenLibrary(dispatch): Promise<void>`, `refreshBooks(dispatch): Promise<void>`, `refreshDueCount(dispatch): Promise<void>`, `updateSettings(dispatch, patch: Partial<Settings>): Promise<void>`, `toast(dispatch, kind, message): void`
  - Reader bus: `emitReader<K extends keyof ReaderEvents>(type: K, detail: ReaderEvents[K]): void`, `onReader<K>(type: K, cb: (d: ReaderEvents[K]) => void): () => void`, where `interface ReaderEvents { goto: { target: string }; 'highlights-changed': { bookId: string }; activity: { bookId: string }; closed: { bookId: string } }`
  - Foliate loader: `loadFoliateView(): Promise<void>` (registers `<foliate-view>`), `makeBook(file: File): Promise<FoliateBook>`, `loadOverlayer(): Promise<FoliateOverlayer>`, `bookFile(bookId: string): Promise<File>`, `formatLanguageMap(x: unknown): string`, `formatContributor(x: unknown): string`
  - Pomodoro stub API (replaced by T13, same exports): `PomodoroProvider({ children })`, `PomodoroControl()`, `usePomodoro(): { phase: 'idle' | 'work' | 'break' | 'longBreak'; running: boolean; toggle(): void }`
  - `useReadingTracker(): void` (stub; T13 replaces it)
  - `KnowledgeRate()` (stub; T14 replaces it)
  - CSS variables (see tokens.css); CSS classes `.btn`, `.btn-primary`, `.btn-ghost`, `.icon-btn`, `.card`, `.badge`, `.muted`, `.placeholder`

- [ ] **Step 1: Write the failing reducer test**

`tests/unit/appState.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/appState.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement state and actions**

`src/renderer/src/state/appState.tsx`:
```tsx
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import type { Book, Settings, Toast } from '../../../shared/types'

export type View =
  | { name: 'library' }
  | { name: 'reader'; bookId: string; target?: string }
  | { name: 'review' }
  | { name: 'stats' }

export type SidebarTab = 'library' | 'highlights' | 'review' | 'stats'

export interface AppState {
  status: 'loading' | 'ready'
  root: string | null
  books: Book[]
  view: View
  sidebarTab: SidebarTab
  terminalOpen: boolean
  terminalMounted: boolean
  settings: Settings | null
  toasts: Array<Toast & { id: number }>
  dueCount: number
}

export type Action =
  | { type: 'settings'; settings: Settings }
  | { type: 'libraryOpened'; root: string; books: Book[] }
  | { type: 'libraryClosed' }
  | { type: 'books'; books: Book[] }
  | { type: 'navigate'; view: View }
  | { type: 'sidebarTab'; tab: SidebarTab }
  | { type: 'toggleTerminal'; open?: boolean }
  | { type: 'toast'; toast: Toast }
  | { type: 'dismissToast'; id: number }
  | { type: 'dueCount'; count: number }

export const initialState: AppState = {
  status: 'loading',
  root: null,
  books: [],
  view: { name: 'library' },
  sidebarTab: 'library',
  terminalOpen: false,
  terminalMounted: false,
  settings: null,
  toasts: [],
  dueCount: 0
}

let toastSeq = 0
const TAB_FOR_VIEW: Record<View['name'], SidebarTab> = { library: 'library', reader: 'highlights', review: 'review', stats: 'stats' }

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'settings':
      return { ...state, settings: action.settings }
    case 'libraryOpened':
      return { ...state, status: 'ready', root: action.root, books: action.books, view: { name: 'library' }, sidebarTab: 'library' }
    case 'libraryClosed':
      return { ...state, status: 'ready', root: null, books: [], view: { name: 'library' } }
    case 'books':
      return { ...state, books: action.books }
    case 'navigate':
      return { ...state, view: action.view, sidebarTab: TAB_FOR_VIEW[action.view.name] }
    case 'sidebarTab':
      return { ...state, sidebarTab: action.tab }
    case 'toggleTerminal': {
      const open = action.open ?? !state.terminalOpen
      return { ...state, terminalOpen: open, terminalMounted: state.terminalMounted || open }
    }
    case 'toast':
      return { ...state, toasts: [...state.toasts, { ...action.toast, id: ++toastSeq }].slice(-4) }
    case 'dismissToast':
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) }
    case 'dueCount':
      return { ...state, dueCount: action.count }
  }
}

const Ctx = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>
}

export function useAppState(): { state: AppState; dispatch: Dispatch<Action> } {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAppState outside provider')
  return v
}
```

`src/renderer/src/state/actions.ts`:
```ts
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/unit/appState.test.ts`
Expected: PASS.

- [ ] **Step 5: Reader bus and foliate loader**

`src/renderer/src/reader/bus.ts`:
```ts
export interface ReaderEvents {
  goto: { target: string }
  'highlights-changed': { bookId: string }
  activity: { bookId: string }
  closed: { bookId: string }
}

const bus = new EventTarget()

export function emitReader<K extends keyof ReaderEvents>(type: K, detail: ReaderEvents[K]): void {
  bus.dispatchEvent(new CustomEvent(type, { detail }))
}

export function onReader<K extends keyof ReaderEvents>(type: K, cb: (d: ReaderEvents[K]) => void): () => void {
  const h = (e: Event): void => cb((e as CustomEvent<ReaderEvents[K]>).detail)
  bus.addEventListener(type, h)
  return () => bus.removeEventListener(type, h)
}
```

`src/renderer/src/reader/foliate.ts`:
```ts
// foliate-js is vendored unbundled in public/foliate-js and imported at runtime.
export interface FoliateTocItem { label: string; href: string; subitems?: FoliateTocItem[] }
export interface FoliateBook {
  metadata?: { title?: unknown; author?: unknown; language?: unknown }
  toc?: FoliateTocItem[]
  sections: unknown[]
  getCover?: () => Promise<Blob | null>
}
export interface FoliateOverlayer {
  highlight: (rects: unknown, options?: { color?: string }) => SVGElement
  underline: (rects: unknown, options?: { color?: string }) => SVGElement
}

const url = (p: string): string => new URL(`foliate-js/${p}`, document.baseURI).href
let viewP: Promise<{ makeBook: (f: File) => Promise<FoliateBook> }> | null = null

function viewModule(): Promise<{ makeBook: (f: File) => Promise<FoliateBook> }> {
  return (viewP ??= import(/* @vite-ignore */ url('view.js')))
}

export async function loadFoliateView(): Promise<void> {
  await viewModule()
}

export async function makeBook(file: File): Promise<FoliateBook> {
  return (await viewModule()).makeBook(file)
}

export async function loadOverlayer(): Promise<FoliateOverlayer> {
  const m = await import(/* @vite-ignore */ url('overlayer.js'))
  return m.Overlayer as FoliateOverlayer
}

export async function bookFile(bookId: string): Promise<File> {
  const { name, data } = await window.api.library.readBook(bookId)
  return new File([data as BlobPart], name)
}

export function formatLanguageMap(x: unknown): string {
  if (!x) return ''
  if (typeof x === 'string') return x
  if (typeof x === 'object') {
    const values = Object.values(x as Record<string, unknown>)
    return typeof values[0] === 'string' ? values[0] : ''
  }
  return ''
}

export function formatContributor(x: unknown): string {
  const one = (c: unknown): string =>
    typeof c === 'string' ? c : formatLanguageMap((c as { name?: unknown } | null)?.name)
  if (Array.isArray(x)) return x.map(one).filter(Boolean).join(', ')
  return one(x)
}
```

- [ ] **Step 6: Design tokens and global styles**

`src/renderer/src/styles/tokens.css`:
```css
:root {
  --font-ui: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
  --font-serif: 'New York', 'Iowan Old Style', 'Charter', Georgia, serif;
  --font-mono: 'SF Mono', ui-monospace, Menlo, monospace;
  --radius-s: 6px;
  --radius: 10px;
  --radius-l: 14px;
  --sidebar-w: 232px;
  --titlebar-h: 52px;
  --statusbar-h: 30px;

  --bg: #ffffff;
  --bg-2: #f5f5f7;
  --bg-elevated: #ffffff;
  --sidebar-bg: rgba(242, 242, 245, 0.78);
  --text: #1d1d1f;
  --text-2: #6e6e73;
  --text-3: #a1a1a6;
  --separator: rgba(0, 0, 0, 0.08);
  --hover: rgba(0, 0, 0, 0.05);
  --accent: #0a84ff;
  --accent-soft: rgba(10, 132, 255, 0.12);
  --danger: #ff3b30;
  --success: #30a46c;
  --shadow-s: 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.08);
  --shadow-l: 0 12px 40px rgba(0, 0, 0, 0.18);

  --hl-yellow: rgba(255, 214, 10, 0.42);
  --hl-green: rgba(52, 199, 89, 0.34);
  --hl-blue: rgba(10, 132, 255, 0.28);
  --hl-pink: rgba(255, 55, 95, 0.28);
  --dot-yellow: #ffd60a;
  --dot-green: #34c759;
  --dot-blue: #0a84ff;
  --dot-pink: #ff375f;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1c1e;
    --bg-2: #2c2c2e;
    --bg-elevated: #2c2c2e;
    --sidebar-bg: rgba(30, 30, 32, 0.72);
    --text: #f5f5f7;
    --text-2: #a1a1a6;
    --text-3: #6e6e73;
    --separator: rgba(255, 255, 255, 0.1);
    --hover: rgba(255, 255, 255, 0.07);
    --accent: #0a84ff;
    --accent-soft: rgba(10, 132, 255, 0.22);
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.4);
    --shadow-l: 0 12px 40px rgba(0, 0, 0, 0.55);
  }
}
```

`src/renderer/src/styles/global.css`:
```css
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
html { background: var(--bg); }
html.platform-mac { background: transparent; }
body {
  font-family: var(--font-ui); font-size: 13px; color: var(--text);
  -webkit-font-smoothing: antialiased; user-select: none; overflow: hidden;
}
input, textarea, [contenteditable] { user-select: text; }
button { font: inherit; color: inherit; }

.app {
  display: grid; height: 100vh;
  grid-template-columns: var(--sidebar-w) 1fr;
  grid-template-rows: 1fr var(--statusbar-h);
}
.sidebar {
  grid-row: 1 / span 2; background: var(--sidebar-bg); border-right: 1px solid var(--separator);
  display: flex; flex-direction: column; padding-top: var(--titlebar-h);
  -webkit-app-region: drag;
}
html:not(.platform-mac) .sidebar { background: var(--bg-2); }
.sidebar > * { -webkit-app-region: no-drag; }
.sidebar-nav { display: flex; flex-direction: column; gap: 2px; padding: 0 10px; }
.sidebar-item {
  display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 10px; border: 0; border-radius: var(--radius-s);
  background: transparent; text-align: left; cursor: default; font-size: 13px;
}
.sidebar-item:hover { background: var(--hover); }
.sidebar-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 500; }
.sidebar-item .badge { margin-left: auto; }
.sidebar-section { flex: 1; overflow: auto; margin-top: 12px; border-top: 1px solid var(--separator); }
.sidebar-footer { padding: 10px 14px; border-top: 1px solid var(--separator); font-size: 12px; color: var(--text-2); display: flex; align-items: center; gap: 8px; }
.sidebar-footer .folder-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

.main { background: var(--bg); display: flex; min-width: 0; min-height: 0; position: relative; }
.main.term-bottom { flex-direction: column; }
.main.term-right { flex-direction: row; }
.content { flex: 1; min-width: 0; min-height: 0; position: relative; overflow: hidden; }
.titlebar-drag { position: absolute; inset: 0 0 auto 0; height: var(--titlebar-h); -webkit-app-region: drag; z-index: 0; }

.statusbar {
  grid-column: 2; display: flex; align-items: center; gap: 14px; padding: 0 12px;
  border-top: 1px solid var(--separator); background: var(--bg-2); font-size: 12px; color: var(--text-2);
}
.statusbar .spacer { flex: 1; }
.status-item { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; padding: 3px 6px; border-radius: var(--radius-s); }
.status-item:hover { background: var(--hover); color: var(--text); }

.btn { height: 30px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--separator); background: var(--bg-elevated); box-shadow: var(--shadow-s); cursor: default; }
.btn:hover { background: var(--hover); }
.btn-primary { background: var(--accent); border-color: transparent; color: #fff; }
.btn-primary:hover { filter: brightness(1.08); background: var(--accent); }
.btn-ghost { background: transparent; border-color: transparent; box-shadow: none; }
.icon-btn { width: 28px; height: 28px; display: inline-grid; place-items: center; border: 0; border-radius: var(--radius-s); background: transparent; color: var(--text-2); }
.icon-btn:hover { background: var(--hover); color: var(--text); }
.card { background: var(--bg-elevated); border-radius: var(--radius-l); box-shadow: var(--shadow); }
.badge { min-width: 18px; height: 18px; padding: 0 6px; border-radius: 9px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 600; display: inline-grid; place-items: center; }
.muted { color: var(--text-2); }
.placeholder { height: 100%; display: grid; place-items: center; color: var(--text-3); font-size: 15px; }

.toasts { position: fixed; right: 16px; bottom: calc(var(--statusbar-h) + 12px); display: flex; flex-direction: column; gap: 8px; z-index: 1000; }
.toast { min-width: 260px; max-width: 420px; padding: 10px 14px; border-radius: var(--radius); background: var(--bg-elevated); box-shadow: var(--shadow-l); border-left: 3px solid var(--accent); display: flex; gap: 10px; align-items: flex-start; user-select: text; }
.toast.warning { border-left-color: #ff9f0a; }
.toast.error { border-left-color: var(--danger); }

.welcome { height: 100vh; display: grid; place-items: center; background: var(--bg); -webkit-app-region: drag; }
.welcome-card { width: 420px; padding: 40px; text-align: center; -webkit-app-region: no-drag; }
.welcome-card h1 { font-family: var(--font-serif); font-weight: 600; font-size: 28px; margin: 18px 0 6px; }
.welcome-card p { color: var(--text-2); font-size: 14px; line-height: 1.5; margin: 0 0 24px; }
.welcome-recent { margin-top: 22px; text-align: left; }
.welcome-recent button { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 7px 10px; border-radius: var(--radius-s); color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.welcome-recent button:hover { background: var(--hover); color: var(--text); }
```

- [ ] **Step 7: Components**

`src/renderer/src/components/Sidebar.tsx`:
```tsx
import type { ReactNode } from 'react'
import { BarChart3, BookOpen, FolderOpen, Highlighter, Layers } from 'lucide-react'
import { useAppState, type SidebarTab } from '../state/appState'
import { chooseAndOpenLibrary } from '../state/actions'
import { HighlightsPanel } from './HighlightsPanel'

export function Sidebar() {
  const { state, dispatch } = useAppState()
  const readerBookId = state.view.name === 'reader' ? state.view.bookId : null
  const go = (tab: SidebarTab): void => {
    if (tab === 'library') dispatch({ type: 'navigate', view: { name: 'library' } })
    else if (tab === 'review') dispatch({ type: 'navigate', view: { name: 'review' } })
    else if (tab === 'stats') dispatch({ type: 'navigate', view: { name: 'stats' } })
    else dispatch({ type: 'sidebarTab', tab })
  }
  const item = (tab: SidebarTab, label: string, icon: ReactNode, extra?: ReactNode) => (
    <button className={`sidebar-item ${state.sidebarTab === tab ? 'active' : ''}`} onClick={() => go(tab)} data-testid={`nav-${tab}`}>
      {icon}
      <span>{label}</span>
      {extra}
    </button>
  )
  const folder = state.root?.split('/').filter(Boolean).pop() ?? ''
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {item('library', 'Library', <BookOpen size={16} />)}
        {item('highlights', 'Highlights', <Highlighter size={16} />)}
        {item('review', 'Review', <Layers size={16} />, state.dueCount > 0 ? <span className="badge" data-testid="due-badge">{state.dueCount}</span> : undefined)}
        {item('stats', 'Stats', <BarChart3 size={16} />)}
      </nav>
      <div className="sidebar-section">
        {state.sidebarTab === 'highlights' &&
          (readerBookId ? <HighlightsPanel bookId={readerBookId} /> : <p className="muted" style={{ padding: '12px 18px' }}>Open a book to see its highlights.</p>)}
      </div>
      <div className="sidebar-footer" title={state.root ?? ''}>
        <FolderOpen size={14} />
        <span className="folder-name">{folder}</span>
        <button className="btn-ghost icon-btn" title="Open another folder (⇧⌘O)" onClick={() => void chooseAndOpenLibrary(dispatch)}>
          …
        </button>
      </div>
    </aside>
  )
}
```

`src/renderer/src/components/StatusBar.tsx`:
```tsx
import { Layers, TerminalSquare } from 'lucide-react'
import { useAppState } from '../state/appState'
import { PomodoroControl } from '../pomodoro/PomodoroProvider'
import { KnowledgeRate } from '../stats/KnowledgeRate'

export function StatusBar() {
  const { state, dispatch } = useAppState()
  return (
    <footer className="statusbar">
      <PomodoroControl />
      <button className="status-item" data-testid="status-due" onClick={() => dispatch({ type: 'navigate', view: { name: 'review' } })}>
        <Layers size={13} /> {state.dueCount} due
      </button>
      <span className="spacer" />
      <KnowledgeRate />
      <button className="status-item" title="Toggle terminal (⌘J)" onClick={() => dispatch({ type: 'toggleTerminal' })}>
        <TerminalSquare size={13} /> Terminal
      </button>
    </footer>
  )
}
```

`src/renderer/src/components/Toasts.tsx`:
```tsx
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useAppState } from '../state/appState'

export function Toasts() {
  const { state, dispatch } = useAppState()
  useEffect(() => {
    const timers = state.toasts.map(t => setTimeout(() => dispatch({ type: 'dismissToast', id: t.id }), t.kind === 'error' ? 9000 : 5000))
    return () => timers.forEach(clearTimeout)
  }, [state.toasts, dispatch])
  return (
    <div className="toasts" role="status">
      {state.toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind}`} data-testid="toast">
          <span style={{ flex: 1 }}>{t.message}</span>
          <button className="icon-btn" onClick={() => dispatch({ type: 'dismissToast', id: t.id })} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
```

`src/renderer/src/components/Welcome.tsx`:
```tsx
import { BookOpen } from 'lucide-react'
import { useAppState } from '../state/appState'
import { chooseAndOpenLibrary, openLibrary } from '../state/actions'

export function Welcome() {
  const { state, dispatch } = useAppState()
  const recent = state.settings?.recentLibraries ?? []
  return (
    <div className="welcome">
      <div className="welcome-card card">
        <BookOpen size={44} strokeWidth={1.4} color="var(--accent)" />
        <h1>Smart Reader</h1>
        <p>Read, highlight, and actually remember. Choose the folder where you keep your ebooks to begin.</p>
        <button className="btn btn-primary" data-testid="choose-folder" onClick={() => void chooseAndOpenLibrary(dispatch)}>
          Choose your books folder
        </button>
        {recent.length > 0 && (
          <div className="welcome-recent">
            <div className="muted" style={{ fontSize: 12, margin: '0 10px 4px' }}>Recent</div>
            {recent.map(p => (
              <button key={p} onClick={() => void openLibrary(dispatch, p)} title={p}>{p}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Stubs for later tasks** (each later task replaces only its own files)

`src/renderer/src/views/LibraryView.tsx`:
```tsx
export function LibraryView() {
  return <div className="placeholder" data-testid="view-library">Library</div>
}
```
`src/renderer/src/views/ReaderView.tsx`:
```tsx
export function ReaderView({ bookId }: { bookId: string; target?: string }) {
  return <div className="placeholder" data-testid="view-reader">Reader {bookId}</div>
}
```
`src/renderer/src/views/ReviewView.tsx`:
```tsx
export function ReviewView() {
  return <div className="placeholder" data-testid="view-review">Review</div>
}
```
`src/renderer/src/views/StatsView.tsx`:
```tsx
export function StatsView() {
  return <div className="placeholder" data-testid="view-stats">Stats</div>
}
```
`src/renderer/src/components/HighlightsPanel.tsx`:
```tsx
export function HighlightsPanel({ bookId }: { bookId: string }) {
  return <p className="muted" style={{ padding: '12px 18px' }} data-book={bookId}>Highlights</p>
}
```
`src/renderer/src/terminal/TerminalPanel.tsx`:
```tsx
export function TerminalPanel({ visible }: { visible: boolean }) {
  return visible ? <div className="placeholder" data-testid="terminal-panel">Terminal</div> : null
}
```
`src/renderer/src/pomodoro/PomodoroProvider.tsx`:
```tsx
import type { ReactNode } from 'react'

export type PomodoroPhase = 'idle' | 'work' | 'break' | 'longBreak'

export function PomodoroProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function PomodoroControl() {
  return null
}

export function usePomodoro(): { phase: PomodoroPhase; running: boolean; toggle(): void } {
  return { phase: 'idle', running: false, toggle: () => {} }
}
```
`src/renderer/src/sessions/useReadingTracker.ts`:
```ts
export function useReadingTracker(): void {}
```
`src/renderer/src/stats/KnowledgeRate.tsx`:
```tsx
export function KnowledgeRate() {
  return null
}
```

- [ ] **Step 9: App and entry**

`src/renderer/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppStateProvider } from './state/appState'
import './styles/tokens.css'
import './styles/global.css'

if (navigator.userAgent.includes('Macintosh')) document.documentElement.classList.add('platform-mac')

createRoot(document.getElementById('root')!).render(
  <AppStateProvider>
    <App />
  </AppStateProvider>
)
```

`src/renderer/src/App.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { useAppState } from './state/appState'
import { chooseAndOpenLibrary, openLibrary, refreshBooks, refreshDueCount, toast } from './state/actions'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Toasts } from './components/Toasts'
import { Welcome } from './components/Welcome'
import { LibraryView } from './views/LibraryView'
import { ReaderView } from './views/ReaderView'
import { ReviewView } from './views/ReviewView'
import { StatsView } from './views/StatsView'
import { TerminalPanel } from './terminal/TerminalPanel'
import { PomodoroProvider, usePomodoro } from './pomodoro/PomodoroProvider'
import { useReadingTracker } from './sessions/useReadingTracker'

export function App() {
  return (
    <PomodoroProvider>
      <Shell />
    </PomodoroProvider>
  )
}

function Shell() {
  const { state, dispatch } = useAppState()
  const pomodoroState = usePomodoro()
  const pomodoro = useRef(pomodoroState)
  pomodoro.current = pomodoroState
  useReadingTracker()

  useEffect(() => {
    void (async () => {
      const settings = await window.api.settings.get()
      dispatch({ type: 'settings', settings })
      if (settings.libraryPath) {
        const ok = await openLibrary(dispatch, settings.libraryPath)
        if (!ok) dispatch({ type: 'libraryClosed' })
      } else {
        dispatch({ type: 'libraryClosed' })
      }
    })()
  }, [dispatch])

  useEffect(() => {
    const offs = [
      window.api.on.toast(t => toast(dispatch, t.kind, t.message)),
      window.api.on.reviewChanged(() => void refreshDueCount(dispatch)),
      window.api.on.libraryChanged(() => void refreshBooks(dispatch)),
      window.api.on.menu(a => {
        if (a.type === 'open-folder') void chooseAndOpenLibrary(dispatch)
        else if (a.type === 'open-library') void openLibrary(dispatch, a.path)
        else if (a.type === 'toggle-terminal') dispatch({ type: 'toggleTerminal' })
        else if (a.type === 'toggle-pomodoro') pomodoro.current.toggle()
      })
    ]
    return () => offs.forEach(off => off())
  }, [dispatch])

  if (state.status === 'loading') return <div className="welcome" />
  if (!state.root) return (<><Welcome /><Toasts /></>)

  const v = state.view
  const position = state.settings?.terminalPosition ?? 'bottom'
  return (
    <div className="app" data-testid="app-shell">
      <Sidebar />
      <main className={`main term-${position}`}>
        <div className="content">
          {v.name === 'library' && <LibraryView />}
          {v.name === 'reader' && <ReaderView key={v.bookId} bookId={v.bookId} target={v.target} />}
          {v.name === 'review' && <ReviewView />}
          {v.name === 'stats' && <StatsView />}
        </div>
        {state.terminalMounted && <TerminalPanel visible={state.terminalOpen} />}
      </main>
      <StatusBar />
      <Toasts />
    </div>
  )
}
```

- [ ] **Step 10: Write the shell e2e test**

`tests/e2e/shell.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('first launch shows Welcome', async () => {
  const { app, page } = await launchApp()
  await expect(page.getByTestId('choose-folder')).toBeVisible()
  await app.close()
})

test('remembered library opens to the shell; navigation and terminal toggle work', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('view-review')).toBeVisible()
  await page.getByTestId('nav-stats').click()
  await expect(page.getByTestId('view-stats')).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('event:menu', { type: 'toggle-terminal' }))
  await expect(page.getByTestId('terminal-panel')).toBeVisible()
  await app.close()
})

test('missing remembered folder falls back to Welcome with an error toast', async () => {
  const { app, page } = await launchApp({ library: '/no/such/library' })
  await expect(page.getByTestId('choose-folder')).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('Folder not found')
  await app.close()
})
```

- [ ] **Step 11: Run all the tests**

Run: `npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test tests/e2e/shell.spec.ts`
Expected: PASS. (`shell.spec.ts` depends on T7's IPC handlers. If T7 hasn't merged yet when this runs in its worktree, run only the unit tests and typecheck there. The controller runs the e2e test after merging both.)

- [ ] **Step 12: Commit**

```bash
git add src/renderer tests/unit/appState.test.ts tests/e2e/shell.spec.ts
git commit -m "feat(ui): app shell, design tokens, sidebar, status bar, welcome, toasts, view stubs"
```

---
### Task 9: Library view: covers, metadata extraction, search (sonnet, wave 3a)

**Files:**
- Replace stub: `src/renderer/src/views/LibraryView.tsx`
- Create: `src/renderer/src/library/metadata.ts`, `src/renderer/src/library/extract.ts`, `src/renderer/src/library/useCover.ts`, `src/renderer/src/library/BookTile.tsx`, `src/renderer/src/library/GeneratedCover.tsx`, `src/renderer/src/library/library.css`
- Test: `tests/unit/metadata.test.ts`, `tests/e2e/library.spec.ts`

**Interfaces:**
- Consumes: `useAppState`, `refreshBooks`, `toast` (T8); `makeBook`, `bookFile`, `formatLanguageMap`, `formatContributor` (T8 `reader/foliate.ts`); `window.api.library.*`.
- Produces: `normalizeMetadata(meta: { title?: unknown; author?: unknown } | undefined, fallbackTitle: string): { title: string; author: string }`, `coverToJpeg(blob: Blob, maxWidth?: number): Promise<Uint8Array | null>`, `runMetadataExtraction(books: Book[], onDone: () => void): void`, `coverHue(id: string): number`, `filterAndSort(books: Book[], query: string, sort: 'recent' | 'title' | 'author'): Book[]`.

- [ ] **Step 1: Write the failing unit test**

`tests/unit/metadata.test.ts`:
```ts
import { it, expect } from 'vitest'
import { normalizeMetadata, coverHue, filterAndSort } from '../../src/renderer/src/library/metadata'
import type { Book } from '../../src/shared/types'

it('normalizes foliate metadata shapes', () => {
  expect(normalizeMetadata({ title: 'Deep Work', author: 'Cal Newport' }, 'file')).toEqual({ title: 'Deep Work', author: 'Cal Newport' })
  expect(normalizeMetadata({ title: { en: 'Map Title' }, author: [{ name: 'A' }, { name: { en: 'B' } }] }, 'file')).toEqual({ title: 'Map Title', author: 'A, B' })
  expect(normalizeMetadata({ title: '  ', author: undefined }, 'Fallback')).toEqual({ title: 'Fallback', author: '' })
  expect(normalizeMetadata(undefined, 'Fallback')).toEqual({ title: 'Fallback', author: '' })
})

it('cover hue is stable and in range', () => {
  expect(coverHue('abc')).toBe(coverHue('abc'))
  expect(coverHue('abc')).toBeGreaterThanOrEqual(0)
  expect(coverHue('abc')).toBeLessThan(360)
})

const book = (id: string, title: string, author: string, lastOpenedAt: string | null): Book => ({
  id, slug: id, path: `${id}.epub`, format: 'epub', title, author, addedAt: '', lastOpenedAt, location: null,
  progress: 0, status: 'ok', statusReason: null, fileSize: 1, mtimeMs: 1, metadataExtracted: true, hasCover: false, missing: false
})

it('filters by title/author and sorts', () => {
  const books = [book('1', 'Zen', 'Bob', null), book('2', 'Atomic Habits', 'James Clear', '2026-10-19'), book('3', 'Deep Work', 'Cal', '2026-10-20')]
  expect(filterAndSort(books, 'clear', 'title').map(b => b.id)).toEqual(['2'])
  expect(filterAndSort(books, '', 'title').map(b => b.id)).toEqual(['2', '3', '1'])
  expect(filterAndSort(books, '', 'recent').map(b => b.id)).toEqual(['3', '2', '1'])
  expect(filterAndSort(books, '', 'author').map(b => b.id)).toEqual(['1', '3', '2'])
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/metadata.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `metadata.ts`**

```ts
import type { Book } from '../../../shared/types'
import { formatContributor, formatLanguageMap } from '../reader/foliate'

export function normalizeMetadata(meta: { title?: unknown; author?: unknown } | undefined, fallbackTitle: string): { title: string; author: string } {
  const title = formatLanguageMap(meta?.title).trim() || fallbackTitle
  const author = formatContributor(meta?.author).trim()
  return { title, author }
}

export function coverHue(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 360
}

export function filterAndSort(books: Book[], query: string, sort: 'recent' | 'title' | 'author'): Book[] {
  const q = query.trim().toLowerCase()
  const list = q ? books.filter(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)) : [...books]
  const byTitle = (a: Book, b: Book): number => a.title.localeCompare(b.title)
  if (sort === 'title') return list.sort(byTitle)
  if (sort === 'author') return list.sort((a, b) => (a.author || '￿').localeCompare(b.author || '￿') || byTitle(a, b))
  return list.sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? '') || byTitle(a, b))
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/unit/metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement extraction, covers and the view**

`src/renderer/src/library/extract.ts`:
```ts
import type { Book } from '../../../shared/types'
import { bookFile, makeBook } from '../reader/foliate'
import { normalizeMetadata } from './metadata'

export async function coverToJpeg(blob: Blob, maxWidth = 600): Promise<Uint8Array | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, maxWidth / bmp.width)
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale))
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    return new Uint8Array(await out.arrayBuffer())
  } catch {
    return null
  }
}

let running = false
const queued = new Set<string>()

// Extracts title/author/cover with foliate's own parsers, one book at a time so the UI stays responsive.
export function runMetadataExtraction(books: Book[], onDone: () => void): void {
  for (const b of books) if (b.status === 'ok' && !b.metadataExtracted) queued.add(b.id)
  if (running || queued.size === 0) return
  running = true
  void (async () => {
    while (queued.size) {
      const id = queued.values().next().value as string
      queued.delete(id)
      const book = books.find(b => b.id === id)
      if (!book) continue
      try {
        const parsed = await makeBook(await bookFile(id))
        const { title, author } = normalizeMetadata(parsed.metadata, book.title)
        const blob = await parsed.getCover?.().catch(() => null)
        const cover = blob ? await coverToJpeg(blob) : null
        await window.api.library.saveMetadata(id, { title, author, cover })
      } catch (e) {
        const err = e as Error
        const status = err.name === 'UnsupportedTypeError' ? 'unsupported' : 'error'
        await window.api.library.setStatus(id, status, err.message || 'Could not open this file')
      }
      await new Promise(r => setTimeout(r, 30))
    }
    running = false
    onDone()
  })()
}
```

`src/renderer/src/library/useCover.ts`:
```ts
import { useEffect, useState } from 'react'

const cache = new Map<string, string>()

export function useCover(bookId: string, hasCover: boolean): string | null {
  const [url, setUrl] = useState<string | null>(cache.get(bookId) ?? null)
  useEffect(() => {
    if (!hasCover || cache.has(bookId)) {
      setUrl(cache.get(bookId) ?? null)
      return
    }
    let alive = true
    void window.api.library.getCover(bookId).then(bytes => {
      if (!bytes) return
      const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
      cache.set(bookId, u)
      if (alive) setUrl(u)
    })
    return () => { alive = false }
  }, [bookId, hasCover])
  return url
}
```

`src/renderer/src/library/GeneratedCover.tsx`:
```tsx
import { coverHue } from './metadata'

export function GeneratedCover({ id, title, author }: { id: string; title: string; author: string }) {
  const h = coverHue(id)
  return (
    <div className="gen-cover" style={{ background: `linear-gradient(160deg, hsl(${h} 45% 58%), hsl(${(h + 40) % 360} 50% 36%))` }}>
      <div className="gen-cover-title">{title}</div>
      {author && <div className="gen-cover-author">{author}</div>}
    </div>
  )
}
```

`src/renderer/src/library/BookTile.tsx`:
```tsx
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
```

`src/renderer/src/library/library.css`:
```css
.library { height: 100%; overflow: auto; padding: 0 32px 40px; }
.library-header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px; height: var(--titlebar-h); padding-top: 8px; background: var(--bg); -webkit-app-region: drag; }
.library-header > * { -webkit-app-region: no-drag; }
.library-header h1 { font-family: var(--font-serif); font-size: 26px; font-weight: 600; margin: 0; flex: 1; -webkit-app-region: drag; }
.library-search { width: 220px; height: 28px; border-radius: 7px; border: 1px solid var(--separator); background: var(--bg-2); padding: 0 10px; color: var(--text); outline: none; }
.library-search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.library-sort { height: 28px; border-radius: 7px; border: 1px solid var(--separator); background: var(--bg-2); color: var(--text); padding: 0 6px; }
.library h2 { font-size: 15px; font-weight: 600; margin: 26px 0 14px; }
.book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 28px 24px; }
.book-row { display: grid; grid-auto-flow: column; grid-auto-columns: 140px; gap: 24px; overflow-x: auto; padding-bottom: 6px; }
.book-tile { border: 0; background: transparent; padding: 0; text-align: left; cursor: default; }
.book-tile.disabled { opacity: 0.45; filter: grayscale(1); }
.book-cover { position: relative; aspect-ratio: 2 / 3; border-radius: 4px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,.12), 0 10px 24px rgba(0,0,0,.12); transition: transform .15s ease, box-shadow .15s ease; }
.book-tile:not(.disabled):hover .book-cover { transform: translateY(-3px); box-shadow: 0 4px 10px rgba(0,0,0,.14), 0 16px 32px rgba(0,0,0,.16); }
.book-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.book-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(0,0,0,.25); }
.book-progress > div { height: 100%; background: var(--accent); }
.book-title { margin-top: 10px; font-weight: 600; font-size: 13px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.book-author { margin-top: 2px; font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gen-cover { width: 100%; height: 100%; padding: 16px 12px; display: flex; flex-direction: column; justify-content: space-between; color: #fff; }
.gen-cover-title { font-family: var(--font-serif); font-size: 16px; font-weight: 600; line-height: 1.2; text-shadow: 0 1px 2px rgba(0,0,0,.2); }
.gen-cover-author { font-size: 11px; opacity: .85; }
.library-empty { margin-top: 80px; text-align: center; color: var(--text-2); font-size: 14px; line-height: 1.6; }
```

`src/renderer/src/views/LibraryView.tsx`:
```tsx
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
```

- [ ] **Step 6: Write the e2e test**

`tests/e2e/library.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('library shows all books, extracts real titles and covers, searches', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await expect(page.getByTestId('book-tile')).toHaveCount(4)
  await expect(page.getByTestId('book-tile').filter({ hasText: 'The Art of War' }).first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => page.evaluate(async () => (await window.api.library.list()).every(b => b.metadataExtracted || b.status !== 'ok')), { timeout: 30_000 }).toBe(true)
  await page.getByTestId('library-search').fill('zzzz-no-match')
  await expect(page.getByTestId('book-tile')).toHaveCount(0)
  await page.getByTestId('library-search').fill('')
  await page.getByTestId('book-tile').first().click()
  await expect(page.getByTestId('view-reader')).toBeVisible()
  await app.close()
})
```

- [ ] **Step 7: Run all the tests**

Run: `npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test tests/e2e/library.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/views/LibraryView.tsx src/renderer/src/library tests/unit/metadata.test.ts tests/e2e/library.spec.ts
git commit -m "feat(ui): library grid with covers, metadata extraction, search and sort"
```

---

### Task 10: Reader and highlighting (opus, wave 3a)

This is the hardest task: integrating foliate-js, mapping selections to CFIs, overlay drawing, re-anchoring and the popup. It's assigned to an **Opus** implementer.

**Files:**
- Replace stubs: `src/renderer/src/views/ReaderView.tsx`, `src/renderer/src/components/HighlightsPanel.tsx`
- Create: `src/renderer/src/reader/readerStyles.ts`, `src/renderer/src/reader/selection.ts`, `src/renderer/src/reader/anchor.ts`, `src/renderer/src/reader/lostAnchors.ts`, `src/renderer/src/reader/HighlightPopup.tsx`, `src/renderer/src/reader/ReaderToolbar.tsx`, `src/renderer/src/reader/ReaderSettingsMenu.tsx`, `src/renderer/src/reader/TocDrawer.tsx`, `src/renderer/src/reader/reader.css`
- Test: `tests/unit/readerStyles.test.ts`, `tests/unit/selection.test.ts`, `tests/e2e/reader.spec.ts`

**Interfaces:**
- Consumes: `useAppState`, `updateSettings`, `toast` (T8); `loadFoliateView`, `loadOverlayer`, `bookFile`, `FoliateTocItem` (T8); `emitReader`, `onReader` (T8 bus); `window.api.highlights.*`, `window.api.library.{saveProgress,markOpened,setStatus}`; `Highlight`, `HighlightColor`, `Settings`, `ReaderTheme`, `LIMITS` (shared).
- Produces:
  - `ReaderView({ bookId, target }: { bookId: string; target?: string })`. It emits `activity` on every relocate and every key or pointer input in the book, and `highlights-changed` after any highlight mutation. It listens for `goto`.
  - `HighlightsPanel({ bookId })`
  - `readerCss(s: Pick<Settings, 'readerTheme' | 'fontFamily' | 'fontSize' | 'lineHeight'>): string`, `READER_THEMES`, `HIGHLIGHT_FILL: Record<HighlightColor, string>`
  - `quoteFromRange(range: Range): TextQuote`, `contextFromRange(range: Range, max?: number): string`
  - `findQuoteRange(doc: Document, quote: TextQuote): Range | null`
  - `lostAnchors: { has(id: string): boolean; add(id: string): void; delete(id: string): void }`

**foliate-js facts (verified at the pinned commit):**
- `<foliate-view>`: `open(file)`, `init({ lastLocation, showTextStart })`, `goTo(cfi | href | index)`, `goLeft()`, `goRight()`, `addAnnotation({ value, color })` (re-adding the same value redraws it), `deleteAnnotation({ value })`, `getCFI(index, range)`, `resolveNavigation(cfi) → { index, anchor }` (may throw), `book` (`toc`, `metadata`, `sections`), `renderer` (`setStyles(css)`, attributes `flow`, `margin`, `gap`, `max-inline-size`, `max-column-count`), `lastLocation`, `close()`.
- Events: `load` `{ doc, index }`; `relocate` `{ fraction, cfi, tocItem, range }`; `create-overlay` `{ index }`; `draw-annotation` `{ draw, annotation, doc, range }` → call `draw(Overlayer.highlight, { color })`; `show-annotation` `{ value, index, range }` (fires when an existing highlight is clicked).
- All shadow roots are **closed**. Book content lives in `blob:` iframes, so use the `load` event's `doc` for listeners. In e2e, reach content through `page.frames()`.
- Highlight opacity comes from the CSS custom property `--overlayer-highlight-opacity`, which is inherited through shadow DOM; set it on the `<foliate-view>` element.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/readerStyles.test.ts`:
```ts
import { it, expect } from 'vitest'
import { readerCss, READER_THEMES } from '../../src/renderer/src/reader/readerStyles'

it('emits theme colors, font, size and line height', () => {
  const css = readerCss({ readerTheme: 'sepia', fontFamily: 'serif', fontSize: 20, lineHeight: 1.6 })
  expect(css).toContain(READER_THEMES.sepia.bg)
  expect(css).toContain(READER_THEMES.sepia.fg)
  expect(css).toContain('font-size: 20px')
  expect(css).toContain('line-height: 1.6')
  expect(css).toContain('New York')
  expect(readerCss({ readerTheme: 'night', fontFamily: 'sans', fontSize: 18, lineHeight: 1.5 })).toContain('color-scheme: dark')
})
```

`tests/unit/selection.test.ts`:
```ts
// @vitest-environment jsdom
import { it, expect } from 'vitest'
import { quoteFromRange, contextFromRange } from '../../src/renderer/src/reader/selection'
import { findQuoteRange } from '../../src/renderer/src/reader/anchor'

function docWith(html: string): Document {
  const d = document.implementation.createHTMLDocument('t')
  d.body.innerHTML = html
  return d
}

function rangeOf(d: Document, needle: string, occurrence = 0): Range {
  const r = findQuoteRange(d, { exact: needle, prefix: '', suffix: '' })
  if (!r) throw new Error('not found')
  if (occurrence === 0) return r
  throw new Error('unsupported')
}

it('quote captures prefix and suffix up to 64 chars', () => {
  const d = docWith('<p>Alpha beta gamma.</p><p>Delta epsilon zeta.</p>')
  const q = quoteFromRange(rangeOf(d, 'gamma.Delta'))
  expect(q.exact).toBe('gamma.Delta')
  expect(q.prefix).toBe('Alpha beta ')
  expect(q.suffix).toBe(' epsilon zeta.')
})

it('context is the enclosing paragraph, trimmed around the quote when long', () => {
  const d = docWith('<p>Short para with target words inside.</p>')
  expect(contextFromRange(rangeOf(d, 'target words'))).toBe('Short para with target words inside.')
  const long = 'x '.repeat(500) + 'needle here' + ' y'.repeat(500)
  const d2 = docWith(`<p>${long}</p>`)
  const ctx = contextFromRange(rangeOf(d2, 'needle here'), 100)
  expect(ctx.length).toBeLessThanOrEqual(100)
  expect(ctx).toContain('needle here')
})

it('findQuoteRange disambiguates repeated text with prefix/suffix', () => {
  const d = docWith('<p>the cat sat. the cat ran.</p>')
  const r = findQuoteRange(d, { exact: 'the cat', prefix: 'sat. ', suffix: ' ran' })!
  const pre = d.createRange()
  pre.setStart(d.body, 0)
  pre.setEnd(r.startContainer, r.startOffset)
  expect(pre.toString()).toBe('the cat sat. ')
  expect(r.toString()).toBe('the cat')
})

it('findQuoteRange spans element boundaries and returns null when absent', () => {
  const d = docWith('<p>one <em>two</em> three</p>')
  expect(findQuoteRange(d, { exact: 'one two three', prefix: '', suffix: '' })?.toString()).toBe('one two three')
  expect(findQuoteRange(d, { exact: 'four', prefix: '', suffix: '' })).toBeNull()
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/readerStyles.test.ts tests/unit/selection.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pure modules**

`src/renderer/src/reader/readerStyles.ts`:
```ts
import type { HighlightColor, ReaderTheme, Settings } from '../../../shared/types'

export const READER_THEMES: Record<ReaderTheme, { bg: string; fg: string; link: string; label: string }> = {
  white: { bg: '#ffffff', fg: '#1d1d1f', link: '#0a5fd6', label: 'White' },
  sepia: { bg: '#f8f1e3', fg: '#4f3d2a', link: '#8a5a19', label: 'Sepia' },
  gray: { bg: '#4a4a4d', fg: '#ececee', link: '#9ecbff', label: 'Gray' },
  night: { bg: '#121212', fg: '#c9c9cb', link: '#7fb4ff', label: 'Night' }
}

export const HIGHLIGHT_FILL: Record<HighlightColor, string> = {
  yellow: '#ffd60a',
  green: '#34c759',
  blue: '#0a84ff',
  pink: '#ff375f'
}

export function readerCss(s: Pick<Settings, 'readerTheme' | 'fontFamily' | 'fontSize' | 'lineHeight'>): string {
  const t = READER_THEMES[s.readerTheme]
  const dark = s.readerTheme === 'gray' || s.readerTheme === 'night'
  const family = s.fontFamily === 'serif'
    ? `'New York', 'Iowan Old Style', Charter, Georgia, serif`
    : `-apple-system, 'SF Pro Text', system-ui, sans-serif`
  return `
    html { color-scheme: ${dark ? 'dark' : 'light'}; }
    html, body { background: ${t.bg} !important; color: ${t.fg} !important; }
    body { font-family: ${family} !important; font-size: ${s.fontSize}px !important; line-height: ${s.lineHeight} !important; }
    p, li, blockquote, dd, div, span { font-family: inherit !important; line-height: ${s.lineHeight} !important; }
    body *:not(img):not(svg):not(svg *) { color: inherit !important; background-color: transparent !important; }
    a:any-link { color: ${t.link} !important; }
    img, svg, video { max-width: 100%; height: auto; }
    p { hyphens: auto; -webkit-hyphens: auto; }
    ::selection { background: rgba(10, 132, 255, 0.28); }
  `
}
```

`src/renderer/src/reader/selection.ts`:
```ts
import { LIMITS, type TextQuote } from '../../../shared/types'

const BLOCKS = 'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, figcaption, pre'

export function quoteFromRange(range: Range): TextQuote {
  const doc = range.startContainer.ownerDocument!
  const before = doc.createRange()
  before.setStart(doc.body, 0)
  before.setEnd(range.startContainer, range.startOffset)
  const after = doc.createRange()
  after.setStart(range.endContainer, range.endOffset)
  after.setEnd(doc.body, doc.body.childNodes.length)
  return {
    exact: range.toString(),
    prefix: before.toString().slice(-LIMITS.quoteAffixChars),
    suffix: after.toString().slice(0, LIMITS.quoteAffixChars)
  }
}

function closestBlock(n: Node): Element | null {
  const el = n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement
  return el?.closest(BLOCKS) ?? el?.closest('div, section, body') ?? null
}

export function contextFromRange(range: Range, max: number = LIMITS.contextChars): string {
  const exact = range.toString().replace(/\s+/g, ' ').trim()
  const text = (closestBlock(range.commonAncestorContainer)?.textContent ?? exact).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const i = text.indexOf(exact)
  if (i < 0) return exact.slice(0, max)
  const pad = Math.max(0, Math.floor((max - exact.length) / 2))
  const start = Math.max(0, Math.min(i - pad, text.length - max))
  return text.slice(start, start + max)
}
```

`src/renderer/src/reader/anchor.ts`:
```ts
import type { TextQuote } from '../../../shared/types'

function commonSuffix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

function commonPrefix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

// Finds the best occurrence of quote.exact in the document, scored by how well prefix/suffix match.
export function findQuoteRange(doc: Document, quote: TextQuote): Range | null {
  if (!quote.exact) return null
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  const starts: number[] = []
  let full = ''
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    starts.push(full.length)
    nodes.push(n as Text)
    full += (n as Text).data
  }
  let best = -1
  let bestScore = -1
  for (let i = full.indexOf(quote.exact); i >= 0; i = full.indexOf(quote.exact, i + 1)) {
    const score = commonSuffix(full.slice(0, i), quote.prefix) + commonPrefix(full.slice(i + quote.exact.length), quote.suffix)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  if (best < 0) return null
  const locate = (offset: number, isEnd: boolean): [Text, number] => {
    for (let k = 0; k < nodes.length; k++) {
      const s = starts[k]
      const e = s + nodes[k].data.length
      if (offset < e || (isEnd && offset === e)) return [nodes[k], offset - s]
    }
    const last = nodes[nodes.length - 1]
    return [last, last.data.length]
  }
  const range = doc.createRange()
  const [sn, so] = locate(best, false)
  const [en, eo] = locate(best + quote.exact.length, true)
  range.setStart(sn, so)
  range.setEnd(en, eo)
  return range
}
```

`src/renderer/src/reader/lostAnchors.ts`:
```ts
const lost = new Set<string>()
export const lostAnchors = {
  has: (id: string): boolean => lost.has(id),
  add: (id: string): void => void lost.add(id),
  delete: (id: string): void => void lost.delete(id)
}
```

- [ ] **Step 4: Run the unit tests and confirm they pass**

Run: `npx vitest run tests/unit/readerStyles.test.ts tests/unit/selection.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement ReaderView**

`src/renderer/src/views/ReaderView.tsx` must implement exactly this behavior, using the code skeleton below:

1. **Open:** `loadFoliateView()`, `loadOverlayer()`, `bookFile(bookId)`. Create a `<foliate-view>` inside `.reader-host` and set the style `--overlayer-highlight-opacity: 0.35`. Add listeners (load, relocate, create-overlay, draw-annotation, show-annotation) **before** `open(file)`. If `open` fails, call `setStatus(bookId, err.name === 'UnsupportedTypeError' ? 'unsupported' : 'error', err.message)`, show a toast, and navigate to the library.
2. **Apply settings** after open and whenever `state.settings` changes: `view.renderer.setStyles?.(readerCss(settings))`, `flow` = settings.flow, `margin` = `56px`, `gap` = `7%`, `max-inline-size` = `680px`, `max-column-count` = `2`. For fixed-layout books (`view.isFixedLayout`) with the gray or night theme, add class `invert-pages` on the host. CSS: `.reader-host.invert-pages foliate-view::part(filter) { filter: invert(1) hue-rotate(180deg) }`.
3. **Load highlights** with `api.highlights.list(bookId)` into `byValue: Map<cfi, Highlight>` before `init`.
4. **Init:** `view.init({ lastLocation: target ?? book.location ?? undefined, showTextStart: !(target ?? book.location) })`, then `api.library.markOpened(bookId)`.
5. **`load` event:** store `docs.set(index, doc)`. On `doc`, add `keydown` (←/→), `pointerup` (check the selection after 10 ms), `pointerdown` (close popup) and `mousemove`/`wheel` (activity + show chrome).
6. **`relocate`:** update `fraction`, `chapter` (`tocItem?.label ?? ''`) and the current CFI. Debounce `saveProgress(bookId, cfi, fraction)` by 1000 ms. `emitReader('activity', { bookId })`. Flush the pending save on unmount.
7. **`create-overlay` `{ index }`:** for every highlight in `byValue`, try `view.resolveNavigation(h.location)`. If it resolves to this `index`, `anchor(doc)` produces a range. If the range text (whitespace-normalized) equals `h.quote.exact` (normalized), call `view.addAnnotation({ value: h.location, color: h.color })`. Otherwise run `findQuoteRange(doc, h.quote)`. If that's found, compute `newCfi = view.getCFI(index, range)`, update with `api.highlights.update(bookId, h.id, { location: newCfi })`, re-key `byValue`, add the annotation and `lostAnchors.delete(h.id)`. If not found, `lostAnchors.add(h.id)`. Also, for highlights in `lostAnchors`, try `findQuoteRange` in this doc and recover the same way. If any recovery or loss happened, `emitReader('highlights-changed', { bookId })`.
8. **`draw-annotation`:** `draw(Overlayer.highlight, { color: HIGHLIGHT_FILL[annotation.color] })`.
9. **Selection → popup (new mode):** `sel = doc.getSelection()`. Skip if collapsed or `!text.trim()`. Compute the rect in viewport coordinates as `range.getBoundingClientRect()` offset by `doc.defaultView.frameElement.getBoundingClientRect()`. Show `HighlightPopup` with 4 color dots, Note and Copy.
10. **Create highlight (dot click):** if `range.toString().length > LIMITS.exactMaxChars`, toast "Selection is too long to highlight" and stop. Otherwise `cfi = view.getCFI(index, range)` and `api.highlights.add(bookId, { location: cfi, quote: quoteFromRange(range), context: contextFromRange(range), chapter: chapter || null, position: fraction, color, note })`. Then `byValue.set`, `view.addAnnotation({ value: cfi, color })`, `doc.getSelection()?.removeAllRanges()`, close the popup and `emitReader('highlights-changed')`. The Note button expands a textarea inside the popup. Saving creates the highlight in the last-used color (default yellow) with that note.
11. **`show-annotation` `{ value, range }` → popup (edit mode)** for `byValue.get(value)`: color dots (current one ringed), a note textarea pre-filled (Save button), and Delete. A color change calls `api.highlights.update` then `view.addAnnotation({ value, color })`. Delete calls `api.highlights.remove`, then `view.deleteAnnotation({ value })` and `byValue.delete`. Every mutation emits `highlights-changed`.
12. **Keyboard and swipe:** window and doc `keydown`: ArrowLeft → `goLeft()`, ArrowRight → `goRight()`, Escape → close the popup or TOC. Ignore when the event target is an input or textarea. In paginated flow, a horizontal trackpad swipe (window and doc `wheel` events where `|deltaX| > |deltaY|`, accumulated past 60 px within 300 ms) turns the page once per gesture.
13. **Bus:** `onReader('goto', ({ target }) => view.goTo(target))`.
14. **Chrome auto-hide:** the toolbar and footer are visible on mouse move and fade out after 2000 ms without input (CSS opacity transition). They stay visible while the popup, TOC or settings menu is open.
15. **Unmount:** flush the progress save, `view.close()`, `view.remove()`, `emitReader('closed', { bookId })`.

Skeleton (fill in the numbered behaviors exactly):
```tsx
import { useEffect, useRef, useState } from 'react'
import type { Highlight, HighlightColor } from '../../../shared/types'
import { LIMITS } from '../../../shared/types'
import { useAppState } from '../state/appState'
import { toast } from '../state/actions'
import { bookFile, loadFoliateView, loadOverlayer, type FoliateTocItem } from '../reader/foliate'
import { emitReader, onReader } from '../reader/bus'
import { HIGHLIGHT_FILL, readerCss } from '../reader/readerStyles'
import { contextFromRange, quoteFromRange } from '../reader/selection'
import { findQuoteRange } from '../reader/anchor'
import { lostAnchors } from '../reader/lostAnchors'
import { HighlightPopup, type PopupState } from '../reader/HighlightPopup'
import { ReaderToolbar } from '../reader/ReaderToolbar'
import { TocDrawer } from '../reader/TocDrawer'
import '../reader/reader.css'

type FoliateView = HTMLElement & {
  open(f: File): Promise<void>
  init(o: { lastLocation?: string; showTextStart?: boolean }): Promise<void>
  goTo(t: string | number): Promise<unknown>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  addAnnotation(a: { value: string; color?: HighlightColor }): Promise<unknown>
  deleteAnnotation(a: { value: string }): Promise<unknown>
  getCFI(index: number, range: Range): string
  resolveNavigation(t: string): { index: number; anchor: (doc: Document) => Range | null }
  close(): void
  isFixedLayout: boolean
  book: { toc?: FoliateTocItem[] }
  renderer: HTMLElement & { setStyles?: (css: string) => void }
}

export function ReaderView({ bookId, target }: { bookId: string; target?: string }) {
  const { state, dispatch } = useAppState()
  const book = state.books.find(b => b.id === bookId)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const docs = useRef(new Map<number, Document>())
  const byValue = useRef(new Map<string, Highlight>())
  const position = useRef({ fraction: 0, cfi: '', chapter: '' })
  const [toc, setToc] = useState<FoliateTocItem[]>([])
  const [chapter, setChapter] = useState('')
  const [fraction, setFraction] = useState(0)
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [chrome, setChrome] = useState(true)
  // ... behaviors 1–15 ...
  return (
    <div className={`reader theme-${state.settings?.readerTheme ?? 'white'} ${chrome ? '' : 'chrome-hidden'}`} data-testid="view-reader">
      <ReaderToolbar title={book?.title ?? ''} chapter={chapter} onBack={() => dispatch({ type: 'navigate', view: { name: 'library' } })} onToc={() => setTocOpen(o => !o)} />
      <div className="reader-host" ref={hostRef} />
      <footer className="reader-footer"><span>{chapter}</span><span>{Math.round(fraction * 100)}%</span></footer>
      {tocOpen && <TocDrawer toc={toc} onPick={href => { void viewRef.current?.goTo(href); setTocOpen(false) }} onClose={() => setTocOpen(false)} />}
      {popup && <HighlightPopup state={popup} onClose={() => setPopup(null)} />}
    </div>
  )
}
```

`HighlightPopup.tsx`: fixed-position card, centered horizontally on the selection rect and placed above it (below if the rect is under 80 px from the top). Background `var(--bg-elevated)`, radius 12, `var(--shadow-l)`. Row: 4 dots (22 px circles, `--dot-*` colors, `data-testid="hl-color-<color>"`), divider, a Note icon button (`data-testid="hl-note"`), Copy (new mode) or Trash (edit mode, `data-testid="hl-delete"`). An expanded note area holds a textarea (`data-testid="hl-note-input"`) and Save (`data-testid="hl-note-save"`). `PopupState = { mode: 'new'; rect: DOMRect; onColor(c): void; onNote(note: string): void; onCopy(): void } | { mode: 'edit'; rect: DOMRect; highlight: Highlight; onColor(c): void; onNote(note: string): void; onDelete(): void }`. The popup root has `data-testid="hl-popup"`.

`ReaderToolbar.tsx`: a top bar 44 px high (drag region; buttons no-drag), with `ChevronLeft` "Library" (`data-testid="reader-back"`), centered title and chapter (muted), and on the right `List` (TOC, `data-testid="reader-toc"`) and `Type` (opens `ReaderSettingsMenu`, `data-testid="reader-settings"`). It leaves room for the macOS traffic lights by padding left 80 px when the sidebar is hidden. The sidebar stays visible in this app, so a 12 px padding is enough.

`ReaderSettingsMenu.tsx`: a popover with 4 round theme swatches (`READER_THEMES`, `data-testid="theme-<name>"`), font toggle Serif/Sans, size A−/A+ (14–28, step 1), line spacing segmented 1.35/1.55/1.8, and layout Pages/Scroll. Each change calls `updateSettings(dispatch, patch)`.

`TocDrawer.tsx`: a left overlay 300 px wide inside `.reader`, with nested `toc` items indented 14 px per level; clicking calls `onPick(href)`. Escape closes it.

`reader.css` (key rules):
```css
.reader { position: absolute; inset: 0; display: flex; flex-direction: column; }
.reader.theme-white { background: #fff; } .reader.theme-sepia { background: #f8f1e3; }
.reader.theme-gray { background: #4a4a4d; color: #ececee; } .reader.theme-night { background: #121212; color: #c9c9cb; }
.reader-host { flex: 1; min-height: 0; position: relative; }
.reader-host foliate-view { position: absolute; inset: 0; }
.reader-host.invert-pages foliate-view::part(filter) { filter: invert(1) hue-rotate(180deg); }
.reader-toolbar, .reader-footer { transition: opacity .3s ease; }
.reader.chrome-hidden .reader-toolbar, .reader.chrome-hidden .reader-footer { opacity: 0; }
.reader-footer { height: 30px; display: flex; justify-content: space-between; align-items: center; padding: 0 24px; font-size: 11px; opacity: .55; }
```

- [ ] **Step 6: Implement HighlightsPanel**

`src/renderer/src/components/HighlightsPanel.tsx`: loads `api.highlights.list(bookId)`. It refreshes on `onReader('highlights-changed')` for this book and on `window.api.on.reviewChanged`. It groups by `chapter` in position order. Each item (`data-testid="hl-item"`) shows a 3 px left border in the color dot, the quote clamped to 4 lines in the serif font, the note in muted italic if present, and a "location lost" muted tag if `lostAnchors.has(id)`. Clicking calls `emitReader('goto', { target: h.location })`. The empty state says "No highlights yet. Select text to highlight."

- [ ] **Step 7: Write the e2e test**

`tests/e2e/reader.spec.ts`:
```ts
import { test, expect, type Page, type Frame } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

async function openBook(page: Page, format: string): Promise<string> {
  const id = await page.evaluate(async f => (await window.api.library.list()).find(b => b.format === f)!.id, format)
  await page.locator(`[data-book-id="${id}"]`).click()
  await expect(page.getByTestId('view-reader')).toBeVisible()
  return id
}

async function contentFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().filter(f => f.url().startsWith('blob:')).length, { timeout: 20_000 }).toBeGreaterThan(0)
  for (let i = 0; i < 40; i++) {
    for (const f of page.frames().filter(f => f.url().startsWith('blob:'))) {
      const len = await f.evaluate(() => document.body?.innerText.trim().length ?? 0).catch(() => 0)
      if (len > 200) return f
    }
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(250)
  }
  throw new Error('no content frame with text')
}

test('EPUB: read, highlight, persist across restart, review card appears', async () => {
  const library = await makeLibrary()
  let { app, page } = await launchApp({ library })
  const id = await openBook(page, 'epub')
  const frame = await contentFrame(page)
  const selected = await frame.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find(x => (x.textContent ?? '').trim().split(/\s+/).length > 8)!
    const text = p.firstChild as Text
    const r = document.createRange()
    r.setStart(text, 0)
    r.setEnd(text, Math.min(40, text.data.length))
    const sel = document.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    return r.toString()
  })
  await expect(page.getByTestId('hl-popup')).toBeVisible()
  await page.getByTestId('hl-color-green').click()
  await expect.poll(() => page.evaluate(b => window.api.highlights.list(b).then(h => h.length), id)).toBe(1)
  const saved = await page.evaluate(b => window.api.highlights.list(b), id)
  expect(saved[0].quote.exact).toBe(selected)
  expect(saved[0].location).toMatch(/^epubcfi\(/)
  await expect(page.getByTestId('hl-item')).toHaveCount(1)
  await expect(page.getByTestId('due-badge')).toHaveText('1')
  await app.close()

  ;({ app, page } = await launchApp({ library }))
  await openBook(page, 'epub')
  await page.getByTestId('nav-highlights').click()
  await expect(page.getByTestId('hl-item')).toHaveCount(1)
  await app.close()
})

for (const format of ['mobi', 'azw3', 'pdf']) {
  test(`${format.toUpperCase()} opens and renders text`, async () => {
    const library = await makeLibrary()
    const { app, page } = await launchApp({ library })
    await openBook(page, format)
    await contentFrame(page)
    await expect(page.getByTestId('view-reader')).toBeVisible()
    await app.close()
  })
}

test('reading position is restored', async () => {
  const library = await makeLibrary()
  let { app, page } = await launchApp({ library })
  const id = await openBook(page, 'epub')
  await contentFrame(page)
  for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200) }
  await page.waitForTimeout(1500)
  const before = await page.evaluate(async b => (await window.api.library.list()).find(x => x.id === b)!.location, id)
  expect(before).toMatch(/^epubcfi\(/)
  await app.close()
  ;({ app, page } = await launchApp({ library }))
  await openBook(page, 'epub')
  await page.waitForTimeout(1500)
  const after = await page.evaluate(async b => (await window.api.library.list()).find(x => x.id === b)!.progress, id)
  expect(after).toBeGreaterThan(0)
  await app.close()
})
```

- [ ] **Step 8: Run all the tests**

Run: `npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test tests/e2e/reader.spec.ts`
Expected: PASS. This spec clicks T9's `[data-book-id]` tiles. If T9 isn't merged into this worktree yet, run only the unit tests and typecheck here, and the controller runs this e2e test after merging both. If the PDF fixture fails because foliate's pdf.js adapter can't fetch its CSS under `app://`, fix the `app://` protocol handler (content types / CORS) in `src/main/index.ts` rather than skipping the test, and report the change to the controller.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/views/ReaderView.tsx src/renderer/src/components/HighlightsPanel.tsx src/renderer/src/reader tests/unit/readerStyles.test.ts tests/unit/selection.test.ts tests/e2e/reader.spec.ts
git commit -m "feat(ui): foliate reader with themes, TOC, highlights, re-anchoring and highlights panel"
```

---
### Task 11: Review UI (sonnet, wave 3a)

**Files:**
- Replace stub: `src/renderer/src/views/ReviewView.tsx`
- Create: `src/renderer/src/review/session.ts`, `src/renderer/src/review/ReviewCardView.tsx`, `src/renderer/src/review/review.css`
- Test: `tests/unit/reviewSession.test.ts`, `tests/e2e/review.spec.ts`

**Interfaces:**
- Consumes: `useAppState`, `refreshDueCount` (T8); `window.api.review.*`, `window.api.sessions.log`; `ReviewCard`, `Rating`, `ReviewLogEntry` (shared).
- Produces: `sessionReducer(s: SessionState, a: SessionAction): SessionState`, `initialSession`, `type SessionState = { cards: ReviewCard[]; index: number; revealed: boolean; shownAt: number; results: ReviewLogEntry[]; startedAt: number | null; phase: 'loading' | 'card' | 'done' | 'empty' }`.

- [ ] **Step 1: Write the failing reducer test**

`tests/unit/reviewSession.test.ts`:
```ts
import { it, expect } from 'vitest'
import { sessionReducer, initialSession, summarize } from '../../src/renderer/src/review/session'
import type { ReviewCard, ReviewLogEntry } from '../../src/shared/types'

const card = (id: string): ReviewCard => ({ highlightId: id, bookId: 'b', bookTitle: 'B', chapter: null, location: 'cfi', promptType: 'cloze', prompt: 'p', answer: 'a', note: null, aiAnswer: null, isNew: true })
const entry = (r: number, ms: number): ReviewLogEntry => ({ ts: '', highlightId: 'h', bookId: 'b', rating: 'good', promptType: 'cloze', durationMs: ms, retrievabilityBefore: r, wasNew: false })

it('walks loading → card → reveal → next → done', () => {
  let s = sessionReducer(initialSession, { type: 'loaded', cards: [card('1'), card('2')], now: 1000 })
  expect(s).toMatchObject({ phase: 'card', index: 0, revealed: false, shownAt: 1000, startedAt: 1000 })
  s = sessionReducer(s, { type: 'reveal' })
  expect(s.revealed).toBe(true)
  s = sessionReducer(s, { type: 'rated', entry: entry(0.8, 4000), now: 6000 })
  expect(s).toMatchObject({ index: 1, revealed: false, shownAt: 6000 })
  s = sessionReducer(s, { type: 'rated', entry: entry(0.6, 2000), now: 9000 })
  expect(s.phase).toBe('done')
  expect(summarize(s)).toEqual({ count: 2, minutes: 0.1, avgRetrievability: 0.7 })
})

it('empty queue goes to empty; more cards can be appended after done', () => {
  expect(sessionReducer(initialSession, { type: 'loaded', cards: [], now: 0 }).phase).toBe('empty')
  let s = sessionReducer(initialSession, { type: 'loaded', cards: [card('1')], now: 0 })
  s = sessionReducer(s, { type: 'rated', entry: entry(0, 1000), now: 1000 })
  expect(s.phase).toBe('done')
  s = sessionReducer(s, { type: 'more', cards: [card('9')], now: 2000 })
  expect(s).toMatchObject({ phase: 'card', index: 1, shownAt: 2000 })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/reviewSession.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `session.ts`**

```ts
import type { ReviewCard, ReviewLogEntry } from '../../../shared/types'

export interface SessionState {
  cards: ReviewCard[]
  index: number
  revealed: boolean
  shownAt: number
  results: ReviewLogEntry[]
  startedAt: number | null
  phase: 'loading' | 'card' | 'done' | 'empty'
}

export type SessionAction =
  | { type: 'loaded'; cards: ReviewCard[]; now: number }
  | { type: 'reveal' }
  | { type: 'rated'; entry: ReviewLogEntry; now: number }
  | { type: 'more'; cards: ReviewCard[]; now: number }

export const initialSession: SessionState = { cards: [], index: 0, revealed: false, shownAt: 0, results: [], startedAt: null, phase: 'loading' }

export function sessionReducer(s: SessionState, a: SessionAction): SessionState {
  switch (a.type) {
    case 'loaded':
      return a.cards.length
        ? { ...initialSession, cards: a.cards, phase: 'card', shownAt: a.now, startedAt: a.now }
        : { ...initialSession, phase: 'empty' }
    case 'reveal':
      return s.phase === 'card' ? { ...s, revealed: true } : s
    case 'rated': {
      const results = [...s.results, a.entry]
      const index = s.index + 1
      return index < s.cards.length
        ? { ...s, results, index, revealed: false, shownAt: a.now }
        : { ...s, results, index, revealed: false, phase: 'done' }
    }
    case 'more':
      return a.cards.length ? { ...s, cards: [...s.cards, ...a.cards], phase: 'card', revealed: false, shownAt: a.now } : s
  }
}

export function summarize(s: SessionState): { count: number; minutes: number; avgRetrievability: number } {
  const count = s.results.length
  const ms = s.results.reduce((a, r) => a + r.durationMs, 0)
  const avg = count ? s.results.reduce((a, r) => a + r.retrievabilityBefore, 0) / count : 0
  return { count, minutes: Math.round((ms / 60000) * 10) / 10, avgRetrievability: Math.round(avg * 100) / 100 }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/unit/reviewSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the view**

`src/renderer/src/views/ReviewView.tsx` behavior (the root element always has `data-testid="view-review"`):
- On mount: `api.review.queue()` → `loaded` with `Date.now()`. Also `api.review.promptIssues()`. If `invalidLines + unknownHighlightIds > 0`, show a muted line at the bottom: "N lines in knowledge/prompts.jsonl were skipped."
- Keys (window `keydown`, ignored inside inputs): **Space** → reveal (`preventDefault`). After reveal, **1/2/3/4** → rate again/hard/good/easy. **⌘O** → open in book.
- Rate: `entry = await api.review.rate(card.highlightId, rating, Date.now() - shownAt, card.promptType)`, then dispatch `rated`, then `refreshDueCount`.
- When `phase` becomes `done`, call `api.review.queue()` once more, filtered to ids not already in `cards`. If any remain (learning steps now due), dispatch `more`.
- Session logging: when the view unmounts or reaches `done`/`empty` with ≥1 result, call `api.sessions.log({ start: new Date(startedAt).toISOString(), end: new Date().toISOString(), kind: 'review', bookId: null, pomodoro: false })` exactly once per session (use a ref guard).
- **Open in book:** `dispatch({ type: 'navigate', view: { name: 'reader', bookId: card.bookId, target: card.location } })`.
- Empty state (`data-testid="review-empty"`): a large check icon, "You're all caught up", and a muted line "Highlight while reading — each highlight becomes a card."
- Done state (`data-testid="review-done"`): "Session complete", then three stat tiles (Cards / Minutes / Avg. recall before review as a %), and a Back to Library button.

`src/renderer/src/review/ReviewCardView.tsx` layout (`data-testid="review-card"`):
- Top meta row (muted, 12 px): book title · chapter, plus a small tag "AI question" / "Your question" / "Fill in the blank" by `promptType`, and "New" if `isNew`. Right side: "3 / 12" progress.
- Front (`data-testid="review-prompt"`): `prompt` in the serif font, 22 px, line-height 1.5, max-width 640 px, centered. For cloze, render `▁▁▁▁ (~N words)` as an inline pill (accent-soft background) by splitting on the `▁▁▁▁` token.
- Before reveal: a bottom hint "Recall it, then press **Space**" and a Show Answer button (`data-testid="review-reveal"`).
- After reveal (`data-testid="review-answer"`): a separator, the highlight `answer` in serif 18 px with a left border in the accent color, the note in italic if present, and `aiAnswer` under the label "Model answer" if present. Then 4 rating buttons in a row (`data-testid="rate-again|hard|good|easy"`), each showing its key number. Colors: Again red-tinted, Hard orange-tinted, Good green-tinted, Easy blue-tinted (soft backgrounds, not saturated). Then an "Open in book ⌘O" ghost button (`data-testid="review-open"`).
- The card enters with a 150 ms fade/translate. Respect `prefers-reduced-motion`.

`review.css`: center the card in the content area (`display: grid; place-items: center; height: 100%; padding: 48px`). Card width `min(720px, 100%)`, padding 40 px, using the `.card` style from global.css.

- [ ] **Step 6: Write the e2e test**

`tests/e2e/review.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp, makeLibrary } from './helpers'

test('review a cloze card, then an AI question written by an agent appears', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  const ids = await page.evaluate(async () => {
    const book = (await window.api.library.list()).find(b => b.format === 'epub')!
    const mk = (exact: string) => window.api.highlights.add(book.id, {
      location: 'epubcfi(/6/4)', quote: { exact, prefix: '', suffix: '' }, context: `Sun Tzu said: ${exact} is vital.`,
      chapter: 'Laying Plans', position: 0.01, color: 'yellow', note: null
    })
    const a = await mk('the art of war')
    const b = await mk('moral law')
    return [a.id, b.id]
  })
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('review-prompt')).toContainText('Sun Tzu said:')
  await page.keyboard.press('Space')
  await expect(page.getByTestId('review-answer')).toBeVisible()
  await page.keyboard.press('3')
  await expect(page.getByTestId('review-prompt')).toBeVisible()

  await appendFile(join(library, 'knowledge/prompts.jsonl'),
    JSON.stringify({ highlightId: ids[1], question: 'What is the first of the five constant factors?', answer: 'The Moral Law', by: 'distill' }) + '\n')
  await page.getByTestId('nav-library').click()
  await page.waitForTimeout(1500)
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('review-prompt')).toContainText('first of the five constant factors')
  await page.getByTestId('review-reveal').click()
  await expect(page.getByTestId('review-answer')).toContainText('The Moral Law')
  await page.getByTestId('rate-good').click()
  await expect(page.getByTestId('review-done')).toBeVisible()
  const log = await page.evaluate(() => window.api.stats.get())
  expect(log.K).toBeGreaterThan(0)
  await app.close()
})

test('open in book navigates to the reader', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await page.evaluate(async () => {
    const book = (await window.api.library.list()).find(b => b.format === 'epub')!
    await window.api.highlights.add(book.id, {
      location: 'epubcfi(/6/4)', quote: { exact: 'x y', prefix: '', suffix: '' }, context: 'a x y b',
      chapter: null, position: 0, color: 'blue', note: 'What is x y?'
    })
  })
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('review-prompt')).toHaveText('What is x y?')
  await page.keyboard.press('Space')
  await page.getByTestId('review-open').click()
  await expect(page.getByTestId('view-reader')).toBeVisible()
  await app.close()
})
```

- [ ] **Step 7: Run all the tests**

Run: `npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test tests/e2e/review.spec.ts`
Expected: PASS. (The `view-reader` test id is present in both the T8 stub and the real T10 view.)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/views/ReviewView.tsx src/renderer/src/review tests/unit/reviewSession.test.ts tests/e2e/review.spec.ts
git commit -m "feat(ui): keyboard-first FSRS review with AI/note/cloze prompts and session summary"
```

---

### Task 12: Terminal panel (sonnet, wave 3a)

**Files:**
- Replace stub: `src/renderer/src/terminal/TerminalPanel.tsx`
- Create: `src/renderer/src/terminal/xtermTheme.ts`, `src/renderer/src/terminal/terminal.css`
- Test: `tests/unit/xtermTheme.test.ts`, `tests/e2e/terminal.spec.ts`

**Interfaces:**
- Consumes: `useAppState`, `updateSettings` (T8); `window.api.pty.*`; `READER_THEMES` is **not** imported (T10 runs in parallel). The terminal follows the system light/dark preference instead.
- Produces: `TerminalPanel({ visible }: { visible: boolean })`, `xtermTheme(dark: boolean): ITheme`, `WELCOME_LINE: string`.

- [ ] **Step 1: Write the failing unit test**

`tests/unit/xtermTheme.test.ts`:
```ts
import { it, expect } from 'vitest'
import { xtermTheme, WELCOME_LINE } from '../../src/renderer/src/terminal/xtermTheme'

it('provides distinct light and dark themes and a welcome hint', () => {
  expect(xtermTheme(true).background).not.toBe(xtermTheme(false).background)
  expect(xtermTheme(false).foreground).toBeTruthy()
  expect(WELCOME_LINE).toContain('claude')
  expect(WELCOME_LINE).toContain('codex')
  expect(WELCOME_LINE).toContain('gemini')
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/xtermTheme.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `xtermTheme.ts`**

```ts
import type { ITheme } from '@xterm/xterm'

export const WELCOME_LINE =
  '\x1b[2mSmart Reader · this terminal opens in your books folder. Run \x1b[0m\x1b[1mclaude\x1b[0m\x1b[2m, \x1b[0m\x1b[1mcodex\x1b[0m\x1b[2m or \x1b[0m\x1b[1mgemini\x1b[0m\x1b[2m to start your coach (try "distill my new highlights").\x1b[0m\r\n'

export function xtermTheme(dark: boolean): ITheme {
  return dark
    ? {
        background: '#1c1c1e', foreground: '#e5e5ea', cursor: '#0a84ff', selectionBackground: '#0a84ff55',
        black: '#1c1c1e', red: '#ff6961', green: '#7ee787', yellow: '#ffd60a', blue: '#64a8ff', magenta: '#d2a8ff',
        cyan: '#76e4f7', white: '#e5e5ea', brightBlack: '#6e6e73', brightWhite: '#ffffff'
      }
    : {
        background: '#fbfbfd', foreground: '#1d1d1f', cursor: '#0a84ff', selectionBackground: '#0a84ff33',
        black: '#1d1d1f', red: '#d70015', green: '#248a3d', yellow: '#a05a00', blue: '#0040dd', magenta: '#8944ab',
        cyan: '#0071a4', white: '#6e6e73', brightBlack: '#8e8e93', brightWhite: '#1d1d1f'
      }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/unit/xtermTheme.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the panel**

`src/renderer/src/terminal/TerminalPanel.tsx` behavior:
- Keep it mounted while hidden (the parent mounts it after the first open). Hide it with `display: none` when `!visible` so sessions survive toggling. When it becomes visible, refit and focus the active terminal.
- **Tabs:** state `tabs: Array<{ key: number; ptyId: string | null; exited: boolean; title: string }>`. Start with one tab. A "+" button (`data-testid="term-new-tab"`) adds a tab; each tab has a close "×". Closing the last tab hides the panel (`dispatch({ type: 'toggleTerminal', open: false })`) and recreates a fresh tab next time.
- **Per tab:** create `new Terminal({ fontFamily: "'SF Mono', Menlo, monospace", fontSize: 12.5, lineHeight: 1.2, cursorBlink: true, allowProposedApi: true, theme: xtermTheme(darkMql.matches), scrollback: 5000 })` with a `FitAddon`. `open()` it into the tab's div. Write `WELCOME_LINE`. Then `ptyId = await api.pty.create(term.cols, term.rows)`; `term.onData(d => api.pty.write(ptyId, d))`. If `create` rejects, write `\x1b[31mCould not start a shell: <message>\x1b[0m` into that tab, mark it exited, and let Enter retry.
- A **global subscription** (once, in the panel) to `api.pty.onData((id, data) => termFor(id)?.write(data))` and `api.pty.onExit((id) => mark the tab exited and write '\r\n\x1b[2m[Process exited — press Enter to restart]\x1b[0m\r\n')`. In an exited tab, Enter (via `term.onData` seeing `'\r'`) creates a new pty for the same xterm.
- **Resize:** a `ResizeObserver` on the panel body calls `fit.fit()` then `api.pty.resize(ptyId, term.cols, term.rows)` (debounced 50 ms).
- **Panel size:** a drag handle on the top edge (bottom position) or left edge (right position) adjusts the height (default 280, min 120, max 80% of the window) or width (default 420, min 260). Persist to `localStorage` key `sr.terminal.size.<position>` inside try/catch.
- **Header** (28 px, `data-testid="terminal-panel"` on the root): tabs on the left; on the right a position toggle button (bottom ⇄ right, calls `updateSettings(dispatch, { terminalPosition })`) and a hide button (`dispatch({ type: 'toggleTerminal', open: false })`).
- **Theme:** listen to `matchMedia('(prefers-color-scheme: dark)')` changes and set `term.options.theme = xtermTheme(matches)`.
- **Cleanup on unmount:** `api.pty.kill` for every tab, then dispose the terminals.
- Import `@xterm/xterm/css/xterm.css` and `./terminal.css`.

`terminal.css`: `.terminal-panel { display: flex; flex-direction: column; border-top: 1px solid var(--separator); background: var(--bg-2); }` (for the right position use `border-left`). Tab styling: compact pills like the sidebar items. The xterm body gets `padding: 6px 0 0 10px; flex: 1; min-height: 0;`.

- [ ] **Step 6: Write the e2e test**

`tests/e2e/terminal.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('terminal opens in the books folder, runs commands, survives toggle, supports tabs', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  const toggle = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('event:menu', { type: 'toggle-terminal' }))
  await toggle()
  const panel = page.getByTestId('terminal-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.xterm-rows')).toContainText('Smart Reader')
  await panel.locator('.xterm').click()
  await page.keyboard.type('pwd && echo SR_TERMINAL_OK\n')
  await expect(panel.locator('.xterm-rows')).toContainText('SR_TERMINAL_OK', { timeout: 15_000 })
  await expect(panel.locator('.xterm-rows')).toContainText(library.split('/').pop()!)
  await toggle()
  await expect(panel).toBeHidden()
  await toggle()
  await expect(panel.locator('.xterm-rows')).toContainText('SR_TERMINAL_OK')
  await page.getByTestId('term-new-tab').click()
  await expect(panel.locator('.xterm')).toHaveCount(2)
  await app.close()
})
```

- [ ] **Step 7: Run all the tests**

Run: `npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test tests/e2e/terminal.spec.ts`
Expected: PASS. (`.xterm-rows` exists with the default DOM renderer; don't enable the WebGL addon.)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/terminal tests/unit/xtermTheme.test.ts tests/e2e/terminal.spec.ts
git commit -m "feat(ui): embedded xterm terminal with tabs, resize, restart and theming"
```

---

### Task 13: Pomodoro and reading-session tracking (sonnet, wave 3b)

**Files:**
- Replace stubs: `src/renderer/src/pomodoro/PomodoroProvider.tsx`, `src/renderer/src/sessions/useReadingTracker.ts`
- Create: `src/renderer/src/pomodoro/machine.ts`, `src/renderer/src/pomodoro/chime.ts`, `src/renderer/src/pomodoro/BreakOverlay.tsx`, `src/renderer/src/pomodoro/pomodoro.css`, `src/renderer/src/sessions/tracker.ts`
- Test: `tests/unit/pomodoro.test.ts`, `tests/unit/tracker.test.ts`, `tests/e2e/pomodoro.spec.ts`

**Interfaces:**
- Consumes: `useAppState`, `updateSettings`, `refreshDueCount` (T8); `onReader` (`activity`, `closed`) from the T8 bus; `window.api.sessions.log`; `PomodoroSettings` (shared).
- Produces (same export names as the T8 stub): `PomodoroProvider`, `PomodoroControl`, `usePomodoro(): { phase; running; remainingMs; toggle(); skip(); reset() }`, `useReadingTracker(): void`. Pure: `pomodoroReducer`, `initialPomodoro`, `ReadingSessionTracker`.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/pomodoro.test.ts`:
```ts
import { it, expect } from 'vitest'
import { pomodoroReducer, initialPomodoro, remaining } from '../../src/renderer/src/pomodoro/machine'
import { DEFAULT_SETTINGS } from '../../src/shared/types'

const cfg = { ...DEFAULT_SETTINGS.pomodoro, longEvery: 2 }
const MIN = 60_000

it('start → work runs; pause/resume preserve remaining time', () => {
  let { state } = pomodoroReducer(initialPomodoro, { type: 'start', now: 0, cfg })
  expect(state).toMatchObject({ phase: 'work', running: true, endsAt: 25 * MIN })
  ;({ state } = pomodoroReducer(state, { type: 'pause', now: 5 * MIN, cfg }))
  expect(state).toMatchObject({ running: false, remainingMs: 20 * MIN })
  expect(remaining(state, 99 * MIN)).toBe(20 * MIN)
  ;({ state } = pomodoroReducer(state, { type: 'start', now: 10 * MIN, cfg }))
  expect(state.endsAt).toBe(30 * MIN)
})

it('work end auto-starts a break and emits workEnded; long break every N; break end waits for user', () => {
  let r = pomodoroReducer(initialPomodoro, { type: 'start', now: 0, cfg })
  r = pomodoroReducer(r.state, { type: 'tick', now: 25 * MIN, cfg })
  expect(r.event).toBe('workEnded')
  expect(r.state).toMatchObject({ phase: 'break', running: true, cycle: 1, endsAt: 30 * MIN })
  r = pomodoroReducer(r.state, { type: 'tick', now: 30 * MIN, cfg })
  expect(r.event).toBe('breakEnded')
  expect(r.state).toMatchObject({ phase: 'work', running: false, remainingMs: 25 * MIN })
  r = pomodoroReducer(r.state, { type: 'start', now: 31 * MIN, cfg })
  r = pomodoroReducer(r.state, { type: 'tick', now: 56 * MIN, cfg })
  expect(r.state).toMatchObject({ phase: 'longBreak', cycle: 2, endsAt: 71 * MIN })
})

it('skip ends the current phase immediately; reset returns to idle', () => {
  let r = pomodoroReducer(initialPomodoro, { type: 'start', now: 0, cfg })
  r = pomodoroReducer(r.state, { type: 'skip', now: 1 * MIN, cfg })
  expect(r.state.phase).toBe('break')
  r = pomodoroReducer(r.state, { type: 'reset', now: 2 * MIN, cfg })
  expect(r.state).toEqual(initialPomodoro)
})

it('tick before the end changes nothing', () => {
  const r0 = pomodoroReducer(initialPomodoro, { type: 'start', now: 0, cfg })
  const r = pomodoroReducer(r0.state, { type: 'tick', now: 10 * MIN, cfg })
  expect(r.state).toBe(r0.state)
  expect(r.event).toBeUndefined()
})
```

`tests/unit/tracker.test.ts`:
```ts
import { it, expect } from 'vitest'
import { ReadingSessionTracker } from '../../src/renderer/src/sessions/tracker'

const MIN = 60_000

it('groups activity into sessions, splits on idle and book change, ends at last activity', () => {
  const logged: Array<{ start: number; end: number; bookId: string; pomodoro: boolean }> = []
  const t = new ReadingSessionTracker(e => logged.push(e), 3 * MIN)
  t.activity('a', 0, false)
  t.activity('a', 2 * MIN, true)
  t.activity('a', 4 * MIN, false)
  t.tick(6 * MIN)
  expect(logged).toEqual([])
  t.tick(7.5 * MIN)
  expect(logged).toEqual([{ start: 0, end: 4 * MIN, bookId: 'a', pomodoro: true }])
  t.activity('a', 8 * MIN, false)
  t.activity('b', 9 * MIN, false)
  expect(logged[1]).toEqual({ start: 8 * MIN, end: 9 * MIN, bookId: 'a', pomodoro: false })
  t.end(10 * MIN)
  expect(logged[2]).toEqual({ start: 9 * MIN, end: 10 * MIN, bookId: 'b', pomodoro: false })
  t.end(11 * MIN)
  expect(logged).toHaveLength(3)
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/pomodoro.test.ts tests/unit/tracker.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `machine.ts` and `tracker.ts`**

`src/renderer/src/pomodoro/machine.ts`:
```ts
import type { PomodoroSettings } from '../../../shared/types'

export type Phase = 'idle' | 'work' | 'break' | 'longBreak'

export interface PomodoroState {
  phase: Phase
  running: boolean
  endsAt: number | null // epoch ms while running
  remainingMs: number // while paused
  cycle: number // completed work phases
}

export type PomodoroAction =
  | { type: 'start' | 'pause' | 'skip' | 'reset' | 'tick'; now: number; cfg: PomodoroSettings }

export type PomodoroEvent = 'workEnded' | 'breakEnded'

export const initialPomodoro: PomodoroState = { phase: 'idle', running: false, endsAt: null, remainingMs: 0, cycle: 0 }

const MIN = 60_000

export function remaining(s: PomodoroState, now: number): number {
  return s.running && s.endsAt !== null ? Math.max(0, s.endsAt - now) : s.remainingMs
}

function finish(s: PomodoroState, now: number, cfg: PomodoroSettings): { state: PomodoroState; event: PomodoroEvent } {
  if (s.phase === 'work') {
    const cycle = s.cycle + 1
    const long = cycle % cfg.longEvery === 0
    const len = (long ? cfg.longBreakMin : cfg.breakMin) * MIN
    return { state: { phase: long ? 'longBreak' : 'break', running: true, endsAt: now + len, remainingMs: len, cycle }, event: 'workEnded' }
  }
  return { state: { phase: 'work', running: false, endsAt: null, remainingMs: cfg.workMin * MIN, cycle: s.cycle }, event: 'breakEnded' }
}

export function pomodoroReducer(s: PomodoroState, a: PomodoroAction): { state: PomodoroState; event?: PomodoroEvent } {
  switch (a.type) {
    case 'start': {
      if (s.running) return { state: s }
      if (s.phase === 'idle') {
        const len = a.cfg.workMin * MIN
        return { state: { ...s, phase: 'work', running: true, endsAt: a.now + len, remainingMs: len } }
      }
      return { state: { ...s, running: true, endsAt: a.now + s.remainingMs } }
    }
    case 'pause':
      return s.running ? { state: { ...s, running: false, endsAt: null, remainingMs: remaining(s, a.now) } } : { state: s }
    case 'skip':
      return s.phase === 'idle' ? { state: s } : finish(s, a.now, a.cfg)
    case 'reset':
      return { state: initialPomodoro }
    case 'tick':
      return s.running && s.endsAt !== null && a.now >= s.endsAt ? finish(s, s.endsAt, a.cfg) : { state: s }
  }
}
```
(The skip test expects `phase: 'break'` after skipping work at cycle 0 with `longEvery: 2`: cycle becomes 1, and 1 % 2 ≠ 0, so it's a short break ✓.)

`src/renderer/src/sessions/tracker.ts`:
```ts
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
```
(The test's book switch at 9 min logs end = 9 min, the switch time; `activity` passes `now` when the book changes ✓. The idle path ends at the last activity, 4 min ✓.)

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/pomodoro.test.ts tests/unit/tracker.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the provider, control, overlay and tracker hook**

`PomodoroProvider.tsx` (exports `PomodoroProvider`, `PomodoroControl`, `usePomodoro`, `PomodoroPhase`):
- Context holds `PomodoroState`. An interval every 1000 ms dispatches `tick` with `Date.now()` and the current `settings.pomodoro` (fall back to `DEFAULT_SETTINGS.pomodoro` before settings load) and re-renders the countdown.
- **On `workEnded`:** if `cfg.sound`, play the chime. Set `overlayOpen = true`. Fetch `api.review.dueCount()` for the overlay.
- **On `breakEnded`:** chime (if sound is on), and show the toast "Break over — press ▶ or ⌥⌘P to start the next focus session".
- When a break phase completes, log `api.sessions.log({ start, end, kind: 'break', bookId: null, pomodoro: true })` with the break's actual start and end.
- `toggle()`: start if not running, pause if running. `skip()` and `reset()` dispatch their actions.
- Expose `usePomodoro()` → `{ phase, running, remainingMs, toggle, skip, reset }`.

`PomodoroControl` (status bar, `data-testid="pomodoro"`):
- Idle: a Timer icon + "Focus" button (`data-testid="pomodoro-start"`).
- Running or paused: a phase color dot (work = accent, break = green), `mm:ss` in tabular numerals, and a play/pause button (`data-testid="pomodoro-toggle"`).
- Clicking the time opens a small popover with Skip, Reset, Work/Break/Long-break minute number inputs, "Long break every N", and a Sound checkbox. Changes call `updateSettings(dispatch, { pomodoro: { ...current, field } })`.

`BreakOverlay.tsx` (rendered by the provider when `overlayOpen` and phase is break/longBreak, `data-testid="break-overlay"`):
- A fixed full-content overlay with backdrop `rgba(0,0,0,.35)` and `backdrop-filter: blur(6px)`, 400 ms fade-in.
- A centered card: "Break time" (serif 24 px), the live countdown, then "Quick win: review N due cards?" with buttons **Review** (`data-testid="break-review"`), which closes the overlay and navigates to review, and **Skip** (`data-testid="break-skip"`), which closes the overlay while the break timer keeps running. If N = 0: "Stand up, stretch, look far away." with a Close button.

`chime.ts`: `playChime(): void` using WebAudio. Two sine tones (880 Hz then 1320 Hz, 180 ms each, gain envelope 0 → 0.15 → 0). Wrap in try/catch.

`useReadingTracker.ts`:
- Create one `ReadingSessionTracker` (ref) whose log callback calls `api.sessions.log({ start: iso(start), end: iso(end), kind: 'reading', bookId, pomodoro })`.
- `onReader('activity', ({ bookId }) => tracker.activity(bookId, Date.now(), pomodoro.phase === 'work' && pomodoro.running))`, reading the latest pomodoro state through a ref.
- `onReader('closed', () => tracker.end(Date.now()))`.
- `window` `blur` → `tracker.end(Date.now())`.
- An interval every 15 s → `tracker.tick(Date.now())`.
- `beforeunload` → `tracker.end(Date.now())`.

- [ ] **Step 6: Write the e2e test**

`tests/e2e/pomodoro.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('pomodoro runs, break overlay appears, and offers review', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await page.evaluate(() => window.api.settings.update({ pomodoro: { workMin: 0.02, breakMin: 0.05, longBreakMin: 0.05, longEvery: 4, sound: false } }))
  await page.reload()
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await page.getByTestId('pomodoro-start').click()
  await expect(page.getByTestId('break-overlay')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('break-review').click()
  await expect(page.getByTestId('break-overlay')).toBeHidden()
  await expect(page.locator('[data-testid="view-review"], [data-testid="review-empty"]').first()).toBeVisible()
  await app.close()
})
```

- [ ] **Step 7: Run all the tests**

Run: `npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test tests/e2e/pomodoro.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/pomodoro src/renderer/src/sessions tests/unit/pomodoro.test.ts tests/unit/tracker.test.ts tests/e2e/pomodoro.spec.ts
git commit -m "feat(ui): ADHD-friendly pomodoro with break overlay and reading session tracking"
```

---

### Task 14: Stats view and knowledge-rate status item (sonnet, wave 3b)

**Before writing chart code, invoke the `dataviz` skill** and follow its color and mark guidance (charts must read well in light and dark mode).

**Files:**
- Replace stubs: `src/renderer/src/views/StatsView.tsx`, `src/renderer/src/stats/KnowledgeRate.tsx`
- Create: `src/renderer/src/stats/charts.tsx`, `src/renderer/src/stats/format.ts`, `src/renderer/src/stats/stats.css`
- Test: `tests/unit/statsFormat.test.ts`, `tests/e2e/stats.spec.ts`

**Interfaces:**
- Consumes: `useAppState` (T8); `window.api.stats.get`, `window.api.on.reviewChanged`; `Stats` (shared).
- Produces: `formatRate(v: number | null): string`, `scaleLinear(domain: [number, number], range: [number, number]): (v: number) => number`, `LineChart({ points, height })`, `BarChart({ bars, height })`, `StatsView()`, `KnowledgeRate()`.

- [ ] **Step 1: Write the failing unit test**

`tests/unit/statsFormat.test.ts`:
```ts
import { it, expect } from 'vitest'
import { formatRate, scaleLinear } from '../../src/renderer/src/stats/format'

it('formats knowledge rate', () => {
  expect(formatRate(null)).toBe('—')
  expect(formatRate(2.345)).toBe('2.3 / hr')
  expect(formatRate(-0.5)).toBe('−0.5 / hr')
})

it('linear scale maps and handles flat domains', () => {
  const s = scaleLinear([0, 10], [100, 0])
  expect(s(0)).toBe(100)
  expect(s(5)).toBe(50)
  expect(scaleLinear([3, 3], [0, 10])(3)).toBe(5)
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/statsFormat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `format.ts`**

```ts
export function formatRate(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  const s = Math.abs(v).toFixed(1)
  return `${v < 0 ? '−' : ''}${s} / hr`
}

export function scaleLinear(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  if (d1 === d0) return () => (r0 + r1) / 2
  return v => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/unit/statsFormat.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement charts, view and status item**

`charts.tsx`: dependency-free SVG components sized by a `ResizeObserver` on their container (width) with a fixed `height`.
- `LineChart({ points: Array<{ label: string; value: number }>, height })`: an area plus a 2 px line in `var(--accent)`, area fill `var(--accent-soft)`, 3 horizontal gridlines in `var(--separator)`, y labels on the left (muted 11 px), first and last x labels, and a hover tooltip showing label and value.
- `BarChart({ bars: Array<{ label: string; value: number }>, height, highlightLast?: boolean })`: rounded-top bars (radius 3), fill `var(--accent)` at 0.75 opacity, the last bar full opacity when `highlightLast`, a hover tooltip, and first/middle/last x labels.

`StatsView.tsx` (`data-testid="view-stats"`), scrollable, padding 32 px, max-width 960 px:
- Header "Your learning" (serif 26 px).
- **KPI tiles** in a row (4 `.card`s): **Retrievable knowledge per hour** (`formatRate(knowledgePerHour)`, `data-testid="kpi-rate"`, subtitle "last 30 days"), **Retrievable highlights** (`K` to 1 decimal place, subtitle "expected recall today"), **Due today** (`dueToday`), **Streak** (`streakDays` days).
- **Card "Retrievable knowledge over time"**: LineChart of `kTrend`.
- **Card "Minutes per day (reading + review)"**: BarChart of `minutesByDay` with `highlightLast`.
- **Card "Reviews due, next 14 days"**: BarChart of `forecast`.
- **Card "Cards by book"**: a simple table (title, cards) from `perBook`, top 10.
- A small explainer under the KPI row (muted 12 px): "Retrievable knowledge = how many of your highlights you'd likely recall right now (FSRS). Reading alone doesn't raise it; reviewing does."
- Load with `api.stats.get()` on mount and on `api.on.reviewChanged`. Before data arrives, show skeleton cards.

`KnowledgeRate.tsx` (status bar, `data-testid="status-rate"`): a `Brain` (lucide) icon + `formatRate(knowledgePerHour)`. Title tooltip: "Retrievable knowledge gained per hour of reading and review (30 days)". Clicking it navigates to stats. It refreshes on mount, on `reviewChanged`, and every 5 minutes. It renders nothing while no library is open.

- [ ] **Step 6: Write the e2e test**

`tests/e2e/stats.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { launchApp, makeLibrary } from './helpers'

test('stats page renders KPIs and charts after a review', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })
  await page.evaluate(async () => {
    const book = (await window.api.library.list()).find(b => b.format === 'epub')!
    const h = await window.api.highlights.add(book.id, {
      location: 'epubcfi(/6/4)', quote: { exact: 'all warfare', prefix: '', suffix: '' }, context: 'all warfare is deception',
      chapter: null, position: 0, color: 'yellow', note: null
    })
    await window.api.review.rate(h.id, 'good', 2000, 'cloze')
  })
  await page.getByTestId('nav-stats').click()
  await expect(page.getByTestId('kpi-rate')).toBeVisible()
  await expect(page.locator('[data-testid="view-stats"] svg').first()).toBeVisible()
  await expect(page.getByTestId('status-rate')).toBeVisible()
  await app.close()
})
```

- [ ] **Step 7: Run all the tests**

Run: `npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test tests/e2e/stats.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/views/StatsView.tsx src/renderer/src/stats tests/unit/statsFormat.test.ts tests/e2e/stats.spec.ts
git commit -m "feat(ui): stats dashboard and knowledge-per-hour status item"
```

---
### Task 15: Full-journey E2E and CI workflow (sonnet, wave 4)

**Files:**
- Create: `tests/e2e/journey.spec.ts`, `.github/workflows/ci.yml`
- Modify: `package.json` (add `"lint:ts": "npm run typecheck"` and `"test:all": "npm run typecheck && npm test && npm run e2e"`)

**Interfaces:**
- Consumes: every UI test id defined in Tasks 8–14 and `tests/e2e/helpers.ts`.
- Produces: a CI workflow named `ci` that runs on push and pull_request.

- [ ] **Step 1: Write the journey test**

`tests/e2e/journey.spec.ts`:
```ts
import { test, expect, type Frame, type Page } from '@playwright/test'
import { appendFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, makeLibrary } from './helpers'

async function contentFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 40; i++) {
    for (const f of page.frames().filter(f => f.url().startsWith('blob:'))) {
      const len = await f.evaluate(() => document.body?.innerText.trim().length ?? 0).catch(() => 0)
      if (len > 200) return f
    }
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(250)
  }
  throw new Error('no content frame')
}

test('first run → read → highlight → agent adds question → review → stats', async () => {
  const library = await makeLibrary()
  const { app, page } = await launchApp({ library })

  // workspace was prepared for agents
  for (const p of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'knowledge/index.md', '.claude/skills/distill/SKILL.md', '.agents/skills/recall/SKILL.md']) {
    expect(existsSync(join(library, p)), p).toBe(true)
  }

  // read and highlight
  await expect(page.getByTestId('book-tile').filter({ hasText: 'The Art of War' }).first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('book-tile').filter({ hasText: 'The Art of War' }).first().click()
  const frame = await contentFrame(page)
  await frame.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find(x => (x.textContent ?? '').trim().split(/\s+/).length > 8)!
    const t = p.firstChild as Text
    const r = document.createRange()
    r.setStart(t, 0)
    r.setEnd(t, Math.min(30, t.data.length))
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(r)
    p.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await page.getByTestId('hl-color-yellow').click()
  await expect(page.getByTestId('due-badge')).toHaveText('1')

  // highlights mirror exists for the agent
  const lib = JSON.parse(await readFile(join(library, '.smartreader/library.json'), 'utf8'))
  const book = Object.values(lib.books as Record<string, { slug: string; title: string; id: string }>).find(b => b.title.includes('Art of War'))!
  const md = await readFile(join(library, `.smartreader/books/${book.slug}/highlights.md`), 'utf8')
  const hid = /- id: (h_[0-9a-f-]+)/.exec(md)![1]

  // simulate the coach agent writing a better question
  await appendFile(join(library, 'knowledge/prompts.jsonl'), JSON.stringify({ highlightId: hid, question: 'AGENT QUESTION?', answer: 'agent answer', by: 'distill' }) + '\n')
  await page.waitForTimeout(1500)

  // review it
  await page.getByTestId('nav-review').click()
  await expect(page.getByTestId('review-prompt')).toHaveText('AGENT QUESTION?')
  await page.keyboard.press('Space')
  await page.keyboard.press('3')
  await expect(page.getByTestId('review-done')).toBeVisible()
  const log = (await readFile(join(library, '.smartreader/review-log.jsonl'), 'utf8')).trim().split('\n')
  expect(JSON.parse(log[0])).toMatchObject({ highlightId: hid, rating: 'good', promptType: 'ai' })

  // stats
  await page.getByTestId('nav-stats').click()
  await expect(page.getByTestId('kpi-rate')).toBeVisible()
  await app.close()
})
```

- [ ] **Step 2: Run the test**

Run: `npm run build && xvfb-run -a npx playwright test tests/e2e/journey.spec.ts`
Expected: PASS. If it fails, fix the owning component (all earlier tasks are merged at this point) and note which task's code changed.

- [ ] **Step 3: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: sudo apt-get update && sudo apt-get install -y xvfb libnss3 libgbm1 libasound2t64 || sudo apt-get install -y xvfb libnss3 libgbm1 libasound2
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: xvfb-run -a npx playwright test
        env:
          CI: '1'
```

- [ ] **Step 4: Run the full suite locally the way CI does**

Run: `npm ci && npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/journey.spec.ts .github/workflows/ci.yml package.json
git commit -m "test: full user journey e2e and CI workflow"
```

---

### Task 16: Packaging, release workflow, installer, README (sonnet, wave 4)

**Files:**
- Create: `electron-builder.yml`, `build/icon.svg`, `scripts/make-icon.mjs`, `build/icon.png` (generated), `.github/workflows/release.yml`, `install.sh`, `README.md`
- Test: `tests/unit/installScript.test.ts`

**Interfaces:**
- Consumes: the built app (`out/**`), `resources/workspace-template`, `tests/e2e/smoke.spec.ts` + `SR_APP_PATH` support in `tests/e2e/helpers.ts` (T1).
- Produces: release assets `Smart-Reader-<version>-arm64.dmg` and `Smart-Reader-<version>-x64.dmg` on a GitHub Release named `v<version>`; `install.sh` in the repo root.

- [ ] **Step 1: Write the failing installer test**

`tests/unit/installScript.test.ts`:
```ts
import { it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const path = resolve(__dirname, '../../install.sh')

it('install.sh is valid bash and targets the right repo and assets', async () => {
  execFileSync('bash', ['-n', path])
  const s = await readFile(path, 'utf8')
  expect(s).toContain('spencertse122/mac-smart-reader')
  expect(s).toContain('gh release download')
  expect(s).toContain('xattr -dr com.apple.quarantine')
  expect(s).toMatch(/arm64/)
  expect(s).toMatch(/x64/)
  expect(s).toContain('/Applications/Smart Reader.app')
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/installScript.test.ts`
Expected: FAIL (file missing).

- [ ] **Step 3: Write the installer**

`install.sh`:
```bash
#!/usr/bin/env bash
# Smart Reader installer/updater for macOS.
# Usage: curl -fsSL <raw url>/install.sh | bash      (or: bash install.sh)
set -euo pipefail

REPO="${SMART_READER_REPO:-spencertse122/mac-smart-reader}"
APP="/Applications/Smart Reader.app"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "Smart Reader runs on macOS only."

if ! command -v gh >/dev/null 2>&1; then
  die "GitHub CLI not found. Install it with:  brew install gh && gh auth login   then re-run this installer."
fi
gh auth status >/dev/null 2>&1 || die "Please log in to GitHub first:  gh auth login"

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) die "Unsupported CPU architecture: $(uname -m)" ;;
esac

TMP="$(mktemp -d)"
trap 'hdiutil detach "$TMP/mnt" -quiet >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

say "Downloading the latest Smart Reader for $ARCH…"
gh release download --repo "$REPO" --pattern "*-${ARCH}.dmg" --dir "$TMP" --clobber
DMG="$(ls "$TMP"/*.dmg | head -n1)"
[[ -f "$DMG" ]] || die "No $ARCH build found in the latest release of $REPO."

say "Installing to /Applications…"
mkdir -p "$TMP/mnt"
hdiutil attach "$DMG" -nobrowse -quiet -mountpoint "$TMP/mnt"
if pgrep -x "Smart Reader" >/dev/null 2>&1; then
  say "Quitting the running Smart Reader…"
  osascript -e 'quit app "Smart Reader"' || true
  sleep 1
fi
rm -rf "$APP"
cp -R "$TMP/mnt/Smart Reader.app" "$APP"
hdiutil detach "$TMP/mnt" -quiet

# The app is not signed with a paid Apple Developer ID; clear the quarantine flag so macOS opens it.
xattr -dr com.apple.quarantine "$APP" || true

say "Done. Opening Smart Reader…"
open "$APP"
```
Run: `chmod +x install.sh`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/unit/installScript.test.ts`
Expected: PASS.

- [ ] **Step 5: Icon and builder config**

`build/icon.svg`: a 1024×1024 macOS-style icon. A rounded square (rx 230) with a vertical gradient `#0a84ff` → `#5e5ce6`. On it, a white open book (two slightly curved pages, stroke-free, 0.95 opacity) whose right page carries a small yellow highlight bar (`#ffd60a`). Below the book, a subtle white sparkle of three small rounded stars. Keep a 100 px safe margin, per macOS Big Sur icon grid conventions.

`scripts/make-icon.mjs`:
```js
import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const svg = readFileSync('build/icon.svg', 'utf8')
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng()
writeFileSync('build/icon.png', png)
console.log('wrote build/icon.png')
```
Run: `node scripts/make-icon.mjs`. Expected output: `wrote build/icon.png`. (electron-builder converts `icon.png` to `.icns` on macOS.)

`electron-builder.yml`:
```yaml
appId: com.smartreader.app
productName: Smart Reader
copyright: Copyright © 2026
directories:
  output: release
  buildResources: build
files:
  - out/**
  - package.json
extraResources:
  - from: resources/workspace-template
    to: workspace-template
asarUnpack:
  - node_modules/node-pty/**
npmRebuild: true
mac:
  target:
    - target: dmg
  category: public.app-category.education
  icon: build/icon.png
  identity: null
  hardenedRuntime: false
  minimumSystemVersion: '13.0'
  artifactName: Smart-Reader-${version}-${arch}.${ext}
dmg:
  title: Smart Reader
  contents:
    - { x: 140, y: 190 }
    - { x: 400, y: 190, type: link, path: /Applications }
```
Add to `package.json` scripts: `"dist:mac": "electron-vite build && electron-builder --mac dmg --arm64 --x64 --publish never"` and `"icon": "node scripts/make-icon.mjs"`.

- [ ] **Step 6: Release workflow**

`.github/workflows/release.yml`:
```yaml
name: release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
permissions:
  contents: write
jobs:
  mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run dist:mac
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      - name: Smoke-launch the packaged arm64 app
        run: |
          APP_BIN="$(ls -d release/mac-arm64/*.app)/Contents/MacOS/Smart Reader"
          SR_APP_PATH="$APP_BIN" npx playwright test tests/e2e/smoke.spec.ts
      - name: Publish release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          TAG="${GITHUB_REF_NAME}"
          if [[ "$GITHUB_REF_TYPE" != "tag" ]]; then TAG="v$(node -p "require('./package.json').version")"; fi
          gh release view "$TAG" >/dev/null 2>&1 || gh release create "$TAG" --title "Smart Reader $TAG" --notes "Install or update: see README."
          gh release upload "$TAG" release/*.dmg --clobber
```

- [ ] **Step 7: README**

`README.md` sections (write them out fully; plain and friendly):
1. **Smart Reader**: a one-paragraph pitch (local Mac ebook reader for non-fiction; highlights become spaced-repetition cards; side terminal for an AI coach; nothing leaves your Mac) and a screenshot placeholder line `![Smart Reader](docs/screenshot.png)` (omit the image if none exists).
2. **Install** (macOS 13+):
   ```bash
   brew install gh        # if you don't have it
   gh auth login          # once; only needed if the repo is private
   gh api repos/spencertse122/mac-smart-reader/contents/install.sh --jq .content | base64 -d | bash
   ```
   Explain that the same command updates the app, and why macOS quarantine is cleared (unsigned app). Include a manual install: download the DMG from Releases → drag to Applications → `xattr -dr com.apple.quarantine "/Applications/Smart Reader.app"`.
3. **First run**: choose the books folder; what the app creates inside it (`.smartreader/`, `knowledge/`, skills, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`); your books are never modified or uploaded.
4. **Daily use**: highlight (select → color), review (Space, 1–4), Pomodoro (⌥⌘P), terminal (⌘J), stats.
5. **AI coach**: install one agent CLI (Claude Code: `npm install -g @anthropic-ai/claude-code`; Codex: `npm install -g @openai/codex`; Gemini: `npm install -g @google/gemini-cli`). Open the terminal (⌘J), run it, and try: "distill my new highlights", "recall chapter 3", "drill my weak spots", "what do I know about incentives?", "weekly review".
6. **Your data & backups**: everything is plain files in your books folder; back it up with Time Machine or similar; it's not stored in GitHub.
7. **Development**: `npm install`, `npm run dev`, `npm test`, `xvfb-run -a npm run e2e` (Linux) or `npm run e2e` (macOS), `npm run dist:mac` (macOS only). Releases: bump `version` in package.json, `git tag vX.Y.Z && git push --tags`.

- [ ] **Step 8: Verify config locally**

Run: `npm test && python3 -c "import yaml;[yaml.safe_load(open(f)) for f in ['electron-builder.yml','.github/workflows/release.yml','.github/workflows/ci.yml']];print('yaml ok')"`
Expected: tests PASS and `yaml ok`. The DMG can only be built on macOS; the release workflow verifies it in the final phase.

- [ ] **Step 9: Commit**

```bash
git add electron-builder.yml build scripts/make-icon.mjs .github/workflows/release.yml install.sh README.md package.json tests/unit/installScript.test.ts
git commit -m "build: mac packaging, release workflow, one-command installer, README"
```

---

### Final phase: Review, push and release (controller)

- [ ] **Step 1: Whole-branch review.** Read the full diff since the spec commit against the spec (`docs/superpowers/specs/2026-10-20-smart-reader-design.md`). Check every spec section has an implementation, the Review Focus items are pinned by tests, and nothing writes to `knowledge/` except `setupWorkspace` create-only files. Fix findings.

- [ ] **Step 2: Full local verification**

Run: `npm ci && npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test`
Expected: all PASS. Record the counts.

- [ ] **Step 3: Create the repo and push** (note: the repo `spencertse122/mac-smart-reader` already exists and is public; the final fix wave switched the installer to `curl` with a `gh` fallback) (requires user confirmation before running: outward-facing)

```bash
gh repo create spencertse122/mac-smart-reader --private --source . --remote origin --push
```
Expected: the repo exists, `main` is pushed, and CI starts.

- [ ] **Step 4: Watch CI, then tag the release**

```bash
gh run watch --exit-status $(gh run list --workflow ci --limit 1 --json databaseId --jq '.[0].databaseId')
git tag v0.1.0 && git push origin v0.1.0
gh run watch --exit-status $(gh run list --workflow release --limit 1 --json databaseId --jq '.[0].databaseId')
gh release view v0.1.0 --json assets --jq '.assets[].name'
```
Expected: CI green; release green; assets `Smart-Reader-0.1.0-arm64.dmg` and `Smart-Reader-0.1.0-x64.dmg`. If node-pty fails to cross-compile for x64 on the arm64 runner, add a second job on `macos-13` (if still offered) building `--x64` only, and re-tag as `v0.1.1`.

- [ ] **Step 5: Hand-off.** Give the user the install command from the README and a 5-step first-run checklist.
