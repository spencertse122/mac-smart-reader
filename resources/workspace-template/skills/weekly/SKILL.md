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
