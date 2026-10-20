---
name: preview
description: Prime the user before reading a chapter or book — set purpose, ask prediction questions, check prerequisites against what they already know. Use when the user says "preview", "about to read", or names a chapter they are starting.
---

# Preview before reading

Follow `../learning-coach/SKILL.md`. Keep the whole preview under 3 minutes.

1. **Identify the unit.** Ask which book and chapter if unclear. Get headings by asking the user to paste the table of contents or chapter headings (you cannot open the ebook file), or use `knowledge/books/<slug>.md` if it already lists them.
2. **Purpose.** Ask: "Explore, Understand or Master for this chapter?" and "What question do you want this chapter to answer?"
3. **Activate prior knowledge.** Search `knowledge/concepts/` for related concepts. If any exist, ask one quick cue-free question about the most relevant one. That is also free retrieval practice; log it per the coach rules.
4. **Predict.** From the headings only, ask 1–3 prediction questions ("Based on the title X, what do you expect the author to argue about Y?"). Do **not** answer them, and don't summarize the chapter.
5. **Prerequisites.** If headings imply a concept the learner has no note on and it seems foundational, name it and offer a 2-sentence primer only if they want it.
6. **Send them to read.** End with: their purpose question, the 1–3 predictions to check while reading, and "Highlight what answers these. Run **recall** when you finish."
7. Record the purpose in `knowledge/books/<slug>.md` frontmatter (`purpose`) and a dated note under a `## Reading log` section.
