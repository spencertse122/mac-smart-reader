---
name: distill
description: Turn the user's new ebook highlights into concept notes, a book page, cross-book links and better review questions in knowledge/. Use after a reading session or when the user says "distill", "process my highlights" or "update my knowledge graph".
---

# Distill highlights into the knowledge graph

Follow `../learning-coach/SKILL.md`.

## 1. Find what is new
- Read `.smartreader/library.json` for titles and slugs.
- Find the newest `createdAt` among lines in `knowledge/prompts.jsonl` with `"by":"distill"` (none → everything is new).
- For each book, read `.smartreader/books/<slug>/highlights.json` and keep highlights and notes (`kind: "note"`) with `deleted: false` and `createdAt` after that time. If there are none, say so and stop.
- Tell the user: "N new highlights in M books. Distilling." Then ask **one** question: "Anything you want me to focus on, or is your purpose for any of these books Explore / Understand / Master?" Do not wait more than one turn; default to Understand.

## 2. Group into concepts
- Notes (`kind: "note"`) are the learner's own thoughts, not source claims. Cluster them with the idea they touch, but record them under "In my words" as `Learner's note (h_…): …` or as an open question; never under "What the sources say".
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
For the **most valuable** highlights only (a note can get a question too, e.g. to test the idea it records; use the note's id) (about 1 in 2 or fewer; skip anecdotes and trivia), append to `knowledge/prompts.jsonl`:
`{"highlightId":"h_…","question":"…","answer":"…","createdAt":"<now ISO>","by":"distill"}`
Question quality: answerable without seeing the passage; does not leak the answer; asks why/how/when/compare rather than "what is"; one target per question; the answer is 1–3 sentences grounded in the highlight. Technical books: mechanism or what-if. General non-fiction: claim + reason, or application.

## 6. Update `knowledge/index.md`
Add or refresh the book under **Books** (link `[[books/<slug>]]`), add new top concepts under **Core concepts**, and add a dated line under **Recent sessions**: `2026-10-20 · distill · 12 highlights → 5 concepts, 6 questions`.

## 7. Report and offer next step
Three lines maximum: what changed, one interesting cross-book connection (tagged), and the offer: "Want a 5-minute recall on these now?"
