# Round 1 — Codex — Debate 025

## Q1 reasoning architecture (a / b / c) — **pick: (c) Parallel + RRF**

Pick **(c)**. Graph-first under-recovers in the actual repo. `fact_links` supports five kinds: `supports`, `contradicts`, `elaborates`, `derived_from`, `same_subject` (`0011_fact_links_and_health_fix.sql:18-24`; mirrored in `fact-links.ts:19-25`). But production writes I found are basically contradiction-resolution edges: `reflect.ts:252-257` writes `addLink(..., "contradicts")`. The tests exercise other kinds, but test fixtures are not corpus density.

Embedding/FTS retrieval is already the stronger recall substrate: `query()` runs BM25 via FTS5 (`search.ts:106-127`), optional LanceDB ANN (`search.ts:157-172`), then RRF (`search.ts:179-180`) and ranking-profile rerank (`search.ts:217-263`). L5 should not bet on sparse graph coverage.

The realistic cost of (c) is medium, not huge: recursive graph traversal already exists (`fact-links.ts:182-247`), LanceDB search exists (`lancedb.ts:76-95`), FTS5 exists inside `query()`, and RRF exists but is private (`search.ts:55-85`). First patch should extract a reusable `rrfMerge`/candidate helper rather than fork retrieval logic. That is more work than (b), but it is the only option that preserves roadmap semantics: explicit graph evidence plus semantic recall.

## Q2 MVP slice (α / β / γ / δ) — **pick: (α) Cross-fact reasoning**

Pick **(α)**. It is the only slice that proves the L5 substrate: seed fact/topic → retrieve candidate set → produce chain with fact ids, edge explanations, and scores. Pattern detection is cheaper than hypothesis generation because `user_patterns` already shipped (`0015_user_model_schema.sql:24-103`) and the design says Phase 7 populates it (`phase-5-user-model-design.md:39-41`, `168-174`). But cheap is not the same as architecture-validating.

γ is definitely higher cost than β: hypothesis generation needs either a new facts shape or a new hypothesis table; the base `facts` table has no `kind` column (`0001_init.sql:89-101`), so option A is not a one-line insert. β can populate `user_patterns`, `user_pattern_observations`, and `user_pattern_events` without reschema. Still, β is mostly a policy/populator slice; α builds the retrieval/reasoning primitive β and γ should later consume.

## Q3 storage shape (A / B / C / D) — **pick: B**

Pick **B: new `reasoning_chains` table**. A is wrong for current schema: `facts` has no `kind` column (`0001_init.sql:89-101`), so `kind='hypothesis'` is a real reschema plus downstream semantic pollution. C violates the frozen audit constraint: SQL CHECK allows exactly four kinds (`0010_phase4_myco_integration.sql:43-58`) and TS mirrors exactly those four (`audit.ts:15-19`). D violates ownership: Engram should receive synthesized insight only through the debate-024 writer path, not become the scratchpad for Compost reasoning. The Phase 5 doc is explicit that pattern derivation belongs in Compost because it needs LLM/graph traversal (`phase-5-user-model-design.md:133-144`).

B gives CI-testable surface: deterministic chain rows can assert seed, candidate fact ids, retrieval sources, no archived facts, and stable ordering with mocked scores. Keep the table narrow: `chain_id`, `seed_kind`, `seed_id`, `candidate_fact_ids_json`, `edge_refs_json`, `retrieval_trace_json`, `answer_json`, `confidence`, `created_at`.

## Q4 triggering (p / q / r) — **pick: q**

Pick **(q) on-demand only**. Context hard constraint #6 is right: single-user background LLM spend is not free (`context.md:80-81`). Existing L4 selectors are deterministic and cheap: digest selects facts/gaps/wiki rebuilds from SQLite (`digest.ts:70-99`, `101-218`), and curiosity clusters gaps with token/Jaccard logic, no LLM (`curiosity.ts:9-37`, `121-210`). Use those outputs as suggested seeds for manual/on-demand `compost reason`, not as automatic LLM triggers.

Hybrid scheduled reasoning is tempting, but it quietly creates a background spend policy before the value of chains is proven. Start with `compost reason <fact_id|topic>` plus MCP `compost.reason`.

## Q5 L5-internal ask semantics (X / Y / Z) — **pick: X**

Pick **X: `gapThreshold: null`**. This is already the public contract: `AskOptions.gapThreshold?: number | null`, where `null` disables logging for tests and L5 internal asks (`ask.ts:35-45`). The implementation honors that guard before calling `logGap` (`ask.ts:257-273`). Debate 023 also locked the same default: L5 internal calls pass null to avoid Curiosity self-pollution (`023.../synthesis.md:19-22`).

Y needs a gaps schema change. Z needs `decision_audit` kind expansion, directly conflicting with the SQL CHECK and TS union above. Internal “could not reason” should live in `reasoning_chains.answer_json`, not L4 `open_problems`.

## Cross-critique

Likely graph-first advisors are over-trusting `fact_links`. `context.md` says `fact_links` are “mainly contradiction/superseded” (`context.md:37`), but that is inaccurate: there is no `superseded` link kind in migration 0011 (`0011...sql:18-24`) or the TS enum (`fact-links.ts:19-25`). Supersession is a column on `facts` (`0001_init.sql:99`) and later archive metadata (`0010...sql:91-102`), not a graph edge. The practical part of the context claim is still true only after correction: production link density is mostly contradiction edges because `reflect.ts:252-257` is the only production `addLink` writer found by `rg`.

Also, `context.md` points to `packages/compost-core/src/schema/migrations/0011_*.sql` (`context.md:107`), but the repo uses `packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql`. That matters because advisor arguments should cite actual files, not a stale path.

Attack on β-first: yes, β is cheaper than γ because schema exists (`0015_user_model_schema.sql:24-103`) and the design says Phase 7 writes it (`phase-5-user-model-design.md:146-174`). But β does not settle graph vs embedding vs RRF. It can ship a useful user-model populator while leaving the core L5 architecture undecided. α forces the hard retrieval decision first.

## TL;DR

Pick **c / α / B / q / X**.  
Fix context: no `superseded` fact_link kind; schema path is `src/schema`, not `src/schema/migrations`.  
First code: extract reusable RRF/candidate plumbing, add on-demand `reason`, persist `reasoning_chains`, keep internal asks silent.
