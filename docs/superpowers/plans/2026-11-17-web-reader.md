# Smart Reader Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first web build of Smart Reader that signs in with Google and reads and writes the same Drive folder as the Mac app, hosted on Cloud Run.

**Architecture:** The web build renders the existing renderer and supplies its own `window.api`. That API runs the existing `src/main` services in the browser, with `node:*` imports aliased to a virtual file system. The VFS mirrors the chosen Drive folder: it reads lazily, writes through a persistent outbox, pulls through the Drive changes feed, and merges three ways on conflict. The Mac app gets freshness-aware `jsonFile` so neither side clobbers the other.

**Tech Stack:** TypeScript, React 19, Vite 8 (separate `vite.web.config.ts`), vitest 5, Playwright 1.64 (Chromium and WebKit with mobile emulation), Google Identity Services token client, Drive REST v3, IndexedDB (`idb-keyval`), `buffer`, `@noble/hashes`, nginx on Cloud Run.

**Spec:** `docs/superpowers/specs/2026-11-17-web-reader-design.md`. Read it fully before any task: section "Builder's calls" has numbered decisions referenced below as **BC1–BC10**.

## Global Constraints

- On-disk formats under `.smartreader/` and `knowledge/` are unchanged, and v0.4.0 Mac must read anything the web writes.
- Existing `npm run typecheck`, `npm test` and `xvfb-run -a npm run e2e` stay green after every task.
- The web has no terminal and no dictionary Look Up. `vocab.lookup` on the web returns `{ ok: false, reason: 'unavailable' }`.
- Mount path `/library`. Drive scope is `https://www.googleapis.com/auth/drive openid email`.
- Hosting: Cloud Run service `smart-reader`, region `us-central1`, project `my-productivity-suite`, URL `https://smart-reader-673514603120.us-central1.run.app`.
- The client id comes from `VITE_GOOGLE_CLIENT_ID`. Never hard-code a token or secret.
- Mobile breakpoint is `max-width: 760px`, touch targets are ≥ 44px, and there is no horizontal scroll at 390px width.
- Version 0.5.0.
- Match the surrounding code style: 2-space indent, no semicolons, single quotes, sparse comments that explain *why*.

## Review Focus

1. Both devices edit the same file between syncs: Mac reviews cards while the phone (token expired) adds a highlight. After reconnect, both changes exist on both sides (Task 4, `merge keeps both sides' highlights and review cards`; Task 5, `web edits survive a concurrent Mac write`).
2. The tab closes with unsent writes. On the next start the outbox replays and nothing is lost (Task 4, `outbox replays after restart`).
3. A huge library or a big PDF. The listing pages through `nextPageToken`, and a 100 MB book downloads with progress, without blocking the UI thread (Task 3 paging test; Task 6 progress state).
4. Folder names and book file names with spaces, unicode, `'` and `#` must survive the Drive `q` escaping and the path mapping (Task 3, `escapes quotes in q`; Task 4, `unicode and quote names round-trip`).
5. The Mac app is open while the web writes. The Mac's next write builds on the web's content and doesn't overwrite it (Task 1, `jsonFile reloads when the file changed on disk`).

---

### Task 1: Mac-side sync safety and platform flag

**Files:**
- Modify: `src/main/store/jsonFile.ts`, `src/main/library/libraryService.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/index.ts` (focus → events), `src/renderer/src/App.tsx`, `src/renderer/src/components/StatusBar.tsx`, `src/renderer/src/reader/HighlightPopup.tsx`, `tests/e2e/*` only if a selector breaks
- Test: `tests/unit/store.test.ts`, `tests/unit/library.test.ts`

**Interfaces:**
- Produces: `SmartReaderApi.platform: 'mac' | 'web'`. `new LibraryService(root, now?, hash?, opts?: { trustMtime?: boolean })`, with default `true`. `jsonFile` keeps its signature.

- [ ] **Step 1: Write failing tests** in `tests/unit/store.test.ts`:
  - `jsonFile reloads when the file changed on disk`: read the file once. Write new JSON to the same path with `fs.writeFile` and bump its mtime with `utimes` to +2 s. Then `read()` returns the new content, and `update(d => { d.n++ })` applies on top of the new content.
  - `jsonFile skips writing when nothing changed`: with `update(() => {})`, the file's mtime is unchanged and `afterWrite` isn't called.
  - `jsonFile does not reload its own write`: after `update`, an external read count (spy on `readJson` via a counter) doesn't increase on the next `read()`.

  In `tests/unit/library.test.ts`:
  - `trustMtime false keeps id and stored mtime when only mtime differs`: scan, touch the file's mtime, then scan with a new `LibraryService(root, now, hashSpy, { trustMtime: false })`. `hashSpy` isn't called, and `book.mtimeMs` equals the first stored value.
- [ ] **Step 2: Run** `npx vitest run tests/unit/store.test.ts tests/unit/library.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - jsonFile remembers `sig = \`${mtimeMs}:${size}\`` from `stat` after each load and each write, or `null` if the file was missing.
  - `load()` stats first and reloads if `sig` differs from the current stat. A missing file after a cached load keeps the cache.
  - `update` compares `JSON.stringify(next)` with the stringified loaded value. If they are equal, it returns without writing.
  - For `trustMtime: false` in `LibraryService.scan`, `unchanged = known && known.fileSize === st.size`, and an existing book's `mtimeMs` isn't reassigned.
- [ ] **Step 4: Platform flag.**
  - Add `platform` to `SmartReaderApi`, and set `'mac'` in the preload.
  - Renderer: when `window.api.platform === 'web'`, don't render `TerminalPanel` or the StatusBar Terminal button, ignore `toggle-terminal`, and hide the HighlightPopup Look Up button (`data-testid="hl-lookup"`).
  - Main: `mainWindow.on('focus', () => { send(IPC.eventReviewChanged); send(IPC.eventLibraryChanged) })`.
- [ ] **Step 5: Run** `npm run typecheck && npm test && xvfb-run -a npm run e2e`. Expected: all pass.
- [ ] **Step 6: Commit** with the message `feat(sync): jsonFile reloads external changes and skips no-op writes; platform flag`.

### Task 2: Web build skeleton, node shims, in-memory VFS

**Files:**
- Create: `vite.web.config.ts`, `vitest.web.config.ts`, `src/web/index.html`, `src/web/main.tsx`, `src/web/shims/{crypto.ts,os.ts,path.ts,buffer.ts}`, `src/web/vfs/{vfs.ts,fsPromises.ts,fs.ts,errors.ts}`, `tsconfig.web.json` (include `src/web`), `.env.production` (`VITE_GOOGLE_CLIENT_ID=`)
- Modify: `package.json` (deps: `buffer`, `@noble/hashes`, `path-browserify`, `idb-keyval`; dev: `fake-indexeddb`; scripts `dev:web`, `build:web`, `test:web`, `e2e:web`, and add `test:web` + `e2e:web` to `test:all`)
- Test: `tests/web/vfs.test.ts`, `tests/web/servicesOnVfs.test.ts`

**Interfaces:**
- Produces:
  - `class Vfs`, with these members:
    - `writeLocal(path, data: Uint8Array, opts?: { fromRemote?: boolean; mtimeMs?: number })`
    - `entry(path): VfsEntry | undefined`
    - `setRemoteLoader(fn: (e: VfsEntry, range?: [number, number]) => Promise<Uint8Array>)`
    - `onLocalChange(cb: (op: VfsOp) => void): () => void`
    - all fs-subset methods
  - `type VfsEntry = { path: string; kind: 'file' | 'dir'; driveId?: string; size: number; mtimeMs: number; md5?: string; data?: Uint8Array }`
  - `type VfsOp = { type: 'write' | 'mkdir' | 'remove'; path: string }`
  - `setVfs(v: Vfs)` and `getVfs(): Vfs` in `src/web/vfs/vfs.ts`
  - `fsPromises.ts` exports `readFile, writeFile, appendFile, open, rename, copyFile, mkdir, readdir, stat, access, unlink`, all delegating to `getVfs()`
  - `fs.ts` exports `promises`, `constants`, `watchFile(path, opts, cb)`, `unwatchFile(path)`. Watchers fire on any content change to that path, whether local or remote.
  - Errors are `Error` with `.code` `ENOENT` / `EISDIR` / `ENOTDIR` / `EEXIST`.
  - `mtimeMs` bumps on every write: `Math.max(Date.now(), prev + 1)`.

- [ ] **Step 1: Write failing tests** in `tests/web/vfs.test.ts`. Each item below is one test.
  - `readFile` of a missing path rejects with `code 'ENOENT'`.
  - `writeFile` → `readFile(utf8)` round-trips.
  - `mkdir({ recursive: true })` creates parents.
  - `readdir(withFileTypes)` gives `isFile()` / `isDirectory()`.
  - `rename(tmp, target)` replaces the target and removes tmp.
  - `appendFile` appends.
  - `open(p, 'r').read(buf, 0, 4, 2)` reads at an offset.
  - `stat().mtimeMs` increases on each write.
  - `watchFile` fires on write.
  - A remote entry without `data` calls the remote loader, with a range for `open().read` and without one for `readFile`.

  In `tests/web/servicesOnVfs.test.ts` (runs **unchanged** `HighlightStore`, `VocabStore`, `ReviewService`, `LibraryService`, `SessionLog`, `StatsService` against a fresh `Vfs` through the aliases):
  - Add a highlight, add a note, list both.
  - `review.queue()` contains them, and `rate` writes `review-log.jsonl`.
  - `stats.get()` returns `K >= 0`.
  - `library.scan()` on a VFS seeded with `tests/fixtures/books/*` lists the fixture books, with ids equal to `computeBookId` on the real files.
- [ ] **Step 2: Run** `npx vitest run -c vitest.web.config.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - `vite.web.config.ts`:
    - `root: 'src/web'`, `publicDir: '../renderer/public'`, `build.outDir: '../../out/web'`, `emptyOutDir: true`
    - `resolve.alias`: `node:fs/promises` and `fs/promises` → `src/web/vfs/fsPromises.ts`; `node:fs` → `src/web/vfs/fs.ts`; `node:path` → `src/web/shims/path.ts` (re-export `path-browserify` posix); `node:crypto` → `src/web/shims/crypto.ts`; `node:os` → `src/web/shims/os.ts`
    - `define: { 'process.env': '{}', 'process.pid': '1' }`, plus a `buffer.ts` shim imported first in `main.tsx` that sets `globalThis.Buffer`
    - `vitest.web.config.ts` uses the same aliases, `include: ['tests/web/**/*.test.ts']`, `environment: 'node'`, and `setupFiles: ['fake-indexeddb/auto']`
  - `crypto.ts`: `createHash('sha256')` returns `{ update(x: string | Uint8Array), digest('hex') }` via `@noble/hashes/sha256`. `randomUUID = () => globalThis.crypto.randomUUID()`.
  - `os.ts`: `homedir = () => '/home'`.
  - `main.tsx` installs a placeholder `window.api` (Task 5 replaces it) and renders the renderer's `App` with its CSS.
- [ ] **Step 4: Run** `npx vitest run -c vitest.web.config.ts && npm run build:web`. Expected: tests pass, and `out/web/index.html` exists with no unresolved `node:` import warnings.
- [ ] **Step 5: Commit** with the message `feat(web): build skeleton, node shims, in-memory VFS running the existing services`.

### Task 3: Drive REST client and fake Drive

**Files:**
- Create: `src/web/drive/client.ts`, `src/web/drive/types.ts`, `tests/web/fakeDrive.ts`
- Test: `tests/web/driveClient.test.ts`

**Interfaces:**
- Produces:
  - `type DriveFile = { id: string; name: string; mimeType: string; size?: string; md5Checksum?: string; modifiedTime: string; parents?: string[]; trashed?: boolean }`
  - `FOLDER_MIME = 'application/vnd.google-apps.folder'`
  - `class DriveAuthError extends Error` (any 401)
  - `class DriveError extends Error { status: number }`
  - `createDriveClient({ fetch, getToken }): DriveClient` with:
    - `listChildren(folderId): Promise<DriveFile[]>` (all pages)
    - `get(id): Promise<DriveFile>`
    - `download(id, range?: [start, endInclusive], onProgress?: (loaded, total) => void): Promise<Uint8Array>`
    - `createFolder(name, parentId): Promise<DriveFile>`
    - `createFile(name, parentId, data: Uint8Array): Promise<DriveFile>`
    - `updateFile(id, data: Uint8Array): Promise<DriveFile>`
    - `findFoldersNamed(name): Promise<DriveFile[]>`
    - `startPageToken(): Promise<string>`
    - `changes(token): Promise<{ changes: Array<{ fileId: string; removed: boolean; file?: DriveFile }>; newStartPageToken: string }>` (follows `nextPageToken`)
  - `tests/web/fakeDrive.ts`: `class FakeDrive` with `fetch` (a `fetch`-compatible function for `https://www.googleapis.com/drive/v3/...` and `/upload/drive/v3/...`), `seedFromDir(localDir, parentId?)`, `putFile(path, data)`, `readFile(path)`, `rootId`, `failNext(status)`, `expireToken()`, `requests: string[]`. It accepts the token `'test-token'` only after `expireToken()` is undone by `setToken`.
- Request shapes:
  - Every call uses `Authorization: Bearer <token>`, `supportsAllDrives=true` and `includeItemsFromAllDrives=true` on list calls.
  - `fields` are exactly as in the spec.
  - The `q` strings are `'<id>' in parents and trashed=false`, `name='<escaped>' and mimeType='application/vnd.google-apps.folder' and trashed=false`.
  - Escape `\` and `'` in names with a backslash.
  - Uploads are `uploadType=media` for update and `uploadType=multipart` for create.

- [ ] **Step 1: Write failing tests** in `tests/web/driveClient.test.ts`. Each item below is one test.
  - `lists all pages` (seed 250 files; FakeDrive pages at 100).
  - `escapes quotes in q` (a folder named `Spencer's "Books"` is found by `findFoldersNamed`).
  - `download honours Range` (bytes 0–9 of a fixture equal the local file's first 10 bytes).
  - `create then update changes md5`.
  - `401 throws DriveAuthError`.
  - `changes reports create/update/trash` after `putFile` and a trash.
  - `download reports progress`.
- [ ] **Step 2: Run** `npx vitest run -c vitest.web.config.ts tests/web/driveClient.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the client with `fetch` and URLSearchParams. Retry 429 and 5xx up to 4 times, with exponential backoff (250 ms × 2ⁿ, capped at 30 s). Never retry a 401.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(web): Drive v3 client and in-memory fake Drive`.

### Task 4: Drive sync — mount, lazy reads, outbox, changes, merge

**Files:**
- Create: `src/web/sync/driveSync.ts`, `src/web/sync/outbox.ts`, `src/web/sync/merge.ts`, `src/web/sync/pathRules.ts`
- Test: `tests/web/merge.test.ts`, `tests/web/driveSync.test.ts`

**Interfaces:**
- Consumes: `Vfs` (Task 2), `DriveClient` and `FakeDrive` (Task 3).
- Produces:
  - `mergeFile(path: string, base: string | null, local: string, remote: string): string`, with the per-file rules from BC3
  - `pathRules.isPushable(path)`: false for `*.tmp-*` and `*.bak`
  - `pathRules.shouldIndex(relPath, isDir)`: follows the spec's walk rules
  - `interface OutboxStore { put(item: OutboxItem): Promise<void>; delete(path: string): Promise<void>; all(): Promise<OutboxItem[]> }`
  - `OutboxItem = { path: string; data: Uint8Array; baseMd5: string | null }`
  - `idbOutbox(key = 'sr.outbox')` implements `OutboxStore` with `idb-keyval`
  - `class DriveSync` (constructor `(vfs, drive, outbox, rootId, opts?: { mount?: string; now?: () => number })`), with:
    - `mount(): Promise<void>`: indexes the tree, sets the remote loader, sets the start token, replays the outbox
    - `pull(): Promise<boolean>`: true if a relevant change was applied
    - `pullIfStale(maxAgeMs = 3000): Promise<void>`: swallows network and auth errors
    - `flush(): Promise<void>`: waits until the outbox is empty, or rejects with `DriveAuthError`
    - `onChange(cb: (paths: string[]) => void)`
    - `onAuthError(cb)`
    - `pending(): number`
- Behaviour: the spec's sections "Virtual file system + Drive sync" and BC4/BC9.
  - Pushes are serialized per path and coalesced (the latest data only).
  - A new file under a dir that has no `driveId` first creates the folder chain.
  - The md5 of our own pushes is remembered, so the echoed change is ignored.
  - A conflict is a remote md5 that differs from the base while the path has a pending outbox item. The resolution is `mergeFile(base, local, remote)` → write local → push.
  - A JSON file that fails to parse after download is downloaded once more before handing it to the services (BC9).

- [ ] **Step 1: Write failing tests**, one per line. In `tests/web/merge.test.ts`:
  - `highlights: both sides add different items → both kept`
  - `highlights: both edit same id → later updatedAt wins`
  - `review-state: card changed both sides → later last_review wins as a whole card`
  - `library: location+progress move as a unit; disjoint fields from both sides kept`
  - `jsonl: remote lines + local new lines, no duplicates, order kept`
  - `md mirrors: local wins`
  - `generic json: local change vs base wins, otherwise remote`
  - `invalid remote JSON → local returned`

  In `tests/web/driveSync.test.ts` (FakeDrive seeded from a temp folder prepared by the real Mac `Workspace.open` on `tests/fixtures/books`, with `templateDir` = `resources/workspace-template`):
  - `mount indexes books, .smartreader and knowledge/prompts.jsonl but not knowledge/concepts`
  - `lazy read downloads once`
  - `write pushes and the echoed change is ignored`
  - `tmp and .bak never reach Drive`
  - `new nested dir creates Drive folders`
  - `remote change updates stat and fires onChange`
  - `outbox replays after restart` (new DriveSync on the same outbox store pushes pending data)
  - `401 pauses pushes, keeps outbox, resumes after token returns`
  - `merge keeps both sides' highlights and review cards` (local pending + remote edit → after pull both present in FakeDrive)
  - `unicode and quote names round-trip` (book `Ünïcode 'q' #1.epub`)
- [ ] **Step 2: Run** `npx vitest run -c vitest.web.config.ts tests/web/merge.test.ts tests/web/driveSync.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(web): Drive sync with persistent outbox, changes feed and three-way merge`.

### Task 5: Web API (the browser `window.api`)

**Files:**
- Create: `src/web/webWorkspace.ts`, `src/web/webApi.ts`, `src/web/webSettings.ts`, `src/web/bookCache.ts`
- Modify: `src/web/main.tsx`
- Test: `tests/web/webApi.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4. Services from `src/main/*`, unchanged except Task 1.
- Produces:
  - `openWebWorkspace(root: '/library', opts: { newCardsPerDay: () => Promise<number>; onReviewChanged: () => void }): Promise<WebWorkspace>`. It does the same composition as `Workspace.open`, without `setupWorkspace`. It uses `LibraryService(..., { trustMtime: false })` and creates `.smartreader/` and `knowledge/`.
  - `createWebApi(deps: { drive: DriveClient; outbox: OutboxStore; pickFolder: () => Promise<{ id: string; name: string } | null>; savedFolder: () => { id: string; name: string } | null; rememberFolder: (f) => void; cache: BookCache }): SmartReaderApi & { sync(): DriveSync | null }`
    - `platform: 'web'`.
    - Every handler mirrors `src/main/ipc.ts`, including the event emissions.
    - Each mutating call first runs `await sync.pullIfStale()`.
    - `library.chooseFolder` calls `pickFolder`, mounts it, and returns `'/library'`. `library.open('/library')` uses `savedFolder()`.
    - `readBook` goes through `BookCache` (IndexedDB key `driveId:md5`).
    - `vocab.lookup` → unavailable.
    - The `pty.*` calls are no-ops that return `''` or noop unsubscribes.
    - `on.menu` → noop.
    - `sync.onChange` emits `reviewChanged` and `libraryChanged`.
    - Pull runs on `visibilitychange` (visible) and every 30 s while visible.
  - `webSettings`: `get` / `update` over `localStorage['sr.web.settings']`, wrapped in try/catch, with the same merge rules as `SettingsStore`. `libraryPath` is `'/library'` when a folder is saved.

- [ ] **Step 1: Write failing tests** in `tests/web/webApi.test.ts` (FakeDrive seeded by the Mac `Workspace`, which also adds one highlight, one vocab word, a saved location and a review via the Mac services):
  - `open lists the Mac's books with the Mac's ids and saved location`
  - `highlights.list shows the Mac highlight`
  - `review.queue includes the Mac highlight and the word card`
  - `rate on web → Mac services reading the FakeDrive tree back into a temp dir see the review-state change and the log line`
  - `web edits survive a concurrent Mac write`: the web adds a highlight, and the FakeDrive gets a Mac-written `review-state.json` change before the push. After `flush` + `pull`, both are present.
  - `vocab.lookup returns unavailable`
  - `platform is web`
  - `settings persist in localStorage`
  - `a folder without .smartreader opens and gets .smartreader/ and knowledge/ created`
- [ ] **Step 2: Run** `npx vitest run -c vitest.web.config.ts tests/web/webApi.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add a test helper `tests/web/mirror.ts` with `downloadTree(fake, dir)` for the round-trip assertions.
- [ ] **Step 4: Run** `npx vitest run -c vitest.web.config.ts && npm run build:web`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(web): browser window.api over Drive running the shared services`.

### Task 6: Google sign-in, folder picker, reconnect banner

**Files:**
- Create: `src/web/auth/gis.ts`, `src/web/ui/SignIn.tsx`, `src/web/ui/FolderPicker.tsx`, `src/web/ui/ReconnectBanner.tsx`, `src/web/ui/WebMenu.tsx`, `src/web/ui/web.css`
- Modify: `src/web/main.tsx`, `src/renderer/src/views/ReaderView.tsx` (loading state shows download % when `readBook` reports progress through a new optional `window.api.library.onReadProgress?(cb)`, a web-only optional member in `SmartReaderApi`)
- Test: covered by Task 8 e2e. Unit `tests/web/gis.test.ts` covers the token storage and expiry logic.

**Interfaces:**
- Produces:
  - `createAuth(clientId: string, opts?: { storage?: Storage }): Auth`
  - `Auth = { token(): string | null; email(): string | null; signIn(): Promise<void>; reconnect(): Promise<void>; signOut(): void; onChange(cb: () => void): () => void }`
  - The GIS script loads from `https://accounts.google.com/gsi/client`, and the token client uses `prompt: ''` plus a `login_hint`.
  - The token and expiry are stored in `sessionStorage['sr.auth']`, and `token()` returns null 60 s before expiry.
  - Email comes from `https://www.googleapis.com/oauth2/v3/userinfo` and is stored in `localStorage['sr.email']`.
- UI:
  - Signed out → `SignIn` (logo, "Continue with Google", `data-testid="google-signin"`).
  - Signed in → the App. The renderer's Welcome "Choose your books folder" opens `FolderPicker` as a full-screen sheet:
    - The "Smart Reader libraries found in your Drive" list, with `data-testid="detected-folder"`.
    - Then a browser of My Drive folders (tap to enter, back, "Use this folder" with `data-testid="use-folder"`).
  - `ReconnectBanner` (`data-testid="reconnect"`) shows on `onAuthError`, and a tap calls `auth.reconnect()` and then `sync.flush()`.
  - `WebMenu`, a small "⋯" in the tab bar or library header, has "Switch folder" and "Sign out". Sign out clears the token, saved folder and book cache, but **keeps a non-empty outbox, and warns first** if `pending() > 0`.

- [ ] **Step 1: Write failing test** `tests/web/gis.test.ts`: `token expires 60s early`, `signOut clears token but not outbox`.
- [ ] **Step 2: Run** `npx vitest run -c vitest.web.config.ts tests/web/gis.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the auth, the UI pieces and the wiring in `main.tsx`.
- [ ] **Step 4: Run** `npx vitest run -c vitest.web.config.ts && npm run build:web && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(web): Google sign-in, Drive folder picker, reconnect banner`.

### Task 7: Mobile layout

**Files:**
- Create: `src/renderer/src/components/TabBar.tsx`, `src/renderer/src/styles/mobile.css`, `src/renderer/src/components/BottomSheet.tsx`, `src/web/public-extra/manifest.webmanifest` plus icons generated from `resources/icon.*` (extend `scripts/make-icon.mjs` or a new `scripts/make-web-icons.mjs`), linked from `src/web/index.html` with `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` and `theme-color`
- Modify: `src/renderer/src/App.tsx` (render `TabBar` when `useIsMobile()` is true), `src/renderer/src/views/ReaderView.tsx`, `src/renderer/src/reader/ReaderToolbar.tsx`, `src/renderer/src/reader/HighlightPopup.tsx`, `src/renderer/src/reader/TocDrawer.tsx`, `src/renderer/src/reader/ReaderSettingsMenu.tsx`, `src/renderer/src/views/ReviewView.tsx`, `src/renderer/src/review/ReviewCardView.tsx`, the library, vocab and stats CSS
- Test: `tests/unit/` for `useIsMobile` (matchMedia mock). The layout itself is tested in Task 8.

**Interfaces:**
- Produces:
  - `useIsMobile(): boolean`, which matches `(max-width: 760px)`, lives in `src/renderer/src/components/useIsMobile.ts`.
  - `TabBar` buttons: `data-testid="tab-continue|tab-library|tab-review|tab-vocab|tab-stats"`; the review badge is `data-testid="due-badge"`.
  - The reader toolbar gains a Highlights button (`data-testid="open-highlights"`), which opens `HighlightsPanel` inside `BottomSheet` on mobile.
  - `BottomSheet({ open, onClose, title, children })`.
- Behaviour (from the spec's "Mobile layout"):
  - The sidebar and status bar are hidden on mobile. Pomodoro and KnowledgeRate move to the Stats header and the reader toolbar.
  - The reader toolbar auto-hides after 3 s, and a tap in the middle third toggles it. A tap in the left or right third, or a horizontal swipe over 50 px, turns the page. Use the foliate view's `prev()` / `next()` and listen inside the iframe documents the reader already hooks for keys.
  - The selection popup goes below the selection and is clamped to the viewport.
  - Review action buttons stay fixed at the bottom, above the safe area.
  - The desktop Mac layout is untouched when `max-width` > 760px.
- [ ] **Step 1: Write failing unit test** `tests/unit/useIsMobile.test.tsx`: true at 390 px, false at 1280 px.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** the layout.
- [ ] **Step 4: Run** `npm run typecheck && npm test && xvfb-run -a npm run e2e && npm run build:web`. Expected: all pass (the Mac e2e proves the desktop layout is unchanged).
- [ ] **Step 5: Commit** with the message `feat(web): mobile layout — tab bar, full-screen reader with tap zones, bottom sheets, manifest`.

### Task 8: Web end-to-end tests (mobile emulation)

**Files:**
- Create: `playwright.web.config.ts`, `tests/web-e2e/{fixtures.ts,journey.spec.ts,sync.spec.ts,layout.spec.ts}`, `tests/web-e2e/gsiStub.js`
- Modify: whatever the tests expose as bugs (fix at the source)

**Interfaces:**
- `playwright.web.config.ts`:
  - `webServer`: `npm run build:web -- --mode e2e && npx vite preview -c vite.web.config.ts --port 4173`
  - In `--mode e2e`, `VITE_GOOGLE_CLIENT_ID=test-client`.
  - Projects: `mobile-chromium` (`devices['Pixel 7']`) and `mobile-webkit` (`devices['iPhone 13']`).
- Fixture `test` extends the page with a FakeDrive (Task 3) seeded the same way as the Task 5 tests:
  - `page.route('https://www.googleapis.com/**', ...)` forwards to `fakeDrive.fetch`.
  - `page.route('https://accounts.google.com/gsi/client', ...)` serves `gsiStub.js`, which defines `google.accounts.oauth2.initTokenClient` returning a client whose `requestAccessToken` calls back `{ access_token: 'test-token', expires_in: 3600 }`.
  - Userinfo is routed to `{ email: 'reader@example.com' }`.

- [ ] **Step 1: Write the specs.**
  - `journey.spec.ts`: sign in → detected folder → tap use → library shows the fixture books → continue opens at the Mac's saved location → long-press/select a sentence in the EPUB iframe (`selectText` via `page.evaluate` in the frame, then a tap to show the popup) → yellow highlight → the highlight appears in the bottom sheet → add a note → Review tab: Next on a highlight card, Got it on a word card → Vocabulary shows the word → Stats shows a streak of 1 → reload: highlight, note and review persisted, and FakeDrive's `highlights.json` contains them.
  - `sync.spec.ts`: a Mac edit (`fakeDrive.putFile` of a new highlight) appears after `visibilitychange`. Token expiry (`fakeDrive.expireToken()`) mid-session → add a highlight → the reconnect banner shows → tap → the outbox flushes, and FakeDrive has the highlight.
  - `layout.spec.ts`: at 390 px, `document.documentElement.scrollWidth <= 390` on every tab; the tab bar is visible; no element has the text "Terminal"; `hl-lookup` is absent; every tab button's bounding box is at least 44 px tall.
- [ ] **Step 2: Run** `npx playwright test -c playwright.web.config.ts`, and fix the real bugs it finds until it passes on both projects. If WebKit can't launch on this host (missing system libs), record that and keep Chromium green.
- [ ] **Step 3: Run** the full gate: `npm run typecheck && npm test && npm run test:web && xvfb-run -a npm run e2e && npm run e2e:web`. Expected: all pass.
- [ ] **Step 4: Commit** with the message `test(web): mobile e2e journeys against a fake Drive`.

### Task 9: Hosting, deploy, docs, release

**Files:**
- Create: `web/Dockerfile`, `web/nginx.conf`, `scripts/deploy-web.sh`
- Modify: `package.json` (`"version": "0.5.0"`, script `deploy:web`), `README.md` (new section "Read on your phone"), `.env.production` (the real client id once the user provides it)

**Interfaces:**
- `scripts/deploy-web.sh`:
  - Fails if `VITE_GOOGLE_CLIENT_ID` is empty.
  - Runs `npm run build:web`.
  - Copies `out/web` and `web/{Dockerfile,nginx.conf}` into a temp context.
  - Runs `gcloud run deploy smart-reader --source <ctx> --region us-central1 --project my-productivity-suite --max-instances 2 --memory 256Mi --port 8080 --quiet`.
  - Prints the URL.
- `web/nginx.conf`:
  - `listen 8080`, with SPA fallback to `/index.html`.
  - `/assets/*` gets `Cache-Control: public, max-age=31536000, immutable`, and `index.html` gets `no-cache`.
  - Headers:
    - `Content-Security-Policy`: `default-src 'self' blob: data:; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' blob: https://accounts.google.com/gsi/style; img-src 'self' blob: data: https://*.googleusercontent.com; font-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'self' blob: https://accounts.google.com; connect-src 'self' blob: data: https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com`
    - `X-Content-Type-Options nosniff`
    - `Referrer-Policy strict-origin-when-cross-origin`
  - `.webmanifest` is served as `application/manifest+json`, and `.mjs` as `text/javascript`.

- [ ] **Step 1:** Write the files. Locally run `docker build`, if docker exists, or test the config with `nginx -t` in the Cloud Build only. Run `npm run build:web` and check that `out/web/foliate-js/` exists.
- [ ] **Step 2:** Run `npm run e2e:web` again against the production build mode (the CSP is only enforced by nginx, so also add a Playwright check that loads `out/web` through a tiny static server sending the same CSP header, `tests/web-e2e/csp.spec.ts`: sign-in → open EPUB → no CSP violation in the console).
- [ ] **Step 3:** Commit with the message `feat(web): Cloud Run hosting, deploy script, README; v0.5.0`.
- [ ] **Step 4:** Deploy with `bash scripts/deploy-web.sh`. Then `curl -sI <url>` must show 200 and a `content-security-policy` header, and `curl -s <url>/ | grep -c 'assets/'` must be at least 1.
- [ ] **Step 5:** Release:
  1. Merge `dev` into `main`.
  2. Push.
  3. `git tag v0.5.0 && git push --tags`.
  4. Watch the release workflow until both DMGs are attached.
