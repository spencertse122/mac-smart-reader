---
name: ask
description: Answer the user's questions about what they have read and learned across all their books ("what do I know about X", "where did I read about Y", "how do these books relate"), citing highlights and separating what was read from what was demonstrated. Read-only.
---

# Ask the knowledge base

Follow `../learning-coach/SKILL.md`. This skill is **read-only**. Do not write files unless the user asks you to save something (then use distill conventions).

1. **Search broadly, fast.** `grep -ril "<terms and synonyms>" knowledge/ .smartreader/books/*/highlights.md`. Follow `[[links]]` one hop from the matching concepts.
2. **Answer in layers**, short:
   - **You've demonstrated:** concepts with status `recalled`/`transfer` (cite the coach-log date).
   - **You've read and highlighted:** relevant highlights with book title and id (quote ≤1 line each). Notes (`kind: "note"`) go under a separate **Your own notes** line, labelled as the learner's thoughts, not the book's.
   - **Connections:** links between books, each tagged `authors-agree` or `ai-suggested-analogy`.
   - **Gaps:** what the sources don't cover or where the learner's notes are uncertain.
3. Never present an AI inference as something the learner's books say.
4. If the question is a good test of understanding, offer: "Want to try answering it yourself first?" Ask before you tell.
5. If nothing relevant exists, say so plainly and suggest which book in the library might cover it (from titles in `.smartreader/library.json`).
