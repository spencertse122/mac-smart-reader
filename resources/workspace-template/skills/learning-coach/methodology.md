# Evidence-Based Accelerated Reading and Durable Learning Methodology

> Source: research document provided by the project owner (2026-10-20). The coach skills bundle these rules. Exact timings, thresholds and rubrics are proposed operational defaults, not validated constants.

## 1. Objective and definition of success

Optimize durable, usable knowledge acquired per total hour of effort, not pages completed, highlights saved, flashcards generated or facts stored externally.

Five outcomes:
1. **Exposure:** the learner encountered the content. This does not establish learning.
2. **Comprehension:** the learner can explain a concept accurately after reading.
3. **Unaided retrieval:** the learner can reconstruct the concept without the source or an AI answer, especially after a delay.
4. **Transfer:** the learner can apply the concept to a new problem or evaluate an unfamiliar example.
5. **External knowledge:** accurate notes and sources are discoverable by an AI agent. This is useful but does not demonstrate memory.

A concept is not mastered because the learner recognizes an answer, agrees with an AI summary, highlights a passage, or an agent can retrieve the note. Strategically forget low-value details; preserve high-value principles and the ability to locate the rest.

## 2. Hierarchy of evidence

- **Highest priority:** retrieval practice and distributed/spaced practice, with corrective feedback. [1–4]
- **Conditional:** self-explanation, generative explanation, worked examples, interleaving, prequestions. [1,5–6]
- **Lower priority on their own:** highlighting, passive rereading, prewritten summaries, copying notes. Rereading is fine for repairing an actual comprehension gap. [1]
- **Reading speed:** extreme speed reading with full comprehension lacks support. Efficiency comes from selecting material, selective skimming, domain knowledge, and putting deep attention on hard passages. [7]
- Specific intervals, quotas, cutoffs and time budgets are tunable heuristics.

## 3. Choose what deserves deep learning

Intentions: **Explore** (skim; minimal retention), **Understand** (central claims; brief retrieval; selective review), **Master** (repeated recall, problem solving, extended review).

Selection questions: Why am I reading this? What do I already know? Which ideas are important, new, difficult, recurring or foundational? What level of retention matters (gist, causal explanation, procedure, terminology, formula, exact fact)?

Priority goes up with usefulness, centrality, future relevance, difficulty and prerequisite value. It goes down for redundant anecdotes, already-mastered material, decorative examples and low-relevance facts. Not every passage deserves a review item.

## 4. Before reading

1. Preview the title, headings, summary and diagrams.
2. State 1–3 learning goals or questions.
3. Make a brief prior-knowledge prediction (being wrong is fine).
4. Identify missing prerequisites.

AI rule: pose questions before explanations unless prerequisite instruction is needed. Don't lead with a full chapter summary.

## 5. During reading

Read in semantic units, not every N pages. Use shorter units for dense or unfamiliar material. Mental operations: identify, explain, differentiate, exemplify, connect, question. Highlighting is navigation, not evidence of memory. When a passage is unclear: clarify, revisit prerequisites, reread or ask for a focused explanation, then re-explain in your own words.

## 6. End each unit with closed-source active recall

1. Remove the source from view. 2. Reconstruct the major ideas (free response). 3. Require an attempt before showing the model answer (unless the learner abandons it). 4. Compare, identify gaps and misconceptions, give corrective feedback. 5. Repair the explanation, from memory if possible. 6. Schedule later uncued recall for valuable material.

Retrieval types: free recall, cued recall, causal reconstruction, discrimination, counterexample/limitation, transfer. Prefer open-ended questions for important concepts; recognition alone never establishes mastery.

Question quality: a clear target; an answer supported by the source; a meaningful mental operation; answerable without seeing the passage; doesn't leak the answer; separates required precision from acceptable paraphrase; transfer claims use new examples; targets known misconceptions. Use roughly 2–5 prompts per substantial unit, and convert only the most valuable into recurring reviews.

## 7. Feedback

Order: (1) what was right, (2) what was incomplete or wrong, (3) what the source supports, (4) why the correction matters, (5) a repair attempt.

Hint ladder: neutral prompt → conceptual hint → focused source excerpt → complete explanation. Record that heavily hinted answers were not unaided.

Never praise an inaccurate explanation as correct. Never punish "I don't know." If the source evidence is ambiguous, say so.

**Rubric** (separate dimensions, never combined into one score):
- Accuracy 0–3: incorrect / materially incomplete / mostly correct / fully correct
- Depth 0–3: labels only / basic description / mechanism / coherent nuanced mechanism
- Transfer 0–3: unable / substantial help / small gaps / independent on a novel scenario
- Independence: unaided / minor hint / substantial hints / answer exposed
- Confidence: the learner's estimate before feedback (used for calibration)

## 8. Spaced retrieval and successive relearning

Study → retrieve to criterion → retrieve again in later sessions → correct gaps → extend intervals. Starter schedule: 1, 3, 7, 21, 60 days, adapted to performance (in this app, scheduling uses FSRS).

- Correct, unaided, confident → longer interval.
- Correct but hesitant → modest increase, possibly with a contrast question.
- Wrong → feedback, a retry after a short gap, an earlier review.
- Correct only with hints → not an independent success.
- Repeatedly mastered low-value item → retire it.
- Core concept with persistent errors → vary the prompts and repair prerequisites.

A review that reveals the answer without an attempt is exposure, not retrieval.

## 9. Interleaving and transfer

Once basics are familiar, mix related concepts so the learner practices choosing which principle applies. Don't interleave unrelated topics or novice concepts. A concept is transfer-ready only after the learner applies it to a materially new case.

## 10. Adapt to the kind of reading

- **Technical / scientific:** mechanisms, derivations, assumptions, what-if-a-parameter-changes, trade-offs between approaches, diagnosing failures, scope of findings.
- **General non-fiction:** thesis, supporting argument, evidence quality, causal model, objections and counterexamples, competing views, application to decisions. Don't treat persuasive framing as fact.
- **Light reading:** a single gist question or nothing; spaced review only for personally important material.

## 11. Explain, generate, connect

Teach back difficult concepts and check the explanation for accuracy. Make connections only after the learner's own explanation. Keep separate: **what the source says**, **what the learner believes**, **what the AI proposes** (unverified), and **what has been demonstrated**. Cross-book links must say whether the authors actually support them or they're only an analogy.

## 12. AI coach behavior

**Do:** ask before showing; require attempts on high-value concepts; tie questions to the learner's reading and goals; grade source-grounded accuracy, not style; give specific corrective feedback; vary prompts; revisit at spaced intervals; encourage self-explanation, transfer and discrimination; limit review items; make uncertainty explicit.

**Don't:** lead with exhaustive summaries; give away answers before an attempt; quiz every paragraph or highlight; count recognition or AI-assisted completion as unaided recall; overstate mastery from one success; treat fluency, length, confidence or app use as learning; add unsupported claims to the knowledge base; interrupt reading too often; promise total recall or speed-reading magic.

If the learner is truly stuck, teach directly, then test independent recall later.

## 13. Sustainable practice

A ~45-minute session: 5 min recalling due items → 28 min reading with brief checks → 8 min reconstruction and feedback → 4 min connecting and noting uncertainty. Weekly: 10–20 min cross-reading synthesis and fresh questions. Monthly: cue-free test of old high-value concepts and a check on review load. When reviews pile up, prioritize foundational, useful, weakly retained ideas; defer or retire low-value ones.

## 14. Measurement

Track efficiency (total minutes ÷ durable high-value concepts), delayed unaided retrieval (~7 and ~30 days), transfer, calibration, review burden and knowledge fidelity. Don't use pages per hour or questions answered as the main measure. Don't count hinted or AI-assisted answers as independent.

## 15. Non-negotiable principles

1. Exposure and externally saved knowledge are never shown as demonstrated learning.
2. High-value material produces opportunities for unaided retrieval.
3. Feedback is accurate, specific and grounded in the source.
4. Important concepts are revisited after delays; no fixed interval is assumed optimal.
5. Technical and non-fiction material get different kinds of questions.
6. Transfer and explanation matter more than surface wording, except where precision is essential.
7. Reading speed is subordinate to comprehension.
8. Question volume, difficulty and interruptions are limited for sustainability.
9. The AI scaffolds and teaches; it doesn't punish failure.
10. Mastery claims reflect independently observed performance, ideally delayed and novel.

## References

1. Dunlosky et al. (2013). *Psychological Science in the Public Interest.* https://doi.org/10.1177/1529100612453266
2. Agarwal, Nunes & Blunt (2021). *Educational Psychology Review.* https://doi.org/10.1007/s10648-021-09595-9
3. Mawson & Kang (2025). *Behavioral Sciences.* https://doi.org/10.3390/bs15060771
4. Rawson & Dunlosky (2011). *JEP: General.* https://doi.org/10.1037/a0023956
5. Karpicke & Blunt (2011). *Science.* https://doi.org/10.1126/science.1199327
6. Fiorella (2023). *Educational Psychology Review.* https://doi.org/10.1007/s10648-023-09769-7
7. Rayner et al. (2016). *Psychological Science in the Public Interest.* https://doi.org/10.1177/1529100615623267
8. Rohrer & Taylor (2007). *Instructional Science.* https://doi.org/10.1007/s11251-007-9015-8
9. Cepeda et al. (2008). *Psychological Science.* https://doi.org/10.1111/j.1467-9280.2008.02209.x
10. Roediger & Butler (2011). *Trends in Cognitive Sciences.* https://doi.org/10.1016/j.tics.2010.09.003
