# Smart Reader Web — design (v0.5.0)

## Intent

The user reads on a Mac with Smart Reader. The books folder lives in Google Drive (synced to the Mac by Google Drive for desktop), so the books *and* everything the app learns about them — highlights, notes, review state, vocabulary, sessions, stats, the coach's `knowledge/` — are already in Drive. The user wants to keep reading and reviewing on their phone: open a web page, sign in with Google, and get the same app, same data, laid out for a phone. Google Drive is the only sync channel between the Mac app and the web app; there is no server of ours holding data.

Success: on the phone, the user signs in with Google, opens their books folder, continues the book they were reading on the Mac at the same spot, highlights a sentence, writes a note, does today's review — and when they go back to the Mac, all of it is there (and vice versa). Nothing is ever lost or clobbered by the other device.

## Goals

- A web app, mobile-browser first (iPhone Safari and Android Chrome), also usable on a desktop browser.
- **Sign in with Google** is the gateway; the same sign-in grants Drive access.
- Opens the same Drive folder the Mac app uses and reads/writes the **same files in the same formats** (`.smartreader/*`, `knowledge/prompts.jsonl`) so both apps stay compatible.
- Same functionality as the Mac app, with a phone layout: Library (covers, Continue Reading), Reader (EPUB/MOBI/AZW3/FB2/CBZ/PDF via the existing foliate-js / pdf.js reader, themes, fonts, TOC, highlights in four colors, notes, highlight list), Review (same cards, same FSRS scheduling, Next / Sooner, Forgot / Got it for words, AI-question cards from `knowledge/prompts.jsonl`), Vocabulary (list, contexts, jump to book, delete), Stats (fresh in mind, streak, forecast, minutes, per-book), Pomodoro, reading-session tracking.
- Hosted on the user's GCP project `my-productivity-suite` on a free tier.
- Well tested: the existing Mac suite stays green; new unit + mobile-viewport e2e tests cover the web app and the Drive sync.

## Non-goals (decided by the user)

- **No AI terminal** on the web.
- **No dictionary / Look Up** on the web. Existing vocabulary words are still listed and still come up in Review as word cards; there is just no way to look up a new word from the web.

## Anti-goals

- Losing or overwriting a highlight, note, review, or reading position written on the other device.
- A separate copy of the data (a database, Firestore) that can drift from the Drive files.
- Changing the on-disk format in a way the released Mac app (v0.4.0) can't read.
- Regressing the Mac app.

## Constraints and facts

- Hosting: project `my-productivity-suite` (billing enabled). The gcloud account on this machine is only **Editor**; Firebase cannot be added and IAM can't be changed from here. Therefore hosting is **Cloud Run** (free tier), service `smart-reader`, region `us-central1`, URL `https://smart-reader-673514603120.us-central1.run.app`. The owner (spencertse122@gmail.com) makes it public once (`allUsers` → `roles/run.invoker`) and creates the OAuth consent screen + Web OAuth client (console only). The Client ID is a public value and is baked into the build (`VITE_GOOGLE_CLIENT_ID`).
- OAuth app stays in **Testing** with spencertse122@gmail.com as a test user; it needs the full `https://www.googleapis.com/auth/drive` scope because the folder was created by Drive for desktop, not by this app (`drive.file` can't see it). The "unverified app" screen is accepted.
- Browser-only (static) app: auth via **Google Identity Services token client** (`accounts.google.com/gsi/client`). Access tokens last ~1 h, there are no refresh tokens; renewing needs a user tap (popup). Writes must survive that.
- Data format reference: `docs/superpowers/specs/2026-10-20-smart-reader-design.md` §"Folder layout" and following, plus the vocabulary and notes specs.

## Architecture (decided)

### Same repo, same code

The web app lives in this repo under `src/web/` and is built with its own Vite config (`vite.web.config.ts`, output `out/web`). It renders the **existing renderer** (`src/renderer/src/App.tsx` and everything under it) and installs its own `window.api` implementing `SmartReaderApi` (`src/shared/api.ts`). The renderer keeps talking to `window.api` exactly as today.

The web `window.api` runs the **existing main-process services unchanged** (`LibraryService`, `HighlightStore`, `VocabStore`, `ReviewService`, `PromptWatcher`, `SessionLog`, `StatsService`, scheduler, cards, metrics, markdown mirrors) in the browser. Those import `node:fs/promises`, `node:fs`, `node:path`, `node:crypto`, `node:os` and use `Buffer`; the web build aliases them to browser shims:

- `node:fs/promises`, `node:fs` → a **virtual file system** (VFS, below) implementing exactly the subset the services use: `readFile`, `writeFile`, `appendFile`, `open` (handle with `read`, `stat`, `writeFile`, `sync`, `close`), `rename`, `copyFile`, `mkdir`, `readdir({ withFileTypes })`, `stat`, `access`, `watchFile`/`unwatchFile`, `constants`. Errors carry Node-style `code` (`ENOENT`, …) because the services check `code === 'ENOENT'`.
- `node:path` → POSIX `path` (`path-browserify` or a tiny equivalent).
- `node:crypto` → `createHash('sha256')` (synchronous, `@noble/hashes`) and `randomUUID` (`crypto.randomUUID`).
- `node:os` → `homedir()` returning `/home` (never equal to the library root).
- `Buffer` → the `buffer` package, installed as a global.

`Workspace.open` is not used on the web (it runs `setupWorkspace`, which installs coach templates — that stays the Mac's job). A small `src/web/webWorkspace.ts` composes the same services the same way `src/main/workspace.ts` does, minus setup, plus creating `.smartreader/` and `knowledge/` dirs if missing. The web IPC equivalent (`src/web/webApi.ts`) mirrors `src/main/ipc.ts` handler-for-handler (same events: `reviewChanged` after highlight/vocab/review writes, `libraryChanged` after metadata/status), minus `pty`, `vocab.lookup` (returns `{ ok: false, reason: 'unavailable' }`), and `chooseFolder` (see Connect flow).

`SmartReaderApi` gains `platform: 'mac' | 'web'` (preload sets `'mac'`). The renderer hides the Terminal (status bar button, ⌘J handling, `TerminalPanel` mount) and the **Look Up** popup button when `platform === 'web'`.

### Virtual file system + Drive sync (`src/web/vfs/`, `src/web/drive/`)

- The chosen Drive folder is mounted at the VFS path `/library` (so `library.open('/library')` and `Book.path` stay relative paths exactly like the Mac).
- **Index.** On open, the VFS lists the Drive tree under the folder (breadth-first `files.list` with `'<id>' in parents and trashed=false`, fields `id,name,mimeType,size,md5Checksum,modifiedTime,version,parents`, paging). It walks everything `scanFolder` would walk (skips dot-dirs and `knowledge/`, `node_modules/`) **plus** `.smartreader/` (full) and `knowledge/` (top level only — the app reads only `knowledge/prompts.jsonl`). Each entry keeps `driveId`, `size`, `md5`, `mtimeMs` (from `modifiedTime`), and, once read, its bytes. Google-native docs (no `size`) are ignored.
- **Reads** are lazy: the first `readFile` downloads `files/<id>?alt=media`. `open(...).read(buf, off, len, pos)` on a not-yet-downloaded file uses an HTTP `Range` request (book-id hashing reads only the first 1 MiB; MOBI DRM detection reads a header). Book bytes and covers are cached in IndexedDB keyed by `driveId + md5`, so reopening a book is offline-fast.
- **Writes** apply to memory immediately (services see their own writes at once) and enqueue a push. Temp files (`*.tmp-*`) live only in memory; `rename(tmp, target)` becomes "new content for target". `*.bak` and `*.corrupt-*` copies stay in memory only (never pushed — they are the Mac's local safety net). `mkdir` creates Drive folders (pushed before any child). Pushes are serialized per path and coalesced (only the latest content per path is uploaded): `files.update` (media upload) for existing files, multipart `files.create` with `parents` for new ones. Every push records the resulting `md5Checksum` so our own changes are recognised when they come back through the changes feed.
- **Outbox.** Pending pushes (path + content + base md5) are persisted in IndexedDB before upload and removed after success, so a closed tab, a dead network or an expired token never loses a write; the outbox replays on next start / reconnect.
- **Pulls** use the Drive changes feed: `changes.getStartPageToken` at open, then `changes.list` (`includeRemoved`, `restrictToMyDrive=false`, fields `newStartPageToken,nextPageToken,changes(fileId,removed,file(id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed))`). A change to a known entry updates its metadata and drops cached bytes if `md5` differs; a new file whose parent is a known folder is added; removed/trashed entries are dropped. When something relevant changed, the web API emits `reviewChanged` and `libraryChanged` (and `PromptWatcher`'s `watchFile` listener fires for `knowledge/prompts.jsonl`). Pulls run: at open; when the page becomes visible; every 30 s while visible; and **before every mutating API call** if the last pull is older than 3 s.
- **Conflicts.** A conflict is a remote change to a path that has an un-pushed local change. Resolve with a **three-way merge** against the last-synced content (`base`): for JSON files a generic structural merge — objects merge key by key; arrays whose items all have a string `id` merge by id (an item changed only on one side takes that side; changed on both → the one with the later `updatedAt`, else local); other values: if local differs from base take local, else remote. For `.jsonl` files: remote lines + local lines not in base (dedupe identical lines, keep order). For `highlights.md` / `vocab.md` (regenerated mirrors): take local. The merged result is written locally and pushed. Unit-test the merge exhaustively.
- **Freshness inside the services.** `jsonFile` (`src/main/store/jsonFile.ts`) currently caches forever. Change it (shared by Mac and web) to remember the `(mtimeMs, size)` signature of what it last loaded or wrote and, on `read()` / `update()`, `stat` the file and reload if the signature changed (missing file = keep cache only if we never saw it on disk). On the web the VFS updates `mtimeMs/size` when a pull brings a new version, so the next service call sees the other device's data; `update()` then applies its mutation **on top of the fresh content** — this is what prevents clobbering, on both platforms.

### Mac app changes (ship as v0.5.0)

1. `jsonFile` freshness as above (protects web edits from being overwritten by the Mac's in-memory cache — this is required, not optional).
2. When the Mac window regains focus, main sends `eventReviewChanged` and `eventLibraryChanged` so open views refetch; the reader re-lists highlights on `reviewChanged` if it doesn't already.
3. `platform: 'mac'` in preload.
Nothing else changes on the Mac; formats are unchanged.

**Users must update the Mac app to v0.5.0 before using the web app.** v0.4.0 caches each data file for the life of the process and writes that copy back on the next page turn, highlight or review, which overwrites phone edits made since it started. The README says so.

**Known limit (I3):** the Mac side has no merge. If the phone pushes a file and the Mac writes the same file before Google Drive for desktop has downloaded that version (typically a few seconds), the Mac's later write wins on the Mac side, and Drive for desktop then uploads it as the newest revision. The README tells users to give Drive a few seconds when switching devices.

### Auth and Connect flow (`src/web/auth/`, `src/web/ui/`)

- GIS token client, scope `https://www.googleapis.com/auth/drive openid email`. Signed-out screen: Smart Reader logo + "Continue with Google". The access token and expiry are kept in `sessionStorage` (and the last email in `localStorage` as `login_hint`). On a 401 the sync pauses, writes keep queuing, and a slim banner "Session expired — tap to reconnect" calls `requestAccessToken({ prompt: '' })` from the tap.
- The renderer's Welcome screen calls `library.chooseFolder()`; on the web this opens a **folder picker sheet**: first, auto-detected Smart Reader libraries (Drive search `name='.smartreader' and mimeType='application/vnd.google-apps.folder' and trashed=false` → their parent folders, shown by name with their path), then a simple Drive folder browser (My Drive, drill into folders, "Use this folder"). It resolves with `/library` after mounting; the folder id is remembered in `localStorage` so the next visit reopens it directly (`settings.libraryPath = '/library'`). A "Switch folder" / "Sign out" entry lives in the web's settings/More screen.
- Home-screen (standalone) app: the GIS popup does not reliably return on iOS, so sign-in and reconnect use the OAuth 2.0 implicit flow by redirect instead (`response_type=token`, `redirect_uri = <origin>/`, same scope, `include_granted_scopes=true`, `login_hint`, a random `state` in `sessionStorage`). On return the token is taken from the URL fragment after the state check, stored like the GIS token, and the fragment is cleared. Before navigating away the app waits until every edit under way is in the IndexedDB outbox. The redirect URI must be registered on the OAuth client. Sign out revokes the token (best effort).
- Web `settings` persist in `localStorage` (`sr.web.settings`), same `Settings` shape and defaults; `terminalPosition` and `recentLibraries` are unused.

### Mobile layout (renderer CSS + small components)

Applies under `@media (max-width: 760px)` (and to touch devices in portrait); wider browsers keep the desktop layout.
- **Bottom tab bar** replaces the sidebar: Continue (when there is a last-opened book), Library, Review (due badge), Vocabulary, Stats. Respects `env(safe-area-inset-bottom)`; uses `100dvh`.
- **Status bar** folds into the tab bar area / a compact strip: Pomodoro control and "fresh in mind" stay reachable (e.g. on the Stats screen header and the reader toolbar).
- **Reader**: full screen; toolbar at top that auto-hides, shown by a tap in the middle third; tap left/right thirds or swipe to turn pages (paginated); TOC as a full-screen sheet; reader settings as a bottom sheet; the **Highlights** list (the desktop sidebar's Highlights tab) is a bottom sheet opened from a toolbar button; Note button in the toolbar. Selection popup: touch-sized color buttons, placed **below** the selection (iOS shows its own callout above), never off-screen.
- **Review**: card fills the screen; Next / Sooner (and Forgot / Got it) as large buttons at the bottom; tapping the card flips/reveals.
- **Library**: 2–3 column cover grid. **Vocabulary**: single column list, tap to expand. **Stats**: charts at full width.
- Touch targets ≥ 44 px; no hover-only affordances.
- A web app manifest (name, icons from `resources/`, `display: standalone`, theme color) so "Add to Home Screen" opens full-screen. No service worker.

### Hosting and deploy

- `npm run build:web` → `out/web`. A `web/Dockerfile` (nginx-unprivileged or `nginx:alpine`) serves it with SPA fallback, long cache for hashed assets, no-cache for `index.html`, and security headers: a CSP equivalent to the Electron one plus `https://accounts.google.com` (script, frame, connect), `https://www.googleapis.com` and `https://oauth2.googleapis.com` (connect), `https://*.googleusercontent.com` (img/connect, for thumbnails if used); `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`. Container listens on `$PORT` (8080).
- `npm run deploy:web` → `gcloud run deploy smart-reader --source web-deploy-context --region us-central1 --project my-productivity-suite --max-instances 2 --memory 256Mi` (Cloud Build builds the image). The client id comes from `VITE_GOOGLE_CLIENT_ID` at build time (a committed `.env.production` is fine — it is public).

### Tests

- Existing `npm test`, `npm run typecheck`, `xvfb-run -a npm run e2e` stay green.
- **Fake Drive** (`tests/web/fakeDrive.ts`): an in-memory implementation of exactly the Drive v3 REST subset we call (files.list with the `in parents` / name / mimeType queries we use, files.get metadata + `alt=media` with `Range`, files.create multipart + folder, files.update media, changes.getStartPageToken / changes.list, 401 injection, latency/failure injection), exposed as a `fetch`-compatible function. Used by unit tests and by Playwright through `page.route('https://www.googleapis.com/**')`.
- Unit (vitest, node env with the web aliases): VFS semantics (ENOENT codes, rename-over, appendFile, readdir types, Range reads), push coalescing and outbox replay, changes-feed application, merge3 (JSON objects, id arrays, updatedAt tie-break, jsonl union), `jsonFile` freshness (node fs, Mac path), the web API end to end on a fake-Drive library seeded **by the Mac services** (open, list books, add highlight, rate a card, log session, stats), and the reverse: data written by the web API is read correctly by the Mac services from a real temp folder.
- E2E (Playwright, `tests/web-e2e/`, `vite preview` of the real build, iPhone-13 viewport + touch, Chromium; WebKit too if it installs on the runner): GIS stubbed by a routed fake `gsi/client` script; journeys — sign in → auto-detected folder → library shows covers → open EPUB → continue from the Mac's saved location → select text (touch) → highlight → note → highlight list sheet → review a card (Next/Sooner) and a word card → vocabulary list → stats → reload: everything persisted in the fake Drive; a "Mac" edit injected into the fake Drive appears after visibility change; token expiry mid-session → banner → reconnect → queued writes land; layout checks (no horizontal scroll at 390 px, tab bar visible, Terminal and Look Up absent).
- Post-deploy smoke: `curl` the Cloud Run URL for 200, CSP header present, JS assets load.

### Release

- Merge to `main`, bump to **0.5.0**, tag `v0.5.0` (DMGs ship the Mac freshness fix), deploy the web app, README gains a "Read on your phone" section (URL, sign-in, the unverified-app screen, Add to Home Screen, what's not on the web).

## Builder's calls (settled after the builder check)

These were not discussed with the user. They are the designer's calls.

1. **Book identity on the web.** `LibraryService` gains a constructor option `{ trustMtime: boolean }` (default `true`, so the Mac is unchanged). The web passes `false`. Then a known book counts as unchanged when `path` and `fileSize` match, so it isn't re-hashed. The stored `mtimeMs` of an existing book is never overwritten. A book the web sees for the first time is hashed over a 1 MiB Range read, and its `mtimeMs` comes from the Drive `modifiedTime`. The Mac later re-hashes it once (local and cheap), gets the same id and keeps the record. Hashing reads the bytes, and Drive keeps them identical.
2. **No-op writes are skipped.** `jsonFile.update` doesn't write, or run `afterWrite`, when the mutated value serialises to the same JSON as the loaded value. `ReviewService.sync()` and `scan()` run on every open or list, and without this each one would push to Drive. This benefits both platforms.
3. **Merge granularity.** Merges are per file and per record, never per FSRS field:
   - `review-state.json` merges `cards[id]` as a whole. If one side changed a card, take that side. If both did, the later `last_review` wins, with local winning a tie.
   - `library.json` merges `books[id]` per field. `location` and `progress` move together as one unit. When both sides changed the same field, local wins. These conflicts need an un-pushed local change, so they are rare. Positions are pushed within seconds.
   - `highlights.json` and `vocab.json` merge items by `id`. If both sides changed an item, the later `updatedAt` wins.
   - Other JSON files use the generic structural merge.
   - `.jsonl` files take the line union.
4. **Offline and expired tokens.**
   - A failed pre-mutation pull (network or 401) doesn't block the mutation. It applies to the local state and is queued.
   - A read that needs bytes not yet downloaded fails with a clear error, and a 401 also shows the reconnect banner.
   - Starting fully offline (cold) is **not** a goal. Cached books open without a download once the user is signed in.
5. **Freshness scope.** Freshness checks happen only inside `jsonFile`. `readJson` and `readJsonl` already read every time, and the review queue and stats are recomputed per call. Settings on the Mac go through `jsonFile` too, and one `stat` per read is acceptable.
6. **A Drive folder never opened on the Mac.** It is allowed. The web creates the `.smartreader/` and `knowledge/` folders. The services create their files lazily, as on the Mac. Coach templates arrive when the Mac app first opens the folder.
7. **Large books.** A book is downloaded in full, with a progress indicator in the reader's loading state, and there is no size cap. foliate-js and pdf.js stay under the renderer's `public/`, which the web build shares. The web CSP must allow what the Electron CSP allows (`blob:` workers, frames, styles).
8. **Test wiring.**
   - Web unit tests run under a separate `vitest.web.config.ts` (`npm run test:web`).
   - Web e2e tests run under `playwright.web.config.ts` (`npm run e2e:web`).
   - `npm test` and `npm run e2e` stay Mac-only and unchanged. `test:all` runs everything.
9. **Corrupt-file recovery on the web.** A remote JSON file that fails to parse is re-downloaded once before recovery. After that, the Mac rules apply, using the `.bak` copy the Mac synced. The web pushes `.corrupt-*` copies, so the damaged data survives, but it never pushes `.bak` files.
10. **Mac focus refresh.** On focus the Mac only emits refetch events. Reading position is already saved on every page turn.

## Left to the builder

Component structure for the mobile sheets/tab bar, exact CSS, how the outbox schema looks, IndexedDB library choice (plain IDB or `idb-keyval`), exact retry/backoff (exponential, cap ~30 s), the folder browser's look, icon generation for the manifest, how the fake Drive parses `q`.
