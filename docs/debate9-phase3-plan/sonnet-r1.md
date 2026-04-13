# Sonnet - Round 1

## The Core Problem First

Before debating which Phase 3 items to build, we need to acknowledge what the code reveals: the system is architecturally sound but its data is garbage. Every `compost.query` call returns hits with `predicate: "discusses"` and objects that are first-sentence truncations. The ranking formula in `search.ts` is doing multi-factor math on meaningless triples. Activating w3/w4 doesn't help when w1_semantic is scoring cosine similarity against chunks that summarize "Installation: This project requires Node 18 or higher." as a fact.

Phase 3 must fix the data layer before adding more query-time machinery. Two items do this directly. Seven do not.

---

## Value vs. Effort Analysis

### Tier 1 - Build First (high value, tractable effort)

**Item 8: Semantic chunking (Savitzky-Golay boundary detection)**

This is the highest-leverage item in the list. The current `markdown.py` splits on double newlines and assigns heading-based facts with hardcoded `"discusses"` predicates. Every downstream feature - hybrid search, RRF fusion, temporal decay, wiki synthesis - operates on these chunks. Bad chunks mean bad embeddings mean bad ANN retrieval. The Savitzky-Golay approach finds semantic topic shifts rather than typographic breaks, which means chunks map to coherent concepts. This directly improves `w1_semantic` scores for every query.

Effort: medium. Python-only change, no schema migration, existing chunk/fact pipeline stays intact with a new transform policy key. The algorithm is well-understood; the main work is tuning the window parameter and writing the boundary detection against the embedding signal.

**Item 2: Wire rp-phase2-default as the active profile**

The code is unambiguously broken here. `search.ts` line 144 hardcodes `"rp-phase1-default"` as the default. The profile record exists in the database. w3/w4 are computed in the SQL (lines 231-232) but their weights in rp-phase1-default are zero. This is a one-line fix in `search.ts` plus confirming rp-phase2-default has calibrated values. Access frequency (w3) and importance (w4) signals are already being collected - the access_log inserts are happening on every query hit. Activating these weights costs nothing and immediately improves result ordering for frequently-accessed facts.

Effort: trivial if rp-phase2-default weights are already seeded. If not, the calibration work is still small - a config change, not a feature.

---

### Tier 2 - Build Second (meaningful value, clear scope)

**Item 7: Multi-query expansion**

`compost.ask` is the user-facing feature. The LLM is already in the loop for synthesis. Adding 2-3 query variants before retrieval is a genuine quality improvement for natural language questions where the user's phrasing doesn't match the stored subject/predicate vocabulary. The implementation is a single Ollama call per query, results fan out through the existing hybrid search, then RRF naturally deduplicates. No schema changes. Latency cost is one extra LLM round-trip on `compost.ask` calls only (not `compost.query`).

Effort: small. One new function, existing search path unchanged.

**Item 4: Contradiction arbitration (subset of Item 4's "complete reflect cycle")**

When the same URL is re-ingested, or two sources assert conflicting facts, the current system just appends. The arbitration rule (newer > higher-confidence > multi-source) is simple and the schema already has `confidence`, `captured_at`, and `source_uri`. This directly affects correctness of `compost.ask` answers - synthesizing over contradictory facts produces hallucinated-sounding responses.

Build only the arbitration logic, not the full reflect cycle. The wiki rebuild trigger is a separate concern.

Effort: medium. Needs a new query to detect subject-predicate conflicts, a resolution step at ingest time or in a reflect pass, and archiving of the loser fact.

---

### Tier 3 - Defer or Descope

**Item 1: Episodic memory materialization**

This adds a `memory_episodic` link table connecting fact_id to episode metadata. The stated motivation is not clear from the brief. What query does this enable that isn't already served by provenance (source_uri, captured_at) plus fact_context? If the answer is "richer temporal grouping of related facts," that's a valid future feature - but it requires a clearer API contract first. Premature schema expansion without a consumer is YAGNI.

**Item 6: Fact-to-fact links graph**

Graph traversal is appealing but this requires high-quality facts to be useful. With `predicate: "discusses"` on everything, a traverseGraph CTE will follow edges between semantically unrelated facts that happen to share a heading keyword. Build this after semantic chunking produces real subject-predicate-object triples. Doing it now wastes implementation effort and produces misleading results.

**Item 3/5: Complete reflect cycle + Wiki rebuild**

These are correct long-term features. The reflect cycle needs contradiction arbitration (Item 4) to be meaningful. Wiki rebuild needs good facts (Item 8) to produce good pages. Both depend on work that isn't done yet. Scheduling them before their prerequisites compounds risk - you get a working pipeline that generates polished bad summaries.

**Item 9: Wiki page versioning**

Pure operational hygiene. Useful when wiki rebuilds are frequent and users care about diffs. Right now wikis aren't being rebuilt reliably. Version a system that isn't running yet is premature.

---

## Ideal Ordering for Maximum User Impact

**Sprint 1 (unblocks everything else):**
- Item 8: Semantic chunking - new transform policy, better embeddings
- Item 2: Wire rp-phase2-default - activate signals already being collected

**Sprint 2 (query quality directly):**
- Item 7: Multi-query expansion for `compost.ask`
- Item 4 (partial): Contradiction arbitration at ingest time

**Sprint 3 (closing the reflect loop):**
- Item 3/5: Reflect cycle + wiki rebuild, now that facts are trustworthy
- Item 1: Episodic memory, if a concrete use case is defined

**Defer until facts are good:**
- Item 6: Fact graph
- Item 9: Wiki versioning

---

## Quick Wins Being Overlooked

**The rp-phase1-default fallback in `loadRankingProfile`** is a silent correctness bug: if the profile is not found, it throws, but the default argument is still `"rp-phase1-default"` with all the zero weights. Every caller that doesn't pass a profile_id gets stale ranking. Fix the default argument in `profile.ts` to `"rp-phase2-default"` - one character change with immediate effect on result quality.

**FTS5 query preparation in `search.ts`** strips FTS5 operators and converts to OR logic, which is correct, but single-character words are filtered out (`w.length > 1`). Queries like "Go programming" or "C language" silently drop the language token. Widen the filter or handle known single-char technical tokens.

**The `_first_sentence` truncation in `markdown.py` line 102-109** caps fact objects at 200 chars and strips markdown formatting. For code-heavy documentation this produces objects like "Install the dependencies by running the following command in your terminal" rather than capturing the actual technical claim. A parallel extractor that targets imperative sentences and technical claims would improve fact utility significantly with no schema changes.

---

## Summary Position

The ranking infrastructure is solid. The retrieval pipeline is solid. The data quality is the bottleneck. Invest Phase 3's first sprint entirely in semantic chunking and profile activation. Everything else - graph traversal, episodic memory, wiki versioning - becomes significantly more valuable once the facts being stored are worth organizing.
