# Opus - Round 1

## The Plan Has a Foundation Problem

Before debating which 9 items to batch, I want to name the elephant: **the brief itself lists a known bug that invalidates half the proposed work**. The default ranking profile is still hardcoded to `rp-phase1-default` (search.ts line 144), meaning w2_temporal is dead weight in production despite Phase 2 claiming to ship it. The `rp-phase2-default` profile exists in the DB (migration 0007) but nothing wires it as the default. If we ship 9 more features on top of a ranking stack that is not actually running its own Phase 2 weights, we are building on sand. Fix this first -- it is a one-line change plus a test update -- before any Phase 3 work begins.

## Item-by-Item Assessment

**Item 2 (w3_access + w4_importance activation)** is the only item I would call correctly scoped AND immediately valuable. The SQL formula in search.ts already computes w3_val and w4_val; the profile row already has the columns. This is a profile row update + wiring the default to `rp-phase2-default` (or a new `rp-phase3-default`). Half a day. Ship it in Batch A alongside the profile default fix.

**Item 8 (Semantic chunking via Savitzky-Golay)** is the highest-impact item in the list and the most poorly scoped. The current markdown.py extractor is fundamentally broken: every fact gets predicate "discusses" and the object is a truncated first sentence. Swapping the chunking strategy from heading-based to Savitzky-Golay fixes L1 but does nothing for the L2 fact quality disaster. The real deliverable should be: (a) semantic chunking for L1, AND (b) LLM-based fact extraction for L2 to replace the heading heuristic. Without (b), you have beautiful chunks feeding into a function that still outputs `("React Hooks", "discusses", "React Hooks let you use state")`. The plan does not mention LLM-based fact extraction at all. This is the biggest missing item.

**Item 7 (Multi-query expansion)** is correctly identified but has a hidden dependency on LLM latency. The current `query()` is synchronous except for the LanceDB ANN call. Adding an LLM roundtrip (gemma4:31b at ~2-4s per call on consumer hardware) multiplied by 2-3 expansions means query latency jumps from ~200ms to ~8-12s. The plan does not address this. You need either: parallel expansion calls (LLMService.generate does not support batching today), or a lighter model for expansion (qwen3:1.5b), or query-time caching of expansions. Scope this as "multi-query expansion + LLM batch/parallel support in LLMService interface."

**Item 3 (Contradiction arbitration)** and **Item 4 (Complete reflect cycle)** are listed as separate items but are architecturally inseparable. You cannot arbitrate contradictions without a detection mechanism, and the detection mechanism needs to run inside reflect (the only scheduled maintenance loop). Merging these into one deliverable is mandatory. Furthermore, contradiction detection requires comparing facts with the same subject -- but the current fact extraction produces unique subjects per heading. With heading-based extraction, you will almost never see two facts with the same subject from different sources. Contradiction arbitration is meaningless without better fact extraction first. This creates a hard ordering dependency: Item 8 (better extraction) must ship before Items 3+4.

**Item 1 (Episodic memory materialization)** is well-designed in the spec (debate 4 synthesis has the DDL) but has zero consumers. There is no `episodic_metadata` being emitted by any extractor in the codebase (I searched -- zero hits in `packages/`). The table can be created, but without an extractor that populates `event_type`, `participants`, `location`, `occurred_at`, the table will sit empty. Either scope this to include the extractor changes, or defer it to Phase 4 when the extraction pipeline is mature enough to emit structured episodic metadata. I lean toward defer.

**Item 5 (Wiki rebuild on L2 changes)** is well-scoped for what it is, but the current wiki.ts implementation has a subtle correctness issue: `findTopicsNeedingSynthesis` compares `last_synthesis_at` against `MAX(facts.created_at)`, but reflect's soft-tombstone (archived_at) changes do not update `created_at`. So a fact getting tombstoned never triggers a wiki rebuild. The wiki rebuild trigger needs to also watch `archived_at` changes, or reflect needs to touch a `facts_modified_at` column.

**Item 6 (Fact-to-fact links graph)** with recursive CTE is the kind of feature that sounds powerful but has no clear consumer in the current architecture. Who calls `traverseGraph`? The query pipeline does not use it. The wiki synthesizer does not use it. The reflect cycle does not use it. Adding a graph traversal API without a caller is YAGNI. Defer unless someone can name the query path that needs it.

**Item 9 (Wiki page versioning)** is low-risk, low-effort (one table + INSERT before UPDATE in synthesizePage). Fine to include, but it is not blocking anything.

## What is Missing

1. **LLM-based fact extraction** -- the single highest-impact improvement not in the plan. The heading heuristic produces garbage predicates. An LLM call per chunk to extract (subject, predicate, object) triples would transform fact quality. This is prerequisite to contradiction detection and graph links having any value.

2. **Default ranking profile wiring** -- the `rp-phase1-default` hardcode in search.ts must be fixed. Not Phase 3 scope, this is a Phase 2 bug.

3. **LLMService.generateBatch or parallel support** -- needed by multi-query expansion and potentially LLM-based fact extraction. The current interface is single-shot.

## Proposed Ordering

**Batch 0 (Bug fixes, 1 day):** Wire `rp-phase2-default` as the default profile in search.ts. This is Phase 2 debt, not Phase 3 scope, but it must land first.

**Batch A (Extraction quality, 1 week):** Item 8 (semantic chunking) + NEW: LLM-based fact extraction. These are the foundation -- everything downstream (contradiction, graph, wiki quality) depends on having real triples instead of "discusses" stubs.

**Batch B (Ranking + search, 3 days):** Item 2 (w3/w4 activation) + Item 7 (multi-query expansion with parallel LLM). Both are search-path changes with no schema dependencies on Batch A.

**Batch C (Cognitive loop, 1 week):** Items 3+4 merged (contradiction detection + resolution inside reflect) + Item 5 (wiki rebuild trigger). These form the complete reflect cycle and depend on Batch A producing meaningful facts to compare.

**Batch D (Nice-to-haves, 3 days):** Item 9 (wiki versioning). Item 1 (episodic table) only if an extractor ships with it. Item 6 (fact links) deferred unless a consumer is identified.

## Non-Obvious Risks

- **SQLite single-writer + LLM latency in reflect:** If contradiction arbitration calls the LLM (to judge which fact wins), the reflect cycle holds the write lock for potentially minutes. The daemon ingest worker will stall. Either arbitration must be read-only (heuristic rules only, no LLM), or reflect must release the lock between LLM calls and re-acquire for writes.

- **Embedding drift on re-chunking:** Semantic chunking (Item 8) changes chunk boundaries. Existing LanceDB vectors become stale. You need a migration strategy: either rebuild all vectors (expensive, blocks ingestion), or version the chunking policy in `derivation_run` and let old and new coexist (the transform policy immutability constraint supports this). The plan does not mention vector migration.

- **FTS5 index coherence:** If fact extraction changes from heading-based to LLM-based, the FTS5 content also changes. The `facts_fts` trigger syncs on INSERT, but a fact with a new object value from re-extraction needs an UPDATE path, not just INSERT. Verify the FTS5 content-sync triggers handle UPDATE correctly.
