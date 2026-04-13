# Gemini - Round 1

Let me be direct: this Phase 3 plan is carrying at least three research projects disguised as engineering deliverables. Before we debate ordering, we need to separate what is a known-good improvement from what is an experiment that belongs in a branch with a benchmark harness.

## 1. What Is Over-Engineered?

**Semantic chunking with Savitzky-Golay smoothing (item 9) is the worst offender.**

Look at the current `markdown.py` extractor. It splits on double newlines, tracks heading context, and emits `Chunk` objects. That is 150 lines of Python and it works. The actual complaint in the known quality issues is not "chunks are wrong" - it is "all predicates are 'discusses' and objects are truncated." Those are fact extraction problems, not chunking problems. Replacing the chunking algorithm with a signal-processing technique borrowed from spectroscopy does not fix the predicate or object quality. It addresses a symptom nobody reported.

Savitzky-Golay on embedding cosine similarity requires: computing embeddings for every sentence boundary, running the smoothing window, choosing a threshold, and validating that the detected boundaries actually improve downstream retrieval. None of that validation infrastructure exists. This is a paper prototype, not a Phase 3 deliverable.

**Simpler alternative:** Fix `extract_facts` in `markdown.py` to emit richer predicates and objects. The function already has `_first_sentence` - extend it to pattern-match verb phrases from heading text ("introduces", "defines", "requires", "deprecates"). That is a 30-line change with zero new infrastructure.

**Fact-to-fact links graph (item 6) is premature.**

We have no usage data showing that users need graph traversal. The recursive CTE is not the problem - SQLite handles CTEs fine. The problem is: what populates `fact_links`? Either LLM inference (slow, local, non-deterministic) or heuristic co-occurrence (cheap but noisy). Neither path is specified. This is a schema stub with no defined insertion semantics. Ship the schema in a migration if you want, but do not call it a deliverable until the write path exists.

**Multi-query expansion (item 7) has a 3-5x latency cost with unknown recall improvement.**

The search pipeline in `search.ts` is already BM25 + ANN with RRF. Multi-query expansion means running the LLM before every query, then running 2-3 retrieval pipelines instead of one, then de-duplicating. On a local gemma4:31b that is 2-4 seconds of added latency per query. For a personal knowledge base this is not a background operation - it blocks `compost.ask`. The benefit is unproven on this corpus size. This belongs in an A/B experiment, not in the critical path.

**Episodic memory materialization (item 1) needs a sharper definition.**

"fact_id -> episode metadata" - what is an episode? The brief does not define it. If an episode is "a time-bounded cluster of ingested facts," that requires a clustering step. If it is "a session or ingest batch," that is a foreign key to an existing table and takes one migration. These are not the same deliverable. The plan conflates them.

## 2. What Is the Minimum Viable Phase 3?

Three items fix real, documented problems. Everything else is speculative:

**Must ship:**
- **w3_access + w4_importance activation (item 2):** The ranking profile `rp-phase2-default` exists and is not wired. `search.ts` already computes `w3_val` and `w4_val` in the SQL. This is a one-line config change plus a migration to set the default profile. Zero new code paths. Ship this week.
- **Fix fact extraction quality:** Not listed as a numbered item, which is itself a problem. The known issue is explicit: "all predicates are 'discusses', objects truncated." This is the root cause of poor `compost.ask` answer quality. Richer predicates from `extract_facts` in `markdown.py` make every downstream item - contradiction detection, wiki rebuild, even graph links - more useful.
- **Wiki rebuild (item 5):** If L2 facts are stale the wiki is stale and `compost.ask` returns outdated synthesis. This is a concrete, observable failure mode. The trigger logic (detect changed facts, re-synthesize affected pages) is straightforward given the existing LLM layer.

**Conditional on definition clarity:**
- **Contradiction arbitration (items 3/4):** Only viable if fact quality is fixed first. Detecting "conflicting facts" when every predicate is "discusses" is noise. Fix extraction, then contradiction detection has signal to work with.
- **Wiki page versioning (item 8):** One migration and a write on reflect. Low complexity. Fine to include but not worth blocking anything else.

**Defer or cut:**
- Savitzky-Golay chunking (item 9): defer indefinitely pending retrieval quality benchmarks
- Fact-to-fact links (item 6): defer until write path is specified
- Multi-query expansion (item 7): defer until latency budget is defined
- Episodic memory (item 1): defer until "episode" is defined in the schema spec

## 3. Right Ordering

1. Wire `rp-phase2-default` (item 2) - unblocks everything that depends on real ranking signal
2. Fix fact extraction quality (missing from plan) - unblocks contradiction detection and graph links
3. Wiki rebuild (item 5) - highest user-visible impact given the LLM layer exists
4. Wiki page versioning (item 8) - cheap, add alongside item 5
5. Contradiction arbitration + reflect cycle (items 3/4) - now has signal from better facts
6. Episodic memory (item 1) - only after "episode" is defined

Items 6, 7, 9 need feasibility spikes before entering a phase plan.

## 4. Research Masquerading as Production Engineering

The GBrain-inspired ports are the primary offender. GBrain is a research system at Google with a different scale, corpus structure, and query pattern than a 8K-line local SQLite knowledge base. Porting techniques from it without validating they help on this corpus is cargo-cult engineering.

Specifically: Savitzky-Golay was designed for noisy signal data where the signal/noise ratio justifies the smoothing cost. Markdown documents have structural signals (headings, blank lines, code blocks) that are already richer than raw text embeddings. The Phase 0 chunker uses those structural signals and they are appropriate for the domain.

Multi-query expansion makes sense when the embedding model has poor coverage of query vocabulary - a known problem in general-domain retrieval. With `nomic-embed-text-v1.5` on a personal knowledge base where the user wrote most of the content, vocabulary mismatch is much less severe. The case has not been made.

The reflect cycle (item 4) and episodic memory (item 1) are the two items most in need of a written spec before a single line of code. "Complete reflect cycle" is not a deliverable description - it is a goal. Write the state machine: what triggers it, what it reads, what it writes, what the invariants are. Then it becomes engineerable.

The plan as written would keep two engineers busy for eight weeks shipping things that may not move the quality needle, while the `rp-phase2-default` wiring fix takes two hours.
