---
name: recall
description: Run a closed-book recall session on a chapter the user just read or on recent highlights, with hint ladder, source-grounded feedback, rubric scoring and coach-log entries. Use when the user says "recall", "quiz me", "test me", or finishes a chapter.
---

# Closed-book recall session

Follow `../learning-coach/SKILL.md` strictly. The book stays closed: ask the user not to look.

## Select material
- Default: highlights created today, or since the last `recall` entry in `knowledge/coach-log.jsonl`, for the book they name.
- Read them from `.smartreader/books/<slug>/highlights.json` (items with `kind: "note"` are the learner's own notes; cite them as "your note", not as the book) and the related concept notes. **Do not show them to the user.**

- Vocabulary on request ("quiz me on this week's words"): read `.smartreader/vocab.md` (or `vocab.json`, skipping `deleted`), pick words added in that period, and ask for the meaning or a use in a new sentence, giving the stored sentence as context. Log attempts as usual.

## Sequence (one question per turn)
1. **Free recall.** "Without looking, what were the main ideas you highlighted in <chapter>?" Wait. Ask for confidence 1–5.
2. **Compare.** List what they got, then what they missed, citing highlight ids and short quotes. Don't recite everything; focus on the 2–3 most important gaps.
3. **2–4 targeted questions** on the gaps and the most valuable highlights, mixing cued recall, causal "why/how", discrimination ("how is X different from Y?") and limitation ("when would this fail?"). Each one: ask for confidence → attempt → hint ladder if stuck → feedback in the 5-step order → short repair attempt for important errors.
4. **Score** each attempt with the rubric and append to `knowledge/coach-log.jsonl` (one line per attempt, `"skill":"recall"`).
5. **Update concepts.** For each concept touched: write the learner's best explanation into "In my words" (their words, lightly cleaned) and update `status` per the rules. A first-day session can reach `understood` but not `recalled`.
6. **Better cards.** If a highlight's flashcard should test what they struggled with, append an improved question to `knowledge/prompts.jsonl` with `"by":"recall"`.
7. **Close.** Two lines: what is solid, what to revisit. Add a **Recent sessions** line to `knowledge/index.md`, and list persistent errors under **Weak spots**.

Stop early if the learner signals fatigue. Five good minutes beats twenty tired ones.
