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

### Phase 4 Batch D — Week 1-3 (2026-04-15)

Branch `feat/phase4-batch-d-myco-integration`. 9 debates (003-009), all 4/4 or 3/4 consensus.

**Week 1 (PR #1 merged)**
- P0-0: `fact_links` table + recursive CTE traversal API (migration 0011, path-string cycle detection workaround for SQLite "multiple recursive references" limit)
- P0-4: `facts.archive_reason` enum (6 values frozen) + `replaced_by_fact_id` writes from `reflect.ts` step 2 (`'stale'` decay tombstone) and step 3 (`'contradicted'` + `replaced_by_fact_id` arbitration loser)
- P0-7: `compost backup` / `compost restore` CLI + daemon scheduler (03:00 UTC, grace-window fire, tmp+rename atomic write, integrity_check via readonly open, PID liveness check, WAL/SHM cleanup)

**Week 2**
- P0-3: `v_graph_health` TS impl (`graph-health.ts` Union-Find over `fact_links`) + `graph_health_snapshot` (daily 04:00 UTC scheduler, same-day idempotent)
- P0-5: `correction_events` capture — post-drain hook in `scheduler.ts` scans observation for correction markers (regex + MinHash similarity), writes `health_signals.correction_candidate` (feeds triage only, never mutates `facts.confidence` directly)

**Week 3 Day 1-3**
- P0-2: `recordDecision` / `listDecisions` live in `cognitive/audit.ts`; `contradiction_arbitration` writes from `reflect.ts` step 3 (per-cluster, `loser_ids[]`); `wiki_rebuild` writes from `wiki.ts` (with `input_fact_ids[]` per debate 008 Q5 revision); `compost audit list` CLI
- P0-6: `CircuitBreakerLLM` (rolling 60s window, 50%+≥3 trip, 30s open, single-probe half-open with CircuitOpenError for concurrent callers) + `MockLLMService` (5 modes + sequence) + per-site `BreakerRegistry` (ask.expand / ask.answer / wiki.synthesis / mcp.ask.factory)
- P0-6 fallbacks: `wiki.ts` sets `wiki_pages.stale_at` on LLM failure; `ask.ts` reads `stale_at` banner + BM25 `[LLM unavailable]` fallback
- P0-6 Self-Consumption guard: `outbox.drainOne` regex-quarantines `file://<data-dir>/wiki/*.md` (home + `COMPOST_DATA_DIR`)
- Migrations: 0010-0013 (health_signals, decision_audit, graph_health_snapshot, correction_events, fact_links, wiki_pages.stale_at)

**Debate 009 Week 3 audit (4 fixes applied 2026-04-15)**
- Fix 1: `BreakerRegistry` wired into production (`mcp-server.ts` per-server singleton, `main.ts` daemon-wide registry passed to reflect scheduler). `ask()` + `synthesizeWiki()` accept `LLMService | BreakerRegistry` union signature
- Fix 2: `startReflectScheduler` accepts `{ llm, dataDir }` and calls `synthesizeWiki` after successful reflect (try/catch isolated so wiki errors don't stall reflect cadence)
- Fix 3: `recordDecision` wrapped in try/catch in `reflect.ts` step 3 (pushes to `report.errors`) and `wiki.ts` success path (console.warn) — audit failures no longer roll back business transactions
- Fix 4: half-open concurrent callers throw `CircuitOpenError` instead of sharing probe promise (prevents probe's answer leaking to unrelated prompts)

Test suite (post Day 4 cross-P0 integration): 286 pass / 0 fail / 3 skip across 29 files.

### Phase 4 Batch D — Week 4 (2026-04-15)

**P0-1 triage complete.** See `debates/011-week4-plan/synthesis.md` + `contract.md`.

- Day 1: single daemon-wide `BreakerRegistry` (main.ts owns it; mcp-server.ts + startReflectScheduler receive it as parameter). Contract frozen: 6 `SignalKind` values per `triage.ts:12-18`, surface-only, per-scan LIMIT 100.
- Day 2: `scanStuckOutbox` + `scanStaleWiki` with idempotent upsert (dedupes against *unresolved* signals only — resolving a signal permits a fresh one on the next scan if the target is still stuck)
- Day 3: `scanStaleFact` + `scanUnresolvedContradiction` (per `conflict_group`) + `scanOrphanDelta` (zero fact_links edges + no access within window); `correction_candidate` written directly by `correction-detector` drain hook, `triage()` aggregates only; `compost triage scan/list/resolve` CLI mirroring `audit` CLI enum-validation pattern
- Day 4: `startReflectScheduler` test-injectable `intervalMs` + 3 integration tests (happy / LLM fail → stale_at / no-llm skip); `compost doctor --check-llm` single-shot Ollama probe with 3s timeout + setup hint
- Day 5 hygiene: `ask()` hits=0 wiki title-slug fallback (Known-risks row 3 resolved); `compost audit` + `compost triage` CLI argument-validation tests (subprocess-based); `correction-detector.ts:65` comment updated per debate 012 (correctedText deferred Week 5+, no naive substring); stale `schema/0010:82` TODO comment retired per migration 0011 supersession
- Debate 012: `correctedText` naive-substring proposal **rejected** 3/3 (zero consumers today; field-semantics drift risk > 10-LoC implementation value). Week 5+ item pinned.

Test suite (post Week 4): 315 pass / 0 fail / 3 skip across 31 files.

---

## Planned

### Known risks (post Week 3, tracked for Day 4+)

Captured 2026-04-15 after debate 009 Week 3 audit + subsequent fix application.

| Risk | Location | Rationale | Mitigation / trigger |
|---|---|---|---|
| ~~Two `BreakerRegistry` instances~~ | **Resolved 2026-04-15 Week 4 Day 1**: `main.ts` builds a single `BreakerRegistry` at daemon boot and passes it to both `startReflectScheduler` and `startMcpServer(db, registry)`. `mcp-server.ts` no longer holds a per-server closure variable. | n/a |
| `synthesizeWiki` + `ask` union signature detects registry via `instanceof BreakerRegistry` | `cognitive/wiki.ts:213`, `query/ask.ts:73` | Adding a new breaker class (e.g. retry-only wrapper) breaks the branch | Convert to duck-typed `get(site)` check or refactor to interface when a second wrapper type lands |
| ~~`ask.ts` BM25 fallback drops `wikiContext` when `hits.length === 0`~~ | **Resolved 2026-04-15 Week 4 Day 5**: `ask()` now queries `wiki_pages` by question slug (case-insensitive match against `title` / `path` / `path.md`) when the retrieval step returns zero hits, so the `stale_at` banner + wiki content survive the empty-hits path. Covered by `cross-p0-integration.test.ts` Scenario B2. | n/a |
| `Self-Consumption` regex only matches Unix paths (`file://.../.compost/wiki/*.md`) | `ledger/outbox.ts isWikiSelfConsumption` | Windows paths (`file:///C:/...`) and `wiki/topic/sub.md` nested pages are not blocked | Low priority while macOS-only; revisit before any Windows / nested-wiki support |
| `reconstructConfidenceTier` uses float equality (`=== 0.9` / `=== 0.85`) | `cognitive/audit.ts listDecisions` | SQLite stores `REAL` as IEEE754; values round-tripped may not `===` literal | No production incident yet (migration `DEFAULT 0.85` is exact). Switch to `<` / `>` bands if a future migration introduces computed floors |
| `decision_audit.profile_switch` variant declared in `EvidenceRefs` union but has no caller | `cognitive/audit.ts` | Schema CHECK permits the kind; `listDecisions` would return such rows silently if someone inserts directly | Add CHECK or producer when Week 5+ profile switcher lands |
| Circuit breaker state not persisted across daemon restart | `llm/circuit-breaker.ts` (debate 007 Risk 2, accepted) | First post-restart call may incur an extra failure before window reopens | Accepted trade-off; revisit only if restart frequency becomes abnormal |
| `decision_audit` has no TTL; evidence_refs_json payloads may exceed payload budget for wiki_rebuild with 10K+ input_fact_ids | `cognitive/audit.ts recordDecision` | Personal-tool scale makes this unlikely | Add retention policy + payload-size guard if table exceeds 100K rows (revisit per removed Phase 4 item) |

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
