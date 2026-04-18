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

Test suite (post Week 4 + debate 013 fixes): 318 pass / 0 fail / 3 skip across 31 files.

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
| P0-1 | `compost triage` + `health_signals` (6 signal kinds: 5 scanners + 1 drain-hook producer; surface-only) | 0010 |
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
| Fork-ready personal brain | 4 | PII + bench + examples + docs — anyone can `git clone` and grow their own |
| Integrated with Engram | 5 | Bidirectional channel: Engram events flow in, Compost insights flow back |
| Autonomous exploration | 6 | Curiosity agent + Gap tracker + proactive push (L4 self-evolution) |
| Analytical partner | 7 | Cross-fact reasoning + pattern detection + daily digest (L5) |
| Portable | 8 | seed templates + export/import (for machine migration) |
| Ecosystem | 9 | openclaw / multimodal / metrics (optional extensions) |

---

## Strategic Direction v3 (2026-04-16, post-calibration)

> Following repeated product-identity calibration with the user across this session,
> Compost's strategic direction is clarified. This section supersedes the earlier
> "Phase 5 Portability" and "Phase 6 Ecosystem" positioning (kept above for history)
> and activates items previously listed under "Removed from Phase 4".

### Product identity (anchor)

- Compost is a **personal AI brain / analytical partner** — not a tool, not a library, not a SaaS
- Goal: **10+ year single-user deep-personalization companion**
- Distribution: **MIT open source, fork-template model** — anyone can `git clone` and grow their own; no central instance, no PR acceptance, no community maintenance overhead
- Relationship with Engram: **bidirectional core channel** (not opt-in) — Engram events flow into Compost as a source, Compost insights flow back to Engram as new entries

### Self-evolution levels

Compost's autonomy ladder. We are currently at L3, targeting L5-L6.

| Level | Capability | Status |
|-------|-----------|--------|
| L1 | Passive ingestion (observe → structure) | ✅ Phase 0-1 |
| L2 | Periodic self-organization (reflect, decay, wiki synth) | ✅ Phase 2-3 |
| L3 | Self-correction (contradiction arbitration, wiki versioning) | ✅ Phase 3 |
| L4 | **Autonomous exploration** (curiosity, gap tracking, user-approved crawl) | 🔨 Phase 6 |
| L5 | **Analytical reasoning** (cross-fact reasoning, pattern detection) | 🔨 Phase 7 |
| L6 | **User model + proactive push** (knows me, tells me) | 🔨 Phase 7 |

### Phase 4 P1 (✅ shipped 2026-04-17 — fork-ready personal brain)

> Order per debate 017 (4/4 consensus): PII > bench > origin_hash > open_problems.
> open_problems deferred to Phase 6 (merged into Curiosity agent design).

- ✅ **Session 1** (commit `01c070c`) — PII redactor + `compost doctor --check-integrity` audit
  - `packages/compost-hook-shim/src/pii.ts` with regex blocklist (CC/SSH/API-token/.env)
  - `scrub` before `JSON.stringify(envelope)` in `index.ts:108`
  - `compost doctor --check-pii` / `--check-integrity` shipped; +38 tests
- ✅ **Session 2** (commit `a494c6a`) — Layered bench harness
  - Per-layer benches: `sqlite-reflect`, `sqlite-query`, `lancedb-ann`, `llm-latency`
  - CI gate + reproducible numbers in `bench/README.md`; +10 tests
- ✅ **Session 3** (commit `a861db4`) — `origin_hash` migration + `examples/` + docs layering
  - Migration 0014: `observations.origin_hash` + `method` (nullable, backfill via `pipeline/backfill-origin.ts`)
  - `examples/01-local-markdown-ingest/`, `02-web-url-ingest/`, `03-mcp-integration/`
  - Docs split: `QUICKSTART.md` / `CONCEPTS.md` / augmented `ARCHITECTURE.md`; +8 tests
  - Bench regression verified: reflect-10k -0.3%, query-10k +1% (well under 5% threshold)

### Phase 5 — Engram integration + user model foundation (🚧 in progress)

**Blocker cleared** 2026-04-17: Engram v3.4 Slice B Phase 2 S2 shipped at
`main @ ea223fa` (Engram now `main @ 0ee0580` with ARCHITECTURE.md §7 as
canonical contract reference; zero structural drift from our plan).

Session plan per debate 020 synthesis (Compost side,
`debates/020-phase-5-session-4-slicing/`): split the full ~800 LoC scope
into write-path-first / read-path-next / reconcile-last to let each
session ship independently and testable. Debate 020 verdict Option B
(write-path vertical) was unanimous across 3 respondents (Gemini, Sonnet,
Opus; Codex timed out).

- ✅ **Session 4** (commit `1e6837b`, 2026-04-17) — write path + user model schema
  - Migration 0015: `user_patterns` + `user_pattern_observations` +
    `user_pattern_events` (derived user model, Phase 7 populates)
  - `packages/compost-engram-adapter/` new workspace:
    - `constants.ts` — frozen UUIDv5 namespace, 90-day `expires_at`, 2000-char
      cap, 0.75 Engram dedupe ceiling, `~/.compost/pending-engram-writes.db`
    - `splitter.ts` — deterministic `root_insight_id` from
      `uuidv5(ns, project + '|' + sorted_fact_ids)`; paragraph →
      sentence → hard-cut fallback; `checkAdjacentSimilarity` Jaccard
      detector (R6 — Engram's `INSERT OR IGNORE` + content-similarity
      dedupe would silently merge adjacent chunks crossing 0.75)
    - `pending-writes.ts` — SQLite offline queue with `pair_id` two-phase
      log (R1 — invalidate+re-remember gap) and `pruneExpired(graceMs)`
      (R2 — TTL drift from long-delayed flushes)
    - `writer.ts` — `validateSourceTrace` zod at the writer boundary
      (R3 — catches typo'd field names like `compost_fact_id` singular
      that would silently slip past Engram's `_map_insight_sources`);
      `writeInsight` / `invalidateFacts` / `flushPending`; takes
      `EngramMcpClient` interface so the concrete MCP glue lives outside
      the adapter
  - Tests: 374 → 416 (+42), typecheck clean, bench unchanged
- ✅ **Session 5** (commit `9bedac7`, 2026-04-17) — read path + ingest adapter
  - Verdict via debate 021 (Option E over F; synthesis in
    `debates/021-phase-5-session-5-slicing/`). F was rejected on two
    concrete blockers: (1) schema/0005_merged_outbox.sql:14 source_kind
    CHECK excludes 'engram'; (2) scheduler.ts:286 Python extractor
    subprocess would hallucinate facts from pre-structured Engram
    payloads. 2-1 (Gemini F, Sonnet E, Opus E), Codex non-participating.
  - `stream-puller.ts` — `EngramStreamClient` interface, 9-key zod
    schema (`engramStreamEntrySchema`) per ARCHITECTURE.md §7.1,
    cursor at `~/.compost/engram-cursor.json` (since + last_memory_id),
    crash-safe `pullAll(onBatch)` saving cursor only after successful
    ingest, `include_compost=false` hardcoded.
  - `ingest-adapter.ts` — `ensureEngramSource(db)` seeds
    `source.id='engram-stream', kind='sensory'` (reused per debate 021
    synthesis; Migration 0017 only if Phase 7 exposes ambiguity).
    `ingestEngramEntry` directly INSERTs observations + facts + chunks
    in one transaction, skipping ingest_queue + Python extractor (R2
    mitigation — pre-structured Engram payloads don't need NLP).
    origin_hash = SHA-256(adapter|source_uri|idempotency_key) per
    Migration 0014 contract. `defaultSpoMapper` best-effort
    kind→predicate mapping; injectable for Phase 7 refinement (R3).
  - Origin-hash reconciliation (flagged in S4 wrap as pre-work) was
    unnecessary: Migration 0014 was always adapter|source_uri|idempotency
    based, never content-hash. Zero migration needed.
  - Tests: 416 → 443 (+27). 16 stream-puller + 11 ingest-adapter.
- ✅ **Session 6 slice 1** (commit `39bec88`, 2026-04-17) — concrete read transport + daemon poller + CLI
  - `cli-stream-client.ts` — `CliEngramStreamClient` spawns
    `engram export-stream` subprocess, parses JSONL, re-validates via
    the S5 zod schema. Injectable `SpawnFn` for tests. All failures
    surface as `MCPCallResult` errors with line number + memory_id for
    drift diagnosis.
  - `compost-daemon/src/engram-poller.ts` — `startEngramPoller(db, opts)`
    mirrors `startIngestWorker` shape; wraps `StreamPuller.pullAll` +
    `ingestEngramEntry`. `runEngramPullOnce` exposed for CLI trigger.
  - `compost-cli`: `compost engram-pull [--dry-run] [--project] [--kinds]`
    manual trigger. JSON stats to stdout.
  - Tests: 443 → 462 (+19). Engram CLI `invalidate_compost_fact` has no
    equivalent subcommand, so write-path concrete transport is deferred
    — read path was the strategic priority (Phase 6 Curiosity needs
    Engram events flowing into Compost).
- ✅ **Session 6 slice 2** (commit `b2ef329`, 2026-04-17) — write-path concrete MCP transport
  - `mcp-stdio-client.ts` — `StdioEngramMcpClient` implements
    `EngramMcpClient` from S4 writer via MCP `tools/call`. Supports
    both `structuredContent` (MCP 1.x preferred) and `content[0].text`
    JSON fallback. `createStdioMcpClient` factory lazy-imports
    `@modelcontextprotocol/sdk` Client + StdioClientTransport and
    spawns `engram-server`; injectable `McpToolClient` keeps MCP SDK
    out of the test path.
  - `compost-daemon/src/engram-flusher.ts` — `startEngramFlusher`
    periodically invokes `EngramWriter.flushPending()` (5 min default
    cadence), mirrors engram-poller shape. `runEngramFlushOnce` for
    CLI.
  - `compost-cli`: `compost engram-push [--dry-run] [--queue-path]
    [--engram-server-cmd]` — manual flush trigger, dry-run shows queue
    stats (by kind / oldest enqueue time), real run spawns the MCP
    transport and flushes with JSON stats on stdout.
  - Tests: 462 → 479 (+17). 12 mcp-stdio-client + 5 engram-flusher.
- 📋 **Future** — `compost doctor --reconcile-engram` cross-checks
  `~/.compost/pending-engram-writes.db` vs Engram state; surfaces
  orphaned invalidate-without-remember (R5 blind-write mitigation).
  Deferred until one live dogfood cycle validates the new loop.

**Anchor v2 双向核心 satisfied**: Compost can now both pull Engram
events (read runtime in S6-slice-1) AND push insights + invalidations
(write runtime in S6-slice-2). Phase 5 loop closed end-to-end.

**Engram coupling invariants honored**:

- Pull (Engram → Compost): `mcp__engram__stream_for_compost(since, kinds, project, include_compost=False, limit=1000)` excludes `origin=compost` entries by default to prevent Compost re-ingesting its own outputs (Engram ARCHITECTURE §7.1).
- Push (Compost → Engram): reuses `mcp__engram__remember(origin='compost', kind='insight', source_trace, expires_at)`. Engram's `_map_insight_sources` auto-fills `compost_insight_sources` from `source_trace.compost_fact_ids`. No separate write tool.
- Invalidate: `mcp__engram__invalidate_compost_fact(fact_ids[])` — soft delete with 30-day physical-purge grace; pinned `origin=compost` entries also invalidated by design (Compost is not a human — Engram ARCHITECTURE §4.2).
- Independence (HC-1): either side down, the other runs normally. Failed writes queue locally in `~/.compost/pending-engram-writes.db`.
- Readiness probe: `bun scripts/probe-engram-readiness.ts`.

**Open questions resolved** (`docs/phase-5-open-questions.md`):

- Insight chunking uses `source_trace` JSON (`root_insight_id` + `chunk_index` + `total_chunks`) — zero Engram schema change.
- `expires_at` default = `synthesized_at + 90 days`, overridable per synthesis producer. 2000-char per-entry self-split retained.

**Compost/Engram user model boundary**: raw `preference` / `goal` / `habit` kinds live in Engram (its anchor v2). Compost derives `writing_style` / `decision_heuristic` / `blind_spot` / `recurring_question` / `skill_growth` patterns over observations + facts. See `docs/phase-5-user-model-design.md`.

### Phase 6 — Autonomous exploration (L4) (🚧 in progress)

> Reactivates items previously listed under "Removed from Phase 4" (ROADMAP:193-199)
> because L4 is a **core product identity** item, not a P2 defer.

- ✅ **P0 slice 1** (commit `18d3bfd`, 2026-04-17) — **Gap tracker foundation**
  - Migration 0016: `open_problems` table (problem_id, question, question_hash UNIQUE, status, ask_count, timestamps, resolved_by trail).
  - `packages/compost-core/src/cognitive/gap-tracker.ts` — normalizeQuestion / questionHash / logGap (upsert with ask_count reinforcement) / listGaps / dismissGap / resolveGap / forgetGap / gapStats.
  - `compost gaps list|forget|dismiss|resolve|stats` CLI.
  - `compost.ask` MCP tool auto-logs gaps when `hits.length === 0` or top confidence < 0.4. Logging failure is non-fatal (try/caught).
  - Tests: 479 → 496 (+17).
- ✅ **P0 slice 2 Round A** (2026-04-17) — **Digest selector + renderer (dry-run only)**
  - `packages/compost-core/src/cognitive/digest.ts` — deterministic selector over
    the last N days: new confident facts (archived_at IS NULL, superseded_by IS NULL,
    confidence ≥ floor), resolved gaps, wiki page rebuilds. No LLM; headings fixed.
  - `renderDigestMarkdown()` emits per-group sections (omits empty groups; `(no items)`
    fallback) and `digestInsightInput()` reshapes into `{compostFactIds, content,
    synthesizedAt}` — Round B will feed this straight into `EngramWriter.writeInsight()`.
  - `compost digest` CLI: `--since-days` (default 7), `--confidence-floor`, `--max-items`
    per group, `--json`, and `--insight-input` to preview Round B payload.
  - Tests: 496 → 518 (+22); digest.ts at 100/100 func/line coverage.
- ✅ **P0 slice 2 Round B** (2026-04-17) — **Digest push wiring + floor re-tune**
  - Debate `022-wiki-only-digest-shaping` locked decision: change default floor
    from `CONFIDENCE_FLOORS.instance` (0.85) to `.exploration` (0.75). Rationale:
    digest uses confidence as "noteworthiness filter", not arbitration trust
    threshold; schema default for `facts.confidence` is 0.8, so at 0.85 typical
    personal-KB ingest was invisible. Dogfood on author's live ledger confirmed:
    pre-patch = 0 new_facts over 30d; post-patch = 11 facts surfaced. Debated
    synthetic fact_id (option b) rejected 4/4 — breaks UUIDv5 idempotency seed
    in `computeRootInsightId` and silently no-ops Engram invalidate routes.
  - `packages/compost-daemon/src/digest-push.ts` — `runDigestPushOnce(opts)` mirrors
    `runEngramFlushOnce` shape: takes a `DigestReport` + `EngramMcpClient` +
    `PendingWritesQueue`, calls `EngramWriter.writeInsight` with scope=meta,
    tags=["digest"]. Wiki-only reports return `{status: "skipped-empty"}`
    (slice 3 will add wiki provenance via `decision_audit.evidence_refs_json`).
  - `compost digest --push` CLI: spawns `StdioEngramMcpClient` same as
    `compost engram-push`; `--engram-server-cmd` + `--queue-path` overrides.
    Exit code 1 on `result.ok = false`.
  - Tests: 518 → 525 (+6 digest-push + 1 default-floor regression guard).
- 📋 **P0 slice 3** — Wiki provenance via `decision_audit` JOIN
  - Extend `selectWikiRebuilds` to JOIN `wiki_pages ⋈ decision_audit WHERE
    kind='wiki_rebuild'` and parse `evidence_refs_json.input_fact_ids`
    (already persisted by `packages/compost-core/src/cognitive/wiki.ts:190`).
    Merge into `digestInsightInput` fact_id Set so wiki-only digests can push.
    Zero schema change.
  - Defer until Round B dogfood validates live transport at least once.
- 📋 **Curiosity agent** — pattern detection over observations → drives gap creation from repeated questions, proactive fact suggestions
- 📋 **User-approved crawl queue** — Compost proposes external sources (URLs, docs) to ingest; user approves via CLI / one-click; **never auto-sends requests** (respects first-party principle)

### Phase 7 — Analytical partner (L5)

- **Cross-fact reasoning engine** — graph traversal over `fact_links` + semantic similarity to find related but unconnected facts
- **Pattern detection** — cluster facts by theme / time / source to surface emergent patterns
- **Hypothesis generation** — from known facts, propose plausible unknowns (tagged as hypothesis, not fact)
- **User model update loop** — observed decisions update `user_profile.preferences` automatically
- **Reflection prompts** — generate thoughtful questions to help user think deeper about their own knowledge

### Phase 8 — Portability (descoped from former Phase 5)

- `seed templates/` — minimal starting DBs with example structure for fork users
- `compost export <bundle>` / `compost import <bundle>` — markdown + sqlite dump for machine migration
- Conflict resolution doc (last-writer-wins default)
- **Removed from scope**: cross-machine live sync, multi-host coordination, HTTP transport

### Phase 9 — Ecosystem (descoped from former Phase 6)

- `compost-adapter-openclaw` (if concrete need emerges)
- Multimodal metadata (attachment field, no content parsing)
- Prometheus / OpenTelemetry metrics export (for self-observability)
- **Removed from scope**: PDF/video full-text extraction, code repo mirroring

### No-longer-removed items (reactivated from old Phase 4 P2 deletion list)

- ~~~~Curiosity agent~~~~ → **Phase 6 P0**
- ~~~~Gap tracker~~~~ → **Phase 6 P0** (merged with `open_problems`)
- ~~~~Autonomous crawl~~~~ → **Phase 6 P0** as user-approved queue (not fully autonomous)
- Semantic chunking / Savitzky-Golay — still deferred (heading-based adequate for now)
- Audit log TTL — still deferred (YAGNI for personal scale)

### What we are *not* doing

- ❌ Team collaboration / multi-user features
- ❌ SaaS / cloud service
- ❌ Central instance / shared data pool
- ❌ Accepting pull requests to this repo (fork instead — see CONTRIBUTING.md)
- ❌ PDF / video full-text extraction
- ❌ Code repo mirroring (git already stores code)
- ❌ Community-facing features / marketing / tutorials aimed at mass adoption
