# Smart Reader — Design Spec

**Date:** 2026-10-20
**Status:** Approved in brainstorming; pending written-spec review
**Repo:** `spencertse122/mac-smart-reader` (GitHub; currently public, may be made private later)

## 1. Purpose

A local-only macOS ebook reader for non-fiction that maximizes **retrievable knowledge gained per hour of effort**. The unit of retention is the user's **highlights**: what the user highlights is what the app helps them remember and retrieve. An AI coach is available on the side, in an embedded terminal, but the app is fully useful without it.

The learning methodology (retrieval practice, spacing, corrective feedback, "stored ≠ known") comes from the user's methodology document, saved in this repo as `docs/methodology.md` and bundled into the coach skills.

### Success criteria

1. The user installs the app on their Mac with one command and it works out of the box.
2. Opening a books folder shows a cover library of EPUB, MOBI, AZW3, FB2, CBZ and PDF files, and any book opens and reads smoothly.
3. Selecting text and clicking a color saves a highlight in the books folder, organized by book, and the highlight survives an app restart and a file rename.
4. Every highlight becomes an FSRS review card automatically; reviewing works with no AI involved.
5. Running `claude` (or `codex` / `gemini`) in the embedded terminal, the coach skills can distill highlights into a cross-book concept graph, write better review questions that the app picks up live, and run recall sessions.
6. The status bar shows a Pomodoro timer and a retrievable-knowledge-per-hour metric.

### Non-goals

- Cloud sync, accounts, multi-user, mobile.
- AI calls made by the app itself (all AI runs through the user's terminal agent).
- DRM-protected books.
- Annotation export to other apps; editing book files.
- Apple code signing / notarization (the app ships unsigned; the installer clears quarantine).
- Speed-reading features such as RSVP.

## 2. Architecture

Electron app, TypeScript throughout, React + Vite for the renderer, built with electron-vite and packaged with electron-builder.

```
┌──────────────────────── Electron main process ────────────────────────┐
│ LibraryService   scan folder, hash books, extract metadata and covers │
│ StoreService     atomic JSON/JSONL read/write in .smartreader/        │
│ ReviewService    FSRS scheduling (ts-fsrs), card queue, metric        │
│ PromptWatcher    watches knowledge/prompts.jsonl, merges AI questions │
│ PtyService       node-pty shell sessions, cwd = books folder          │
│ WorkspaceSetup   first-run creation of knowledge/, skills, AGENTS.md  │
│ Settings         electron-store: last folder, theme, timer lengths    │
└───────────────┬───────────────────────────────────────────────────────┘
                │ typed IPC (contextBridge preload, no nodeIntegration)
┌───────────────┴──────────────── Renderer (React) ─────────────────────┐
│ Sidebar: Library │ Highlights │ Review (due badge)                    │
│ Main:    LibraryGrid │ Reader (foliate-js / pdf.js) │ ReviewSession │ │
│          Stats                                                        │
│ Panel:   Terminal (xterm.js), toggled with ⌘J                         │
│ StatusBar: Pomodoro · due cards · knowledge/hour                      │
└───────────────────────────────────────────────────────────────────────┘
```

**Key principle:** the app and the terminal agent never talk directly. **The books folder is the interface.** Each file has exactly one writer.

### Units and their boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `LibraryService` | Recursively find supported files; compute book id; extract title, author and cover; maintain `library.json` | StoreService, format parsers |
| `StoreService` | Atomic writes (write temp file → fsync → rename), `.bak` of the last good version, JSONL append, corruption recovery | fs |
| `HighlightStore` | CRUD on per-book `highlights.json`; regenerate `highlights.md` | StoreService |
| `ReviewService` | Create cards for new highlights, schedule them with FSRS, build the due queue, log reviews, compute the metric, write daily snapshots | StoreService, ts-fsrs |
| `PromptWatcher` | Watch `knowledge/prompts.jsonl` (chokidar); expose the latest question for each highlight id; ignore malformed lines | fs |
| `PtyService` | Spawn the user's login shell (`$SHELL -l`) in the books folder; resize; kill on window close | node-pty |
| `WorkspaceSetup` | Idempotently create `knowledge/` skeleton, skills, `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` from bundled templates; never overwrite files the user has edited (version marker comparison) | bundled templates |
| Reader adapters | One interface `{open, goTo(location), getSelection, renderHighlights, onRelocate}` with two implementations: `FoliateReader` (EPUB/MOBI/AZW3/FB2/CBZ) and `PdfReader` (pdf.js) | foliate-js, pdfjs-dist |

## 3. Data model (books folder)

```
<books folder>/
├── *.epub *.mobi *.azw3 *.azw *.fb2 *.cbz *.pdf   (any subfolder depth)
├── .smartreader/                      APP writes; agent reads only
│   ├── VERSION                        data-format version (1)
│   ├── library.json
│   ├── books/<slug>/
│   │   ├── highlights.json            source of truth
│   │   ├── highlights.md              readable mirror (regenerated)
│   │   └── cover.jpg                  extracted or generated cover
│   ├── review-state.json              FSRS card state per highlight id
│   ├── review-log.jsonl               append-only review events
│   ├── sessions.jsonl                 append-only reading/pomodoro sessions
│   └── metrics.jsonl                  one daily snapshot line per day
├── knowledge/                         AGENT writes; app reads only
│   ├── index.md
│   ├── concepts/<concept-slug>.md
│   ├── books/<slug>.md
│   ├── prompts.jsonl
│   └── coach-log.jsonl
├── .claude/skills/<skill>/SKILL.md    coach skills (Claude Code)
├── .agents/skills/<skill>/SKILL.md    same skills (Codex and others)
├── CLAUDE.md  AGENTS.md  GEMINI.md    agent entry points
```

**Book identity:** `id` = SHA-256 of the first 1 MiB plus the file size, truncated to 16 hex characters. `slug` = kebab-case title (max 50 characters) + `-` + the first 6 characters of `id`. A moved or renamed file is matched by its id and its path is updated.

### `library.json`
```json
{ "version": 1, "books": { "<id>": {
  "id": "…", "slug": "…", "path": "relative/to/folder.epub", "format": "epub",
  "title": "…", "author": "…", "addedAt": "ISO", "lastOpenedAt": "ISO|null",
  "location": "<CFI or pdf:page>", "progress": 0.42, "status": "ok|unsupported|drm|error",
  "statusReason": "string|null" } } }
```

### `highlights.json`
```json
{ "version": 1, "bookId": "…", "highlights": [ {
  "id": "h_<ulid>",
  "location": "epubcfi(...) | pdf:<page>:<startOffset>-<endOffset>",
  "quote": { "exact": "…", "prefix": "≤64 chars", "suffix": "≤64 chars" },
  "context": "the sentence(s) surrounding the highlight, ≤600 chars",
  "chapter": "chapter title or null",
  "color": "yellow|green|blue|pink",
  "note": "string|null",
  "createdAt": "ISO", "updatedAt": "ISO", "deleted": false } ] }
```
`quote` is a W3C TextQuoteSelector-style fallback, used to re-anchor a highlight if its location stops resolving. Deleting a highlight sets `deleted: true` and suspends its card (it is not hard-deleted, so the agent's citations do not dangle).

### `highlights.md` (generated)
```markdown
# <Title> — <Author>
<!-- generated by Smart Reader; do not edit -->
## <Chapter>
> <exact quote>
- id: h_… · color: yellow · 2026-10-20
- note: …
```

### `review-state.json`
```json
{ "version": 1, "desiredRetention": 0.9, "cards": { "<highlightId>": {
  "bookId": "…", "due": "ISO", "stability": 0, "difficulty": 0,
  "elapsed_days": 0, "scheduled_days": 0, "reps": 0, "lapses": 0,
  "state": "New|Learning|Review|Relearning", "last_review": "ISO|null",
  "suspended": false } } }
```
Field names follow ts-fsrs's `Card` type so that state can be (de)serialized directly.

### `review-log.jsonl` (one line per review)
```json
{"ts":"ISO","highlightId":"…","bookId":"…","rating":"again|hard|good|easy","promptType":"cloze|ai","durationMs":8400,"retrievabilityBefore":0.83}
```

### `sessions.jsonl`
```json
{"start":"ISO","end":"ISO","kind":"reading|review|break","bookId":"…|null","minutes":25,"pomodoro":true}
```
A reading session is recorded while a book is open and the window is focused. It ends when the book is closed or after 3 minutes without any input (mouse, keyboard or page turn). Pomodoro runs mark `pomodoro: true`.

### `knowledge/prompts.jsonl` (agent-written)
```json
{"highlightId":"h_…","question":"Why does …?","answer":"optional model answer","createdAt":"ISO","by":"distill"}
```
The last valid line for a highlight id wins. A line with an unknown highlight id or invalid JSON is ignored, and a count of skipped lines is shown in the Review tab.

### `knowledge/concepts/<concept-slug>.md` (agent-written; format defined by the skills)
```markdown
---
concept: Loss aversion
status: exposed | understood | recalled | transfer
sources: [{book: thinking-fast-and-slow-a1b2c3, highlights: [h_…, h_…]}]
related: [[prospect-theory]], [[endowment-effect]]
updated: 2026-10-20
---
## In my words
## What the sources say      (each claim cites a highlight id)
## Connections               (each tagged: authors-agree | ai-suggested-analogy)
## Open questions / uncertainty
```

`coach-log.jsonl` stores a record of each recall attempt: concept, question, rubric scores (accuracy 0–3, depth 0–3, transfer 0–3, independence: unaided/minor-hint/substantial-hint/answer-exposed), confidence before feedback, and a timestamp.

## 4. Review system

**Cards:** each non-deleted highlight is one card, created as `New` and due immediately.

**Card front (prompt), in priority order:**
1. If `prompts.jsonl` has a question for the highlight, show the **AI question** with a small "AI" tag.
2. If the user wrote a note that ends in `?`, show **that question**.
3. Otherwise show a **context cloze**: the book title and chapter, then `context` with the highlighted text replaced by a blank (`▁▁▁▁ (~N words)`). If a highlight is longer than 40 words, the first 6 words stay visible as a cue.

**Card back:** the full highlight, the note, the AI model answer if there is one, and an "Open in book" link.

**Flow:** the front is shown → the user recalls → Space reveals the back → keys 1–4 rate it (Again / Hard / Good / Easy) → ts-fsrs schedules the next review (default parameters, desired retention 0.9) → the review is logged. Each review session has a default cap of 20 new cards per day (configurable). Due cards are ordered by the lowest current retrievability first.

**Metric, retrievable knowledge per hour:**
- `K(t)` = Σ over non-suspended cards with ≥1 review of FSRS retrievability R at time t. Never-reviewed cards count 0, because exposure is not retention.
- On first launch each day, a snapshot `{date, K, cumulativeMinutes}` is appended to `metrics.jsonl`. `cumulativeMinutes` is the total of reading and review minutes from `sessions.jsonl`.
- The **status bar shows** the 30-day rate: `(K_now − K_30d_ago) / hours_in_last_30d`. Before 30 days of data exist, the earliest snapshot is used instead.
- The **stats page shows** the K trend, minutes per day, the due-card forecast for the next 14 days, the review streak and per-book card counts.

## 5. UI and UX (Apple Books-inspired)

- **Window:** `titleBarStyle: hiddenInset` with native traffic lights, a vibrancy sidebar, the system font (SF Pro), and following the system light/dark setting.
- **Welcome:** a "Choose your books folder" button using the native folder picker. The folder is remembered, and **File → Open Folder… (⇧⌘O)** switches folders; the most recent folders are listed.
- **Library:** a "Continue Reading" row and a cover grid with a progress bar under each cover. You can search by title or author and sort by recent, title or author. Unsupported or DRM books appear grayed out with the reason shown on hover. A generated cover (title on a soft gradient) is used when a book has none.
- **Reader:** themes White, Sepia, Gray and Night; a font menu with size and line spacing; paginated or scrolled layout; a TOC drawer; ←/→ and swipe to turn pages; controls auto-hide after 2 seconds without input. The position is saved continuously.
- **Highlight popup:** appears on text selection, with 4 color dots, a note button and Copy. Clicking an existing highlight lets you change its color, edit its note or delete it.
- **Highlights tab:** the current book's highlights grouped by chapter; clicking one jumps to its location.
- **Review:** a centered card in large serif type with keyboard-first controls (Space, 1–4, ⌘O to open in book). It ends with a summary of cards reviewed, minutes spent and average retrievability before review.
- **Pomodoro:** a status-bar control with 25/5 by default (configurable) and long breaks every 4 cycles. When a break starts, the reader dims gently, a soft chime plays (it can be muted), and a card suggests "Review N due cards?" with Review and Skip buttons. Start, pause and skip are available from the status bar and with ⌥⌘P.
- **Terminal:** a bottom panel by default (it can be moved to the right side), resizable and toggled with ⌘J, with colors from the reader theme. There's one shell session, and a "+" button adds another tab.
- **Stats:** a single page; see §4.

## 6. Coach skills

The skills are bundled as templates and installed by `WorkspaceSetup` into `.claude/skills/` and `.agents/skills/`. `GEMINI.md` and `AGENTS.md` list each skill and its path so that agents without native skill loading can read them. Every skill embeds the methodology rules: ask before explaining, require an attempt before revealing an answer, give source-grounded feedback in the order right → wrong → what the source says → why it matters → repair, use a hint ladder, never mark something as known just because it's stored, and keep questions and interruptions limited.

| Skill | Inputs | Writes |
|---|---|---|
| `distill` | `highlights.md` and `highlights.json` for highlights newer than the latest `distill` entry in `prompts.jsonl` | concept notes, book pages, `index.md`, `prompts.jsonl` |
| `preview` | book TOC or chapter headings (via the agent reading the file or the user pasting them), `knowledge/` | nothing required; may note goals in the book page |
| `recall` | recent highlights, concept notes | `coach-log.jsonl`, concept `status` |
| `drill` | `review-log.jsonl` (lapses, low R), `coach-log.jsonl` | `coach-log.jsonl`, new prompts for weak cards |
| `ask` | everything in `knowledge/` and highlights | nothing (read-only) |
| `weekly` | the last 7 days of logs and sessions | `index.md` weak-spots section, `coach-log.jsonl` |

**Concept status rules:** `exposed` (a note exists) → `understood` (the coach observed a correct explanation, hinted allowed) → `recalled` (unaided accuracy ≥2 after a delay of at least 1 day) → `transfer` (unaided transfer ≥2 on a novel scenario). Status can drop after failures.

**`CLAUDE.md`, `AGENTS.md` and `GEMINI.md`** say: this is a Smart Reader books folder; read `knowledge/index.md` first; the app's files in `.smartreader/` are read-only for agents; write only in `knowledge/`; available skills are listed with one line each.

## 7. Error handling

- **Atomic writes and recovery:** every write follows temp → fsync → rename, keeping `.bak` of the previous version. When a JSON parse fails, the app restores the `.bak`, renames the bad file to `*.corrupt-<ts>`, and shows a non-blocking toast. JSONL readers skip bad lines.
- **Book open failure:** the book gets status `error` or `drm` with its reason, a toast is shown, and the library stays usable. DRM is detected by `META-INF/encryption.xml` / `rights.xml` in EPUB and the encryption flag in the MOBI header.
- **Missing folder:** if the remembered folder no longer exists, the app goes back to the Welcome screen with a message.
- **Re-anchoring:** if a highlight location does not resolve, the app searches for `quote.exact` with the prefix and suffix in the same section. If that fails too, the highlight stays listed (and reviewable) but is flagged "location lost."
- **Terminal:** if the shell exits, the panel shows "Process exited — press Enter to restart." Spawn errors are shown inline.
- **Agent CLIs:** the app does not detect or install them. The welcome note in the terminal shows the commands, and the README links to install docs.

## 8. Build, packaging and install

- **Development on the Linux VPS:** `npm run dev`, `npm test` (Vitest) and `npm run e2e` (Playwright `_electron` under xvfb).
- **GitHub Actions:**
  - `ci.yml` runs on push: lint, typecheck and unit tests on ubuntu, and e2e on ubuntu with xvfb.
  - `release.yml` runs on a `v*` tag: on a macOS arm64 runner (`macos-latest`) it runs `electron-builder --mac dmg --arm64 --x64` with an ad-hoc signature (`identity: '-'`, no Apple account) using node-pty's per-arch N-API prebuilds. It verifies both bundles with `codesign --verify --deep --strict`, checks the x64 binaries with `lipo`, smoke-launches the arm64 app and the x64 app (under Rosetta), and uploads `Smart-Reader-<ver>-arm64.dmg` and `-x64.dmg` to a GitHub Release.
- **`install.sh`:**
  - Detects the architecture and downloads `*-<arch>.dmg` from the latest release of `spencertse122/mac-smart-reader`: with `gh release download` when `gh` is installed and logged in, otherwise with `curl` via the public GitHub releases API. If both fail (for example, the repo was made private), it says to run `brew install gh && gh auth login`.
  - Install one-liner: `curl -fsSL https://raw.githubusercontent.com/spencertse122/mac-smart-reader/main/install.sh | bash` (for a private repo: `gh api repos/spencertse122/mac-smart-reader/contents/install.sh --jq .content | base64 -d | bash`).
  - Mounts the DMG, copies the app to `/Applications` (replacing any old version), unmounts it, runs `xattr -dr com.apple.quarantine "/Applications/Smart Reader.app"`, and opens the app.
  - Re-running it updates the app.
- **README:** install steps, first-run steps, installing Claude Code / Codex / Gemini CLI, and a reminder to back up the books folder.
- **Minimum macOS:** 13.

## 9. Testing

- **Unit (Vitest):** book id and slug, library scan (fixture tree including unsupported files), StoreService atomic write and recovery, HighlightStore CRUD and Markdown mirror, card creation and prompt priority, cloze generation, FSRS wrapper and queue ordering, PromptWatcher merge and bad lines, metric computation and snapshots, WorkspaceSetup idempotency and no-clobber, session tracking idle rules.
- **E2E (Playwright + Electron):** with public-domain fixtures (Project Gutenberg EPUB and MOBI, plus a small generated PDF) the test opens the folder → sees covers → opens the EPUB → selects text → highlights it → restarts the app → the highlight persists → reviews the card with the keyboard → appends a line to `prompts.jsonl` → the card shows the AI question → toggles the terminal and runs `echo` → sees the output.
- **Release smoke test:** on the macOS runner, the built `.app` launches with a temporary folder and the window renders (Playwright against the packaged binary).

## 10. Open items to verify during implementation

- The exact skill directories that Codex CLI and Gemini CLI auto-load. Fallback: entries in `AGENTS.md` / `GEMINI.md` that point to the SKILL.md paths, as specified above.
- How completely foliate-js extracts MOBI/AZW3 metadata and covers; fall back to the generated cover.
- That node-pty cross-compiles for x64 on the arm64 runner. Fallback: a second job on an Intel macOS runner, if one is still offered.
- foliate-js is not published on npm. It will be vendored at a pinned commit, with its MIT license kept.
