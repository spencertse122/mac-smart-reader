# v0.2.0 — Notes, simpler Review, Continue Reading

Approved by the user in chat on 2026-10-20. Builds on `2026-10-20-smart-reader-design.md`.

## Why
The user (ADHD, reads non-fiction) wants to (1) jot bigger thoughts while reading without selecting text, and have them resurface in Review like highlights; (2) a Review that simply re-shows their own highlights/notes — no fill-in-the-blank, no grading; (3) one click back to the book they were reading from anywhere in the app.

Anti-goals: anything that slows reading down; grading friction in Review; losing or rewriting existing highlights/cards/files.

## 1. Notes
- **Data:** a note is a `Highlight` with `kind: 'note'`. `kind` is optional; absent means `'highlight'` (existing files stay valid, no migration). A note has `note` = the text (required, non-empty), `quote = { exact: '', prefix: '', suffix: '' }`, `context: ''`, `location` = CFI of the reading position when written (may be '' if unknown), `chapter`, `position` (fraction), `color: 'yellow'` (unused).
- **Store:** `HighlightStore.addNote(bookId, { location, chapter, position, text })`. Empty/whitespace text → `HighlightError('Note is empty')`; text over 5000 chars → `HighlightError('Note is too long')`. `update` on a note may change `note` but not to empty (→ `HighlightError('Note is empty')`). `remove` works the same as for highlights. API: `window.api.highlights.addNote(bookId, n)`.
- **Markdown (`highlights.md`):** notes are listed in position order with highlights, under their chapter, as
  ```
  **Note:** <text, newlines kept as separate lines prefixed "  ">
  - id: <id> · note · <YYYY-MM-DD>
  ```
- **Reader UI:** a "Note" button (lucide `StickyNote` or `NotebookPen`) in the reader toolbar and the menu item View → "New Note" with accelerator `Shift+CmdOrCtrl+N` (MenuAction `{ type: 'new-note' }`; ignored unless a book is open). It opens a small composer (textarea, autofocus; ⌘↩ saves, Esc cancels, Save/Cancel buttons; empty text can't be saved). It captures the current reading location/chapter/position at the moment it opens. Notes are never drawn on the page and never take part in highlight overlay/anchoring/lost-anchor logic.
- **Highlights panel:** notes appear mixed in by position, visually distinct (note icon, no color bar, text shown in full or clamped with expand). Click → jump to its location (when non-empty). Edit text and delete are available like highlight notes.

## 2. Review
- Card content, by `promptType`:
  - `'highlight'` (a highlight without an AI question): the quote in full, plus the highlight's own note beneath it if any.
  - `'note'` (a `kind: 'note'` item without an AI question): the note text.
  - `'ai'` (a coach-written question exists in `knowledge/prompts.jsonl` for that id — works for notes too): the question first; **Space** reveals the answer (AI answer if present, plus the original quote/note as source).
  - Every card shows book title + chapter and an "Open in book" action (⌘O, as today).
- No cloze anymore anywhere. `PromptType` becomes `'ai' | 'highlight' | 'note' | 'cloze'` — `'cloze'` stays only so old `review-log.jsonl` lines still type-check; new code never produces it. The old "note ending in ? becomes the prompt" rule is removed.
- Keys: when the card is fully shown, **Space** or **→** = Next; **S** = Sooner. Buttons "Sooner" and "Next" mirror them. For an `'ai'` card not yet revealed, Space/→ reveal. 1–4 grading keys and buttons are removed.
- Scheduling: Next = FSRS `good`; Sooner = FSRS `again` and then due is clamped to at most now + 1 day. The scheduler uses `learning_steps: []` and `relearning_steps: []` so no card comes back minutes later in the same session (intervals with Next: ~2, ~11, ~46 days …). `Rating` type and `review.rate` API stay; the renderer only ever sends `good` or `again`.
- Session-done screen: "Avg. recall before review" → "Avg. freshness before review". Empty-state copy: "Highlight or jot a note while reading — each one comes back here."

## 3. Stats wording ("Fresh in mind")
The computation is unchanged (sum of FSRS retrievability). Only labels change, everywhere the user sees them (Stats view, status bar tooltip/label, explainer):
- "Retrievable highlights" → "Fresh in mind" (sub: "items likely still fresh today")
- "Retrievable knowledge per hour" → "Fresh items per hour" (sub: "last 30 days")
- Chart title "Retrievable knowledge over time" → "Fresh in mind over time"
- Explainer: "Fresh in mind = how many of your highlights and notes are likely still fresh, based on when you last saw them. Reading adds items; reviewing keeps them fresh."
- "Cards by book" stays.

## 4. Continue Reading
- New first sidebar item (above Library), shown only when some non-missing book has `lastOpenedAt`. It shows the most recently opened book's title (one line, ellipsized) and `NN%` progress. Click → open that book at its saved location (same as opening it from the library). Active-styled while that book is open in the reader. `data-testid="nav-continue"`.
- Menu: View → "Continue Reading", accelerator `CmdOrCtrl+B` (MenuAction `{ type: 'continue-reading' }`); no-op when there is no such book.
- Survives restart (uses persisted `lastOpenedAt`/`location`).

## 5. Coach skills (workspace template)
Update `resources/workspace-template` so agents know about notes: in `highlights.json` items with `"kind": "note"` (and `**Note:**` entries in `highlights.md`) are the learner's own thoughts — record them as *what the learner believes*, never as what the source says (methodology §11). distill: turn notes into concept-note entries / questions where useful; questions for notes may be written to `knowledge/prompts.jsonl` with the note's id. ask/recall/weekly: may cite notes, labelled as the learner's notes. Remove any text that describes cloze cards or "note ending with ?". Keep CLAUDE.md/AGENTS.md/GEMINI.md consistent.

## 6. Docs & release
README "Daily use" updated (notes, Next/Sooner, ⌘B, ⇧⌘N). Version 0.2.0, tag `v0.2.0` → existing release workflow.
