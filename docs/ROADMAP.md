# Compost Roadmap

## Completed

### Phase 0: Encoding + Storage (2026-04-11)
- SQLite WAL provenance ledger (L0) with 5 initial migrations
- Observe outbox with crash-safe drain transaction
- Ingest queue with lease protocol (60s lease, heartbeat, poison-pill quarantine)
- Python extraction subprocess (markdown chunking + heading-based facts)
- is_noteworthy 3-gate dedup (raw hash, norm hash, MinHash jaccard)
- Reflect: sensory hard-GC (7d TTL) + semantic soft-tombstone
- Claude Code hook shim (p95 < 30ms cold start)
- CLI: daemon, add, query (stub), doctor, hook, reflect, drain
- MCP server: compost.observe, compost.query (stub), compost.reflect
- 6 architecture debates (Opus/Sonnet/Gemini/Codex), 3 surveys

### Phase 1: Semantic Retrieval (2026-04-12)
- EmbeddingService interface + Ollama adapter (nomic-embed-text-v1.5, 768d)
- VectorStore (LanceDB) with search/add/delete/rebuild
- End-to-end ingest: outbox -> drain -> Python extract -> facts INSERT -> chunk embedding -> LanceDB
- Migration 0006: chunks table (L1 manifest) + FTS5 virtual table + triggers
- Query: LanceDB ANN Stage-1 -> SQLite rerank Stage-2 (w1_semantic only)
- ranking_profile loader + access_log + ranking_audit_log telemetry
- is_noteworthy gates 4+5 (cosine dedup + novel fact count)
- compost doctor --rebuild L1 (atomic build-then-swap)
- compost.feedback (result_selected marking)
- Bug fix: derivation_run.layer='L1' -> 'L2'
- Debate 7: 4-way plan review, 12-step revised plan

### Phase 2: Hybrid Search + Web + LLM (2026-04-12)
**Batch A (Search Quality)**
- Fix chunk->fact round-robin mapping (explicit source_chunk_ids)
- Migration 0007: FTS5 backfill + web_fetch_state table + rp-phase2-default
- BM25 hybrid retrieval: FTS5 Stage-0a + LanceDB Stage-0b + RRF merge
- BM25 works as independent fallback when LanceDB unavailable
- w2_temporal + w3_access activation in rp-phase2-default
- FTS5 query preprocessing (OR-join words for recall)

**Batch B (Web Ingest)**
- tp-2026-04-02 transform policy for web content
- trafilatura HTML extractor (Python) with fallback
- Web URL ingest pipeline with ETag/Last-Modified conditional requests
- compost add <url> CLI support
- Active freshness loop in daemon scheduler (60s poll)
- web_fetch_state lifecycle (304 skip, failure backoff)

**Batch C (LLM Layer)**
- LLMService interface + Ollama adapter
- L3 wiki synthesizer: facts -> markdown via LLM
- compost.ask: hybrid query + wiki context + LLM synthesis
- compost.ask MCP tool

**Dogfood fixes**
- BM25 multi-word query (FTS5 MATCH implicit AND -> OR)
- Web ingest FK constraint (source not yet registered)
- CLI add/query embedding connection

Debate 8: 4-way Phase 2 plan review, 10-step revised plan

**Daemon ingest worker** (2026-04-13)
- startIngestWorker in scheduler.ts (claims ingest_queue -> Python extract -> embed -> facts/chunks)
- Daemon initializes OllamaEmbeddingService + VectorStore at startup
- drainOne tolerates hook payloads missing occurred_at/mime_type (auto-derives from appended_at)
- Passive capture pipeline now end-to-end: hook -> outbox -> drain -> ingest -> embed

### Phase 3: Consolidation (2026-04-13)

**Batch 0: Phase 2 debt fix**
- Wire rp-phase2-default as default ranking profile (search.ts hardcode fix)

**Batch A: Extraction quality**
- Improved heading-based fact extraction: 14 inferred predicates replace "discusses"
- Object extraction: 2-3 sentences instead of truncated first sentence
- LLM-based fact extraction: local Ollama (gemma3:4b) extracts SPO triples from chunks
- New transform policy tp-2026-04-03

**Batch B: Search quality**
- rp-phase3-default ranking profile: w4_importance=0.1 activated
- Migration 0008: new ranking profile
- Multi-query expansion in compost.ask: LLM generates 2-3 query variants, fan-out search, dedup

**Batch C: Cognitive loop**
- Contradiction detection + resolution in reflect (heuristic: confidence > recency)
- superseded_by + conflict_group tracking
- Wiki rebuild trigger fix: watches archived_at changes (Opus debate 9 bug find)
- Wiki page versioning: wiki_page_versions table, auto-snapshot before rewrite
- Migration 0009: wiki_page_versions + contradiction indexes

**Deferred to Phase 4** (debate 9 consensus: 4/4 agree)
- Episodic memory materialization (no extractor consumer)
- Fact-to-fact links graph (no caller in query/wiki/reflect)
- Semantic chunking / Savitzky-Golay (heading-based adequate for markdown)

Debate 9: 4-way (Opus/Sonnet/Gemini/Codex) plan review, revised to 4 batches

---

## Planned

### Phase 4: Active Learning (weeks 9-12)

> Updated 2026-04-14 after gap audit — see `debates/002-roadmap-gap-audit/synthesis.md`.
> Original Batch D (5 P0) revised to **8 P0** after 4-way debate found:
> (a) `fact_links` was hidden P0-3 prerequisite, (b) backup/restore is data-loss
> insurance not optional, (c) LLM single-point failure needs circuit breaker.

**Phase 4 P0 (8 items, 4/4 consensus)**

| # | Item | Depends on |
|---|------|------------|
| P0-0 | `fact_links` table + bidirectional FK + recursive CTE API (was Phase 3 carried, promoted) | none |
| P0-1 | `compost triage` + `health_signals` (5 signal kinds, surface-only) | 0010 |
| P0-2 | `decision_audit` table + confidence ladder (0.90/0.85/0.75) writes | P0-4 enum stable |
| P0-3 | `v_graph_health` TS impl + `graph_health_snapshot` (bundled with P0-0 PR) | P0-0 |
| P0-4 | `facts.archive_reason` + `replaced_by_fact_id` + `revival_at` writes | facts |
| P0-5 | `correction_events` capture (signal feeds triage; never directly mutates `facts.confidence`) | hook-shim |
| P0-6 | LLM circuit breaker + `IExtractorClient` provider abstraction + Self-Consumption guard (reject Wiki/ source re-ingest) | none |
| P0-7 | `compost backup` + `restore` (SQLite VACUUM INTO + 24h cron + 30 retained snapshots) | none |

**Phase 4 P1 (4 items, after P0 lands)**
- `open_problems` table + CLI (consolidates old "Curiosity agent" + "Gap tracker")
- Inlet `origin_hash` + `method` columns on `observations` (machine-required, user-optional)
- Performance benchmark harness (`bench/` with reflect-1k/10k/100k.bench.ts + CI > 50% regression alert)
- PII redactor in hook-shim (regex blocklist for CC / SSH / API-token / .env / "password:" patterns; required before any open-source release)

**Carried from Phase 3 (still scheduled, no tier change)**
- Episodic memory materialization (`session_turns` FTS5 + episode summary)
- `memory_procedural` standalone table (P2 candidate — Gemini-Opus disagreement, observe before deciding)

**Phase 4 P2 (defer indefinitely; revisit after P0+P1)**
- Semantic Cohort Intelligence (query-side experimental)
- Milestone retrospective scheduler
- Four-layer self-model dashboard (downgraded: triage already covers A inventory + C decay)
- `compression_pressure` SQL view (downgraded: `health_signals.stale_fact` already proxies pressure)
- `memory_procedural` standalone table

**Removed from Phase 4** (4/4 Reject in debate)
- ~~Curiosity agent~~ (replaced by `open_problems` + triage signals)
- ~~Gap tracker~~ (replaced by `open_problems`)
- ~~Autonomous crawl with is_noteworthy gates~~ (breaks first-party principle)
- ~~`crawl_queue`~~ (duplicates `open_problems` + manual `compost add <url>`)
- ~~Cross-project `shareable` tag + export~~ (moved to Phase 5 portability)
- ~~Semantic chunking / Savitzky-Golay~~ (no evaluation framework; heading-based already adequate)
- ~~Audit log TTL design~~ (YAGNI for personal-tool ingest rates; revisit if `decision_audit` exceeds 100K rows)
- ~~Migration `down.sql` rollback machinery~~ (P0-7 backup covers recovery; restore-from-backup beats partial revert)

### Phase 5: Portability (later, on demand)

> Renamed from "Multi-Host". Multi-host concurrency was an enterprise pseudo-need;
> single-user portability (laptop swap, machine reinstall) is the real scenario.

**Planned**
- `compost export <bundle>` and `compost import <bundle>` (markdown + sqlite dump combo)
- Conflict-resolution design doc (decide before coding: last-writer-wins / merge / fail)

**Removed**
- ~~Cross-machine sync protocol~~ (no demonstrated user need)
- ~~Multi-host concurrency coordination~~ (enterprise)
- ~~HTTP transport for remote MCP clients~~ (MCP stdio is sufficient)

### Phase 6: Ecosystem (later, minimal scope)

**Planned**
- `compost-adapter-openclaw` (concrete user need)
- Multimodal metadata extractor (`attachment` field with URL/MIME/size; **no content parsing**)
- Prometheus / OpenTelemetry metrics export (operational visibility)

**Removed**
- ~~PDF (docling) full extraction~~ (workaround: `pdftotext file.pdf | compost add -`)
- ~~Video transcripts~~ (no observed user demand)
- ~~Code repos full ingest~~ (code already lives in git; no second-brain value)
- ~~`hermes` / `airi` adapters~~ (no concrete user request)
- ~~`compost relearn`~~ (Phase 5 export/import covers it)

---

## Milestones

| Milestone | Phase | What it means |
|-----------|-------|---------------|
| Queryable with manual maintenance | 2 | **Done** -- add/query/ask all work |
| Self-maintaining knowledge | 3 | **Done** -- contradiction arbitration, wiki rebuild, LLM extraction |
| Self-evolving | 4 | Three ingest paths live (push + sniff + crawl) |
| Portable | 5 | Clone to new machine, knowledge survives |
| Ecosystem | 6 | Multiple host adapters + source types |
