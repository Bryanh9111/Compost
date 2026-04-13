# Debate 9: Compost Phase 3 Execution Plan Review

## Question

Review the Phase 3 execution plan for Compost. Identify:
1. Items that are infeasible or poorly scoped
2. Missing deliverables that should be included
3. Better alternatives to any proposed approach
4. Optimal ordering/batching of the 9 deliverables
5. Dependencies between items that constrain parallelism

## Context

Compost is a self-evolving knowledge base:
- Runtime: Bun (TypeScript) + Python subprocess (extraction only)
- Storage: SQLite WAL (~/.compost/ledger.db) + LanceDB (vector index)
- Embedding: Ollama nomic-embed-text-v1.5 (768d, local)
- LLM: Ollama (local, gemma4:31b default)
- Current: 8.1K lines TS+Python, 128+18 tests, 7 migrations, 19 tables

Phase 2 just completed:
- BM25+ANN hybrid search with RRF fusion
- Temporal decay (w2) active in ranking
- Web URL ingest with freshness loop
- LLM synthesis (compost.ask)
- Daemon ingest worker (just fixed: hook -> outbox -> drain -> ingest -> embed)

Known quality issues:
- Fact extraction is heading-based only: all predicates are "discusses", objects truncated
- ranking_profile still using rp-phase1-default (w1 only), rp-phase2-default exists but not wired
- w2_temporal, w3_access, w4_importance exist in schema but w3/w4 not activated

## Proposed Phase 3 Deliverables (9 items)

### Original (from spec):
1. **Episodic memory materialization** - memory_episodic link table (fact_id -> episode metadata)
2. **w3_access + w4_importance ranking activation** - ranking factors from Phase 1 schema
3. **Contradiction arbitration** - detect conflicting facts, arbitrate (newer > higher-confidence > multi-source)
4. **Complete reflect cycle** - contradiction resolution + wiki rebuild trigger + fact consolidation
5. **Wiki rebuild** - detect L2 fact changes -> re-synthesize affected wiki pages

### GBrain-inspired ports (from garrytan/gbrain evaluation):
6. **Fact-to-fact links graph** - fact_links table + recursive CTE traverseGraph
7. **Multi-query expansion** - Ollama LLM generates 2-3 query variants before retrieval
8. **Semantic chunking** - Savitzky-Golay smoothing for topic boundary detection (replace heading-based)
9. **Wiki page versioning** - wiki_page_versions table, auto-snapshot on reflect rewrite

## Constraints
- Pure local: no cloud APIs, no Postgres, no OpenAI
- kb-core must remain a pure library (no side effects on import)
- Python extraction boundary: ML/NLP in subprocess, Bun never imports Python
- Transform policies are immutable: new behavior = new policy key
- SQLite single-writer: no concurrent write transactions
