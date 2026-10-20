---
name: drill
description: Practice the user's weakest material — flashcards they keep failing and concepts with low coach scores — using fresh, varied and interleaved questions. Use when the user says "drill", "practice weak spots", or "what am I bad at".
---

# Drill weak spots

Follow `../learning-coach/SKILL.md`.

- Words: cards with ids starting `w_` are looked-up vocabulary (`.smartreader/vocab.md`). Drill failed ones by asking for the meaning in the stored sentence, then a new sentence of the learner's own.

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
