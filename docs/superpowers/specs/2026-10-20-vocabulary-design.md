# v0.3.0 — Offline dictionary + vocabulary builder

Approved by the user in chat on 2026-10-20. Builds on `2026-10-20-smart-reader-design.md` and `2026-10-20-notes-review-continue-design.md`.

## Why
While reading non-fiction the user looks up unfamiliar words and wants to *remember* them. Every looked-up word becomes a vocabulary item that comes back in Review as a self-quiz flashcard, through the same spaced-repetition system as highlights and notes.

Anti-goals: leaving the book to look something up; needing internet; a separate review routine; flooding Review with words.

## 1. Dictionary (offline)
- Source: the macOS system dictionary (New Oxford American Dictionary and any other dictionaries the user enabled in Dictionary.app) via DictionaryServices `DCSCopyTextDefinition`.
- Access: a tiny Swift CLI `native/dict-lookup.swift` (`dict-lookup <term>` → plain-text definition on stdout, exit 1 if none, exit 2 on bad usage). Built as a universal (arm64 + x86_64, macOS 13+) binary by `scripts/build-dict-helper.sh` into `resources/bin/dict-lookup` (git-ignored), run by `dist:mac` before electron-builder; shipped via `extraResources` (`resources/bin` → `bin`). Main process resolves it at `process.resourcesPath/bin/dict-lookup` when packaged, `resources/bin/dict-lookup` in dev.
- Main `DictionaryService.lookup(term)` → `{ ok: true, entry: DictEntry } | { ok: false, reason: 'not-found' | 'unavailable' }`. Runs the helper with `execFile` (argument array, never a shell), 5 s timeout, term trimmed and limited to 64 chars; caches results in memory. On non-macOS or missing helper → `unavailable`.
- Test hook: when env `SR_DICT_STUB` points to a JSON file `{ "<term>": "<raw definition text>" }`, the service reads definitions from it instead of the helper (used by e2e on Linux and unit tests).
- Parsing raw text into `DictEntry { headword, pronunciation: string | null, text, raw }`. Real output captured from macOS (GitHub runner, 2026-10-20):
  - `serendipity ser·en·dip·i·ty | ˌserənˈdipədē | noun the occurrence and development of events by chance in a happy or beneficial way: a fortunate stroke of serendipity | a series of small serendipities. ORIGIN 1754: coined by Horace Walpole, …`
  - `running run·ning | ˈrəniNG | noun 1 the action or movement of a runner: he accounted for 31 touchdowns with his running and passing. • the sport of racing on foot: marathon running. … adjective [attributive] 1 (of water) f…`
  - `ephemeral e·phem·er·al | əˈfem(ə)rəl | adjective lasting for a very short time: fashions are ephemeral. • (chiefly of plants) having a very short life cycle: … noun an ephemeral plant: … DERIVATIVES ephemerality | əˌfem(ə)ˈralədē | noun ephemerall…`
  So: `headword` = the first whitespace-delimited token (fallback: the queried term); `pronunciation` = the text between the first and second ` | ` (null if there is no ` | `); `text` = everything after the second ` | ` (or after the head line when there is no pronunciation), cut at the first ` ORIGIN ` / ` DERIVATIVES ` / ` PHRASES ` / ` PHRASAL VERBS ` section marker, whitespace collapsed; `raw` kept. For display, insert line breaks before ` • ` sense bullets, before numbered senses (` 2 `, ` 3 ` … when followed by a lowercase word) and before part-of-speech words that start a new block (` noun `, ` verb `, ` adjective `, ` adverb ` after a period). Other dictionaries (e.g. thesaurus, other languages) may not follow this shape — the parser must never throw and must fall back to `text = raw`. Unit-test with these three samples plus a no-pipe sample.

## 2. Look Up in the reader
- The selection popup (`HighlightPopup`) gets a **Look Up** button (lucide `BookA` or `Search`), enabled when the selection is 1–64 chars and at most 4 words.
- Clicking it shows the definition inside the popup (headword, pronunciation, definition text scrollable, max ~240px tall), plus a small "Saved to Vocabulary" line. Not-found → "No definition found for “x”." Unavailable → "Dictionary isn't available. Open the Dictionary app once so macOS downloads it." In neither case is anything saved.
- On a successful lookup the word is saved automatically (see 3) with the sentence around the selection (reuse the existing context extraction used for highlights; cap 300 chars), the book id, CFI location and chapter.
- The user can still highlight the same selection from the popup.

## 3. Vocabulary store
- File: `.smartreader/vocab.json` `{ version: 1, words: VocabWord[] }`, single writer via the existing `jsonFile` helper; `afterWrite` renders `.smartreader/vocab.md` for the coach.
- `VocabWord { id: 'w_<uuid>', headword, pronunciation, definition (DictEntry.text), contexts: Array<{ bookId, sentence, location, chapter, at }>, createdAt, updatedAt, deleted }`.
- Dedupe by lower-cased `headword`: a repeat lookup appends a context (skip if the same sentence is already there; keep at most 5 contexts, newest last) and does not reset review progress. A deleted word looked up again is undeleted (keeps its id).
- API: `window.api.vocab.lookup(term)` (dictionary only), `vocab.save(input)` → VocabWord, `vocab.list()` (non-deleted, newest first), `vocab.remove(id)`. Saving/removing emits review-changed like highlights do.
- `vocab.md`: `# Vocabulary` then per word `## headword /pronunciation/`, definition (first ~300 chars), and `- “sentence” — Book title` lines, `- id: w_… · added YYYY-MM-DD`.

## 4. Review
- Words join the same queue and FSRS state (`review-state.json`, card key = word id) and count toward the same new-cards-per-day cap. `ReviewService` gains a vocab source next to highlights; a deleted word's card is suspended.
- `ReviewCard` with `promptType: 'word'`: `prompt` = headword, `answer` = definition, new optional fields `pronunciation`, `context` (the first context sentence), `bookId`/`location`/`chapter` from that context.
- Card UI: front shows the headword large (plus "Word" tag and book title); **Space** flips; back shows pronunciation, definition, and the sentence with the word emphasised (case-insensitive match of headword or the originally looked-up form). Buttons **Forgot** (S → `again`) and **Got it** (Space/→ → `good`). Before flipping, Space only flips.
- Open in book (⌘O) jumps to the first context's location.

## 5. Vocabulary view
- New sidebar item **Vocabulary** (lucide `BookA`, `data-testid="nav-vocab"`) after Highlights. View lists words newest first with a search box (matches headword or definition): headword, pronunciation, 2-line definition, the newest context sentence + book. Click expands to the full definition and all contexts (each context clickable → open book at location). Delete with a small confirm.
- Empty state: "Select a word while reading and choose Look Up — it'll be saved here and come back in Review."

## 6. Coach
Template root files list `.smartreader/vocab.md` / `vocab.json` (app-owned, read-only for agents). recall/drill skills: may quiz vocabulary on request ("quiz me on this week's words"), using the stored sentence as context. Keep edits short.

## 7. Release checks
`release.yml`: after `dist:mac`, verify `Contents/Resources/bin/dict-lookup` exists in both bundles, is executable, is universal (`lipo -archs` contains arm64 and x86_64) and passes `codesign --verify`; run it once with a common word and print the result (do not fail the build if the runner has no dictionary assets — exit 1 there is a warning, crash/exit≥2 fails). Version 0.3.0, tag `v0.3.0`. README: Look Up, Vocabulary, word cards.
