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
- Day 3: `scanStaleFact` + `scanUnresolvedContradiction` (same subject+predicate, distinct active objects, restricted to explicit single-valued predicates so unknown / multi-valued extraction predicates like `describes` / `has_architecture` do not flood triage) + `scanOrphanDelta` (zero fact_links edges + no access within window); `correction_candidate` written directly by `correction-detector` drain hook, `triage()` aggregates only; `compost triage scan/list/resolve` CLI mirroring `audit` CLI enum-validation pattern
- Day 4: `startReflectScheduler` test-injectable `intervalMs` + 3 integration tests (happy / LLM fail → stale_at / no-llm skip); `compost doctor --check-llm` now separates Ollama `/api/tags` service liveness from bounded generation, treating quick generation timeout as a warning by default and as fatal with `--strict-llm`
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
| Compost/Engram boundary guard | 5 / v4 | **Done** -- monorepo migration is deferred while both projects evolve; `docs/compost-engram-boundary.md`, `bun run check:engram-boundary`, and the boundary CI workflow preserve strict sibling-repo/runtime independence. |
| Autonomous exploration | 6 | Curiosity agent + Gap tracker + proactive push (L4 self-evolution) |
| Analytical partner trial | 7 | Historical / frozen in v4: cross-fact reasoning, verdict signal, and hybrid scheduler shipped as trial path; current next work is deterministic pattern detection over `action_log`, not new background reasoning chains |
| Quality regression gate | 6/7 prep | **Done** -- `bench/quality.bench.ts` LLM-as-judge over 3 hand-labeled fixtures (coverage / hallucinations / faithfulness); network-gated, no opik dependency, runs against any local Ollama model. Establishes the synthesis-quality baseline before L4 / L5 features ship. Initial baseline captured 2026-05-01 to `bench/baseline-quality.json` (3 sequential runs × 3 fixtures, judge `gemma4:31b`, git_sha `98fcb32`); carries `saturation_flag.triggered=true` because all 9 judgments returned `coverage=100 / faithfulness=1.0 / hallucinations=0` with `stddev=0` while `wiki_chars` varied (688-754 / 498-515). Treated as regression floor with loose thresholds (`coverage_pct_min: 90`, `faithfulness_min: 0.85`, `hallucinations_max: 2`); tightening blocked on fixture hardening (8-10 fixtures, harder seeds, or non-gemma4 judge to break self-bias). |
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

### Integration posture toward external observability platforms (added 2026-04-30)

External evaluation/observability stacks — Comet opik in particular — are **not** to be installed as dependencies even when their feature set overlaps the L5/L6 evaluation surface. Reasons (pinned Engram decision `b73625577d5c`): (1) opik is enterprise SaaS-style with Postgres + ClickHouse + Web UI, fundamentally heavier than Compost's local-first SQLite + LanceDB; (2) Compost's MIT fork-template distribution would force every fork to host opik, breaking the "git clone and grow your own" anchor; (3) HC-1 independence forbids hard third-party deps; (4) Compost already implements decision_audit + correction_events + triage + arbitration + health_signals, which cover most opik concepts locally. Permitted use: **steal design concepts** into local SQLite-native form (e.g., the LLM-as-judge pattern in `bench/quality.bench.ts`).

### Strategic Direction v4 (2026-05-02 metacognitive turn)

Following user-driven product calibration on 2026-05-01/02, Compost's identity reframes from "personal AI brain that synthesizes knowledge" to "cross-system action ledger + metacognitive index + behavior pattern engine (primary) + on-demand wisdom retrieval (auxiliary)" over the existing Engram + Obsidian + git + claude-mem stack. v3 strategic positioning above remains accurate at the product-identity level (single-user, MIT fork-template, 10+ year horizon); v4 sharpens the layer-of-stack identity.

Compost does NOT:
- Generate or own persistent knowledge (that is Obsidian's role per vault)
- Store atomic memories or constraints (that is Engram's role)
- Run background wisdom production schedulers that persist synthesized fact

Compost DOES (primary, metacognitive):
- Capture every meaningful agent/user action across tools (Claude Code, Codex, zsh, git, Obsidian file edits) into a unified time-series ledger
- Maintain `artifact_locations`: for any topic, which system holds the canonical record (Engram memory_id / Obsidian path / git commit / claude-mem session / ROADMAP section / handoff doc)
- Surface coverage gaps: "you did X, recorded in Engram=✓ ROADMAP=✓ Obsidian=✗"
- Detect behavior patterns over time (sequential mining, NOT LLM): work rhythms, decision habits, language style evolution
- Route queries: "this question's answer lives in <Obsidian vault X> not in me"

Compost DOES (auxiliary, on-demand wisdom):
- (a) `compost ask <question>`: user-triggered LLM synthesis over the metacognitive ledger; answer returned ephemerally, NOT persisted as fact. This preserves the "user wants synthesis when asking, not when not asking" principle. Already implemented; preserved through v4 turn.

Wisdom roadmap (sequential, NOT parallel):
- Phase 1 (now): (a) on-demand `compost ask` retained. Background production frozen.
- Phase 2-3 (1-3 months): action_log schema (0021 landed) + capture expansion (zsh / git / Obsidian) + `compost cover <topic>` coverage audit + `compost route <question>` artifact routing + `compost did <date>` action timeline aggregation + `compost reconcile <date>` missing-pointer audit. Richer ledger for (a) to draw from.
- Phase 4 (3-6 months): deterministic `compost patterns <date|window>` action_log report is live as the first manual read-only pattern MVP; (b) scheduled batch wisdom remains later — weekly/monthly LLM scan produces "this week your habits / cross-tool pattern" report. Batch output is a digest read by user, NOT persisted as fact in metacognitive ledger.
- Phase 5 (6-12 months): (c) real-time contextual wisdom surfacing — when user does X, system proactively notes "this is similar to Y you did 3 weeks ago, that resulted in Z". Requires push UX design + trigger discipline.

Wisdom-layer features built in Phases 5-7 (`reasoning_chain` table, `synthesizeWiki`, verdict CLI, `quality.bench.ts`, dogfood-7d routine, debate 026 reasoning scheduler, debate 024 verdict calibration) are **frozen as historical trial path** — schemas retained, code retained, but no further investment. Do not delete; the trial itself is data about what direction works for this user. Background production is what's frozen — `compost ask` (the on-demand path) is preserved. See `docs/metacognitive-direction.md` for the full sunset/freeze list with file:line references and the rationale of each freeze.

Success signals for v4 (review at intervals):
- 30 days: `action_log` schema migrated; cross-repo audit clean OR documented; daemon plist restored; outbox quarantine = 0 sustained 14 days; periodic dual-health check covers Compost doctor output plus Engram process hygiene
- 90 days: zsh + git + Obsidian capture remain live; `compost cover <topic>` coverage audit works for 3+ test queries; pattern detection emits first behavior digest
- 180 days: `compost did "this week"` and `compost did "this month"` can answer cross-system retrospectives from `action_log`; user reports "I no longer hand-track my work in Obsidian for retrospect purposes"; zero pivot-back urge

Implementation baseline after this turn: `fda433d` lands the `action_log` schema foundation; `c00db8d` restores root typecheck and the full test suite while preserving the v4 freeze defaults; `d406830` adds the action processor that lifts drained observations into `action_log` for the metacognitive timeline. The D2-3 capture work adds `compost capture zsh` with a local `preexec_functions`/`precmd_functions` hook, `compost capture git` with a global `post-commit` hook, `compost capture obsidian` with a local vault watcher, PII scrubbing before outbox write, and zsh/git/Obsidian normalization in `action_log`. D2-4 adds `compost cover <topic>`, a deterministic action_log/doc/artifact coverage audit that reports present systems and missing pointers without reviving background reasoning/wiki/verdict routines. D2-5 adds `compost route <question>`, a deterministic artifact router that points questions to Obsidian, Engram, git, repo docs, Codex transcripts, local files, or action_log timeline windows. D2-6 adds `compost did <date|this week>`, a deterministic action timeline aggregator that groups `action_log` rows by day, source system, project, and artifact pointers for retrospectives. D2-7 adds `compost reconcile <date|this week>` plus a daily 05:00 UTC `action-reconcile` daemon scheduler, a read-only missing-pointer audit over `action_log` that reports missing Engram, Obsidian, git, or durable artifact pointers without mutating the ledger. The first Phase 4 MVP adds `compost patterns <date|window>`, a manual read-only deterministic action_log report for capture spread, work-rhythm hours, dominant projects, project switching, and adjacent source transitions; it does not write `user_patterns`, reasoning chains, wiki pages, or Engram memories. The 2026-05-05 boundary guard adds a static Compost/Engram drift check and CI workflow while deferring any monorepo migration; see `docs/compost-engram-boundary.md`.

2026-05-05 dual-health maintenance baseline: Compost ledger backup +
Engram backup were taken before maintenance; existing semantic
`transform_policy` labels were normalized to registered policy ids, existing
outbox PII was scrubbed, one completed queue row without a derivation was
reopened and processed, Compost daemon was restarted cleanly, and stale Engram
stdio processes were reaped down to the active clients. A core outbox fallback
now rewrites unregistered `transform_policy` labels to the active registered
policy while preserving the requested label in payload metadata. This remains
an ops runbook signal, not a monorepo trigger.

Engram pinned decisions sealing this turn (written 2026-05-02): `88c0de87fea8` (v4 metacognitive turn lock), `a8a292013323` (anti-drift verification procedure), `df525f281ec4` (supersede note for v3 identity 72df4feab550), `23531c7c850b` (post-commit fix baseline). Plan-of-record source: maintainer's local plan file (kept outside this repo). Long-form rationale: `docs/metacognitive-direction.md`.

### Self-evolution levels

Compost's autonomy ladder. v4 keeps the historical L5 reasoning work as frozen trial data and moves current investment to the metacognitive L4/L5 boundary: richer `action_log`, deterministic pattern detection, and user-read digests.

| Level | Capability | Status |
|-------|-----------|--------|
| L1 | Passive ingestion (observe → structure) | ✅ Phase 0-1 |
| L2 | Periodic self-organization (reflect, decay, wiki synth) | ✅ Phase 2-3 |
| L3 | Self-correction (contradiction arbitration, wiki versioning) | ✅ Phase 3 |
| L4 | **Autonomous exploration** (curiosity, gap tracking, user-approved crawl) | 🔨 Phase 6 |
| L5 | **Pattern insight** (sequential mining over action_log; optional user-read batch digest later) | Next after D2-7; reasoning_chain scheduler remains frozen |
| L6 | **Proactive contextual surfacing** (knows me, tells me) | Future; requires trigger discipline and push UX |

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
- ✅ **Tech-debt sweep** (2026-04-17, post-Phase 6 P0 slice 3)
  - **T2 Daemon Engram wiring**: `startDaemon()` now accepts
    `DaemonEngramOpts` and auto-wires `startEngramFlusher` +
    `startEngramPoller` when opted in. Default OFF for HC-1 safety
    (tests/library callers never spawn subprocesses); CLI binary entry
    (`compost daemon start` + `compost-daemon` main) passes
    `{disabled: false}` so production wire-up is automatic. Per-scheduler
    opt-in: injecting just `flusherMcpClient` or `pollerStreamClient`
    enables only that side without triggering the other subprocess.
    Env-driven config: `COMPOST_ENGRAM_SERVER_CMD`,
    `COMPOST_ENGRAM_SERVER_ARGS`, `COMPOST_ENGRAM_BIN`,
    `COMPOST_ENGRAM_FLUSH_INTERVAL_MS`, `COMPOST_ENGRAM_POLL_INTERVAL_MS`.
    Closes a real gap: Phase 5's "runtime-live" bidirectional loop
    previously required manual `compost engram-push` / `engram-pull`
    invocations to actually sync.
    Tests: +6 in `daemon-engram-wiring.test.ts` covering default-off,
    injected-client opt-in, per-scheduler isolation, HC-1 degrade on
    missing binaries, caller-owned client not closed on shutdown.
  - **T1 `compost doctor --reconcile-engram`**: deferral condition
    ("one live dogfood cycle validates the new loop") satisfied by
    slice 2 Round B + slice 3. New `packages/compost-engram-adapter/src/reconcile.ts`
    `reconcileEngramQueue(queue, opts)` — pure local scan surfacing:
    pair_fragments (R5 blind-write: invalidate committed but remember
    still pending), stuck_rows (pending beyond threshold), and
    expired_but_not_pruned. `PendingWritesQueue.listAll()` added.
    CLI: `compost doctor --reconcile-engram [--queue-path] [--stuck-threshold-days N]`,
    exits 1 on any signal. Live dogfood: clean report on current
    ~/.compost/pending-engram-writes.db. Tests: +9 covering all
    categories + the asymmetric-coverage edge case.
  - **T3 `--engram-server-args` pass-through**: `compost engram-push`
    and `compost digest --push` accept
    `--engram-server-cmd uv --engram-server-args "--directory /path/to/Engram run engram-server"`.
    Live-proven: multi-token `uv` invocation pushed 2 chunks to Engram
    without the previously-needed `/tmp/engram-wrap.sh` bash wrapper.

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
- ✅ **P0 slice 3** (2026-04-17) — **Wiki provenance via `decision_audit` JOIN**
  - `selectWikiRebuilds` now LEFT-JOINs the latest `decision_audit` row per
    page (`kind='wiki_rebuild'`, `ORDER BY decided_at DESC, id DESC LIMIT 1`
    correlated subquery) and parses `evidence_refs_json.input_fact_ids` into
    `DigestItem.refs.contributing_fact_ids`. Malformed JSON degrades
    gracefully — the wiki rebuild still lists, we just lose provenance.
  - `digestInsightInput()` merges wiki contributing_fact_ids into the fact_id
    Set alongside `new_facts` and `resolved_gaps` refs. Wiki-only digests
    now push successfully without relaxing the confidence floor. Live
    dogfood at `--confidence-floor 0.85` (previously null) returns 11
    contributing fact_ids pulled from audit provenance.
  - Zero schema change — `wiki.ts:190` has persisted `input_fact_ids` since
    debate 008 §Q5; slice 3 is pure query.
  - Tests: 525 → 532 (+7): wiki+audit happy path; no-audit edge yields
    undefined refs; latest-wins across multiple audit rows; cross-page
    isolation; wiki-only digest → non-null insight input; wiki-only
    without audit stays null; cross-category fact_id merge + sort.
- ✅ **Curiosity agent MVP** (2026-04-17) — **Gap clustering via token-Jaccard**
  - `packages/compost-core/src/cognitive/curiosity.ts` — deterministic, zero-LLM:
    tokenize (lowercase, drop stopwords + ≤2 char tokens, dedup), Jaccard overlap,
    greedy clustering where each gap joins the first cluster whose anchor
    overlaps ≥ minJaccard (default 0.3).
  - `detectCuriosityClusters(db, opts)` returns `{clusters, unclustered, window_days}`.
    Clusters carry `representative` (highest ask_count member, tiebreak on
    last_asked_at), `total_asks` sum, and `shared_tokens` intersection across
    members. Singletons drop to `unclustered` so hotspot list stays clean.
  - `compost curiosity` CLI: `--window-days`, `--min-jaccard`, `--max-clusters`,
    `--status` (open|resolved|dismissed), `--json`. Human-readable default.
  - Tests: 547 → 565 (+18): tokenizer (stopwords, short-token filter, dedup),
    Jaccard (identical/disjoint/partial/empty), cluster algorithm (empty db,
    singleton → unclustered, overlap threshold, representative selection,
    status filter, maxClusters cap, total_asks-desc sort).
  - Stretch items deferred: fact→gap matching ("new facts may answer this
    cluster"), MCP tool surface, auto-trigger on `compost.ask` misses.
  - ✅ **Stretch: fact→gap matching + MCP surface** (2026-04-18) — active
    L4 suggestion layer. `matchFactsToGaps(db, opts)` reuses the curiosity
    tokenizer + Jaccard pattern: for each open gap, scan recent confident
    facts (within `sinceDays`, confidence ≥ `confidenceFloor`, not
    archived/superseded), score token overlap on `subject + predicate +
    object`, return top `maxCandidatesPerGap` per gap. `compost curiosity`
    restructured as a group with default subcommand `clusters` (existing
    behavior, non-breaking) + new subcommand `matches`. MCP exposes
    `compost.curiosity.match_facts`. Regression test updated to 16-tool
    surface. Tests 595 → 606 (+11).
  - Still deferred: auto-trigger on `compost.ask` misses (needs ask()
    response-shape design; defer to Phase 7 analytical partner session).
- ✅ **User-approved crawl queue (queue-management slice)** (2026-04-17)
  - Migration 0017: `crawl_queue` table (crawl_id, url, url_hash UNIQUE,
    status ∈ {proposed, approved, rejected}, proposed_by, rationale,
    tags JSON, proposed_at, decided_at).
  - `packages/compost-core/src/cognitive/crawl-queue.ts` —
    `normalizeUrl` (lowercase scheme/host, strip fragment, strip
    trailing slash on path-less URLs) + `urlHash` (sha256 of
    normalized) + state machine: proposed → approved | rejected,
    both terminal. Re-propose of rejected URL does NOT resurrect —
    user must `forget` first to break any auto-proposer loops.
    `forgetCrawl` hard-deletes regardless of status.
  - `compost crawl propose|list|approve|reject|forget|stats` CLI.
  - **Deliberately no fetch path this slice.** The "never
    auto-sends requests" first-party principle is enforced by code
    absence, not runtime discipline. A future slice adds
    `compost crawl fetch` as an explicit user-initiated verb after
    product-level design on where fetched content lands (raw
    observation? ingest queue? review store?), robots.txt policy,
    size caps, content-type handling.
  - Tests: 565 → 588 (+23): normalizeUrl + urlHash (case equivalence,
    trailing slash, fragment), propose (defaults, rationale/tags,
    re-propose no-resurrect), list (default view, status filter,
    proposedBy filter, limit), state machine transitions (approve
    only from proposed, reject only from proposed, forget idempotent),
    stats counting, getByUrl hash lookup. Migrator test updated
    17-count.
- ✅ **MCP tool surface for Phase 6 P0** (2026-04-18) — **agent-reachable L4**
  - Wrapped gaps / curiosity / digest / crawl modules as MCP tools in
    `packages/compost-daemon/src/mcp-server.ts`. Pre-existing 4 tools
    (observe/query/reflect/ask) grow to 15: `compost.gaps.list/resolve/
    dismiss/stats`, `compost.curiosity`, `compost.digest`,
    `compost.crawl.propose/list/approve/reject/stats`. Thin wrappers
    over already-tested pure modules; no new product logic.
  - **Deliberately NOT exposed via MCP** (human-gate rationale):
    - `gap.forget` / `crawl.forget` — hard-delete, CLI-only for safety
    - `digest --push` — sibling-system (Engram) mutation, CLI-only so
      push requires explicit human action not agent-initiated during
      a conversation
    - `crawl fetch` — doesn't exist anywhere yet; crawl queue remains
      management-only (first-party principle enforced by code absence)
  - **Latent bug fixed**: `zod` was missing from
    `packages/compost-daemon/package.json` dependencies. MCP stdio
    server has silently failed to start at daemon boot since it was
    added ("MCP server failed to start (SDK may not be installed)"
    log at main.ts:108). Covered by a withMcp=false default in
    daemon.test.ts that never exercised the MCP path. Added
    `zod: ^3.25.0` to daemon deps; isolated startMcpServer smoke
    now shows all 15 tools register.
  - Suite unchanged at 594 (MCP tools are thin wrappers; underlying
    modules already covered by 86 dedicated tests across gap-tracker,
    digest, curiosity, crawl-queue, reconcile).
- ✅ **Phase 7 pre-work — L4 signal sourcing** (commit `cc6e54b`, 2026-04-18,
  debate 023) — `logGap` sunk from MCP transport into `ask()` core so every
  caller (CLI, MCP, future HTTP) produces L4 signal. Provenance-gated:
  only LLM-synthesized answers below threshold or no-evidence cases count
  as gaps; BM25 fallback is a degraded-service event, not a brain admission.
  New `compost ask` CLI subcommand. Tests 594 → 612 (+18).
- ✅ **`compost mcp` standalone subcommand** (commit `4c5c751`, 2026-04-18) —
  closes the configuration-layer half of the L4 signal sourcing problem:
  the daemon's embedded MCP server has no stdin client and is unreachable;
  Claude Code needs a subprocess it can spawn and pipe to. Mirrors Engram
  pattern in `~/.claude/CLAUDE.md`. Same ledger.db (SQLite WAL allows
  concurrent reader). Does NOT start reflect/drain/ingest schedulers
  (those stay on the long-running daemon). As of 2026-05-08,
  `compost daemon start` defaults to scheduler-only so launchd/nohup daemon
  starts survive stdio closure; `--with-mcp` remains for foreground debugging.
  Daemon startup now probes the control socket and PID file before binding so a
  second start cannot unlink a live daemon's socket; only confirmed stale
  socket/PID files are removed.
- ✅ **CJK tokenizer fix** (commit `068c414`, 2026-04-23, dogfood-found) —
  `tokenizeQuestion` (`packages/compost-core/src/cognitive/curiosity.ts`)
  used `split(/\s+/)` only; CJK has no inter-word whitespace, so a whole
  Chinese phrase between punctuation collapsed to one giant token and
  Jaccard was always 0 for monolingual CJK input. Fix: char bigrams over
  CJK runs, ASCII whitespace path preserved. Tests 612 → 619 (+7 incl.
  one regression guard). Found while running debate 023 §Next Steps
  dogfood: 5 CJK + 2 EN gap pushes — EN cluster surfaced on "saturn",
  CJK pair on "土星" stayed unclustered.
- ✅ **debate 024 — Compost insight 写入去重 (Engram-side hard idempotency)**
  (Compost commit `80c603c` + Engram commit `cc5ccb4`, 2026-04-23) —
  dogfood found 4 origin=compost rows where 2 should be (same digest
  pushed twice). 4/4 advisor consensus on (a) Engram-side `partial UNIQUE
  INDEX on (origin, root_insight_id, chunk_index) WHERE origin='compost'`
  + return-existing-id PUT semantics. Engram migration 003 ships:
  DELETE historical dupes → CREATE UNIQUE INDEX → `_find_compost_duplicate`
  in `store.py.remember()` before INSERT. Compost adds 2 idempotency
  contract regression tests (`writer.test.ts`) + new "Idempotency
  contract" §in `docs/engram-integration-contract.md`. Tests Compost 619
  → 621 (+2), Engram 234 → 242 (+8). Live ledger cleaned up: 4 → 2 rows
  for `root_insight_id=2ffbf27d-…`. End-to-end MCP dogfood verified
  return-existing-id works after restart.

### Phase 7 — Analytical partner (L5)

- ✅ **Entry slice — `compost reason`** (2026-04-24, debate 025 synthesis (c)+α+B+q+X)
  - Migration 0018: `reasoning_chains` table (chain_id UUIDv5 over
    seed_kind+seed_id+policy_version+sorted candidates; deterministic
    so re-running with identical inputs returns the cached row, debate
    024 idempotency lesson at L5 layer).
  - `packages/compost-core/src/cognitive/reasoning.ts` —
    `runReasoning(db, seed, llm, opts, vectorStore)` orchestrates:
    (1) seed resolution to query text + optional graph anchor fact_id
    (2) parallel hybrid retrieval — `query()` lane (FTS5 + ANN + Phase 2
    rerank) and `traverse()` lane over `fact_links` excluding
    `contradicts` kind (3) RRF merge via the new shared
    `packages/compost-core/src/query/rrf.ts` (extracted from
    `search.ts` so reasoning + Phase 2 query share one impl)
    (4) drop the seed itself from the candidate set
    (5) `gapThreshold: null` LLM synthesis via dedicated
    `BreakerRegistry("l5.reason")` site (debate 023 Q4 contract)
    (6) persist row to `reasoning_chains`
    (7) **mandatory `derived_from` write-back** — every successful
    chain calls `addLink(seedFact, candidate, "derived_from")` so
    sparse-graph (b)-like behavior bootstraps into dense-graph
    (a)-like behavior over time (the Opus addition that won the Q1
    tiebreak: graceful degradation + closed-loop densification).
  - `compost reason run|list|show` CLI (`packages/compost-cli/src/commands/reason.ts`).
  - MCP tool surface +2: `compost.reason` (default exposed — produces
    persistent rows agents can reference) and `compost.reason.list`
    (read-only; lets agent check existing chains before triggering new
    LLM spend).
  - Tests: 621 → 642 (+21 in `reasoning.test.ts`: `computeChainId`
    determinism + collision behavior, idempotency reuse path,
    write-back side-effect correctness, no-link-writeback opt-out,
    LLM failure path with `failure_reason` populated, garbage-output
    parse failure, sparse-graph graceful degradation, dense-graph
    contribution proof, `persistDerivedLinks` self-loop guard, read
    helpers). Migrator test +1 (count 17→18).
  - Concedes (debate 025 §Opus 撤回): context.md misnamed `fact_links`
    kinds (`superseded` doesn't exist — it's a `facts.superseded_by`
    column not a graph edge); schema path is `src/schema/`, not
    `src/schema/migrations/`.
- ✅ **Verdict CLI/MCP + prompt calibration** (2026-04-26, S662 decision) —
  ground-truth feedback channel orthogonal to chain `status`. Migration 0019
  adds `user_verdict` (`confirmed` | `refined` | `rejected` | NULL) +
  `verdict_at` + `verdict_note` + partial index on judged rows.
  `setVerdict` / `getVerdictStats` in `cognitive/reasoning.ts`; CLI
  `compost reason verdict <chain_id> <kind> [--note]` + `compost reason
  stats`; MCP tools `compost.reason.verdict` (write) +
  `compost.reason.stats` (read). CHAIN_PROMPT calibrated with 4-tier
  confidence anchors + 3-shot examples (high/medium/low) — debate 024
  established LLM self-evaluation is unreliable, so calibration shapes
  distribution rather than denoising it; the *real* signal channel is
  user verdict (labeled data for retrieval β/γ tuning + debate 026 entry).
  Tests: 645 → 660 (+15: round-trip, idempotency-survives-verdict, status
  orthogonality, CHECK constraint, empty-ledger zeros, calibration mean
  computation, migrator count 18→19). Verdict='rejected' is finer-grained
  than status='user_rejected': chain stays visible in
  `listRecentChains` so it can be referenced as labeled negative data.
- ✅ **e2e Engram integration test** (commit `9e49e5d`, 2026-04-25) —
  closes the mock-vs-mock gap noted at debate 024 ship: `writer.test.ts`
  uses `FakeMcpClient` (mocks Engram) and Engram's
  `tests/test_compost_insight_dedup.py` calls `MemoryStore.remember`
  directly (mocks the wire). New
  `packages/compost-engram-adapter/test/engram-e2e-integration.test.ts`
  spawns a real `engram-server` subprocess against an isolated temp
  SQLite DB (env `ENGRAM_DB`), routes writes through real
  `StdioEngramMcpClient` + `EngramWriter`, asserts debate 024
  idempotency contract round-trips through MCP stdio JSON-RPC +
  `_find_compost_duplicate` + the `idx_compost_insight_idempotency`
  partial UNIQUE INDEX. Auto-skips when `engram-server` binary missing
  (CI / fork friendly). Tests: 642 → 645 (+3); ~360ms total runtime.
- Deferred to follow-up slices (Phase 7 sub-tasks, not blocking):
  - **Pattern detection (β)** — populator over `user_patterns` schema
    (migration 0015 ready since debate 020).
  - **Hypothesis generation (γ)** — needs new `kind` column on facts or
    a new table; out-of-slice schema work.
  - **Reflection prompts (δ)** — LLM-cost model + UX design first.
  - **User model update loop (ε)** — L6 layer; depends on β.
  - ✅ **Daemon long-run infrastructure** (2026-04-27 — dogfound 65h silent
    outage 4-24~4-27 because daemon was not supervised + status only
    returned `{pid, uptime}` so MCP read-path masked the failure).
    5 commits to main:
    - `d726e22` ops: first launchd supervision landed as a local instance;
      the public tree now keeps only `scripts/com.example.compost-daemon.plist`
      so forks do not inherit personal absolute paths.
    - `ce80ac1` fix: `recoverStaleRuns(db, opts?)` cleans status='running'
      derivation_run rows older than 1h on startup (idx_derivation_run_active
      collision class) — wired into startDaemon + 5 unit tests.
    - `396fb94` feat: `Scheduler.getHealth(): {name, last_tick_at, error_count, running}`
      across all 7 startXxx factories + control-socket aggregation; CLI prints
      tabular per-scheduler status; 10 new tests.
    - `f4f4c76` feat: wire `startBackupScheduler` (03:00 UTC daily) +
      `startGraphHealthScheduler` (04:00 UTC daily) into main.ts (previously
      exported but never called); ARCHITECTURE.md scheduler hook table updated.
    - `0f5d1c7` ops: one-shot local dogfood routine for debate 027 entry
      conditions (chain≥30 / verdict-similarity stable / user feedback).
      The public repo no longer tracks the personal launchd instance or
      prompt file.
    - `872623b` docs: QUICKSTART step 5/6 rewritten for launchd workflow
      and the daily verdict-labelling routine (cchains/cstats zsh helpers).
    - `9d270b2` feat: `compost reason verdict <prefix>` accepts a unique
      chain_id prefix (>=4 chars) via `resolveChainIdPrefix(db, input)`,
      git-checkout style "ambiguous" / "no match" / "too short" errors;
      102/102 tests including 5 new (full UUID / unique / ambiguous /
      no-match / too-short). Codex CLI handoff failed (monthly quota +
      `codex exec` 0B output across 5 min); local fallback per CLAUDE.md
      role architecture, surgical scope (one helper + wire-in + test).
    
    Dogfood preparation (2026-04-27 EOD): bulk-ingested 36 source-of-truth
    docs across 5 projects (Athena 14 selected + Engram/QuotaFlow/Onyx 6
    each + ModelSelector 4) yielding +635 facts (656 → 1291 active).
    Six pre-calibration `l5-v1` reasoning chain seeds were `archive_reason='manual'`
    soft-tombstoned to keep retrieval focused on `l5-v1-calibrated` policy
    going forward. Engram `9734e9dc61d5` (dogfood daily protocol) +
    `cbe509a7f84a` (post-session handover) capture the routine for
    next-session resumption.
    
    Engram guardrail `76d8e4206e18` (global, pinned) codifies the three-layer
    daemon health contract (process layer + observability layer + business
    interface layer) so this class of failure is documented for any future
    long-running daemon project.
  - ~~**`(r)` hybrid scheduler**~~ → ✅ shipped (debate 026, 2026-04-26).
    Migration 0020 `reasoning_scheduler_state` (single-row table, CHECK id=1).
    `cognitive/reason-scheduler.ts` exposes `runCycle` / `selectSeeds` / 
    `canTriggerCycle` / `getRecentVerdictStats` (the recent-window helper
    Codex flagged as missing; existing `getVerdictStats` is global aggregate).
    `startReasoningScheduler` runs an INDEPENDENT 6h timer (Codex argument:
    coupling to reflect risks reflect failure stalling reasoning per the
    swallow-and-continue pattern at `scheduler.ts:104-153`). Gate is
    three-layer: below-entry skip (chains<10) → hard pause (manual or after
    K=4 consecutive soft skips, auto-resume at 7d to avoid product death)
    → soft per-cycle skip (recent rejected_rate ≥50% with bootstrap floor
    of 5 judged). Seed source is recently-active subjects (last 7d) with
    `adapter != 'engram'` surge guard (Codex+Sonnet — engram-pull bulk
    imports are canonical KB content not "user activity"). MCP exposes
    `compost.reason.scheduler.status` read-only only (Q5 (II) trust-boundary:
    agent observes, user steers; pause/resume require operator intent).
    Tests: 660 → 677 (+17 in `reason-scheduler.test.ts`: state R/W,
    pause/resume, recent verdict stats, surge guard, 7d window cutoff,
    budget cap, three gate layers, 7d auto-resume, hard-transition,
    happy-path counter reset). debate 026 4-way vote: Q1(c) 2/4 + Codex
    ledger evidence demolished Q1(a), Q2(p) 3/4, Q3(iv) 2/4 + Opus 7d
    auto-resume modifier, Q4(A) 4/4 unanimous, Q5(II) 3/4. Out of scope
    deferred to debate 027/028/029: (b) verdict-similarity seed source,
    (d) multi-source weighted, (r) adaptive cadence, β pattern detection,
    γ hypothesis generation.
  - **`--push-engram` flag** — schema column `engram_insight_id`
    reserved; wiring deferred until L5 outputs prove cross-project
    value.
  - **Engram `forget` → Compost `archive` reverse-sync** — when a user
    forgets an Engram memory, the corresponding Compost facts derived from
    that memory should auto-archive instead of decaying naturally over the
    30d half-life. Two-step design (sketched 2026-04-27):
    - Engram side: new `stream_forgotten_for_compost(cursor)` MCP tool
      mirroring `stream_for_compost`'s cursor-based shape but emitting
      `forget` events.
    - Compost side: second poll loop in `engram-poller`, reverse-lookup
      `facts WHERE observations.source_id IN (forgotten_mem_ids)`, soft-
      archive with new `archive_reason='engram_forgotten'` enum value
      (migration 0021).
    - Estimated ~2-3h total across both repos. Deferred until post-debate-
      027 to avoid touching the engram-pull data path during dogfood (any
      bug here would taint chain growth measurement). Backlog memory:
      Engram pinned procedure (TBD id at write time).
  - ~~**`compost add` race condition error reporting**~~ → ✅ shipped
    (codex task `ae965761822471e15`, 2026-04-29). When concurrent
    drainer (compost-daemon `startDrainLoop` 1s poll, or external worker
    e.g. `athena`) wins the outbox row, the synchronous `add` path's
    `drainOne()` used to return null and report `{"ok":false,"error":
    "drain returned null"}` even though facts were already generated
    by the concurrent drainer. Fix in
    `packages/compost-core/src/pipeline/ingest.ts`: new
    `getConcurrentDrainFacts` helper queries
    `observe_outbox` (by adapter+source_id+idempotency_key) →
    `observations` → `facts WHERE archived_at IS NULL` →
    `derivation_run` (latest by finished_at/started_at) when
    `drainOne` returns null. If facts present: return
    `{ok:true, already_drained_by_concurrent_worker:true, facts_count, ...}`.
    If absent: upgrade error to `"drain returned null and no facts
    found — investigate concurrent drainer or schema corruption"`.
    2 new tests in
    `packages/compost-core/test/ingest-concurrent-drain.test.ts` cover
    both branches. Live retry of `compost add SocratiCode.md` (the
    2026-04-29 batch ingest false-fail, observe_id `019ddbab-2830-...`)
    returns `ok:true, facts_count:4`. Test suite 699/699 green. Engram
    insight `4134cadd0e9d` traces the pre-fix diagnosis.
  - **`compost add` queue residual when concurrent drain wins** — sibling
    bug to the race condition above, surfaced 2026-05-01 during dogfood
    health check. Symptom: `~/.compost/daemon.log` spamming
    `UNIQUE constraint failed: index 'idx_derivation_run_active'` once
    per ~30s. Root cause: when `getConcurrentDrainFacts` returns
    `ok:true` (concurrent drainer wrote facts), the synchronous `add`
    path does not mark `ingest_queue.completed_at`. Daemon worker keeps
    re-claiming the row, attempts `INSERT INTO derivation_run` for an
    `(observe_id, layer, transform_policy, model_id, ...)` tuple that
    already has a `succeeded` row, collides on the partial UNIQUE index
    (predicate `WHERE status IN ('pending','running','succeeded')`).
    Mitigation done 2026-05-01: manual reconcile of 3 stuck queue rows
    via `UPDATE ingest_queue SET completed_at = datetime('now')
    WHERE id IN (...) AND EXISTS (succeeded derivation_run)`; daemon
    log immediately quiets. Fix path: in `packages/compost-core/src/
    pipeline/ingest.ts` `add()` path, when `getConcurrentDrainFacts`
    branch returns ok, also update `ingest_queue.completed_at = now()`
    inside the same transaction. ~30 LoC + 1 test (concurrent-drain
    queue-close branch). Defer to post-dogfood for the same reason as
    other ingest-path edits: touching `ingest.ts` mid-dogfood would
    perturb chain-growth measurement. Diagnostic Engram memory TBD at
    write time.
  - **Ranking diversity constraint for `compost ask` / `compost query`**
    — current top-K ranking is dominated by `w1_semantic` (~0.96) with
    `w2_temporal` (~0.15), so a single high-recency source can saturate
    the LLM context window and crowd out the rest of the ledger.
    Verified 2026-04-29: querying "我有哪些 AI agent 相关的 GitHub
    repo" after ingesting 463 GitWiki repo notes only returned the
    single Engram-derived fact, none of the 463 GitWiki facts. Fix
    direction: after top-K retrieval, deduplicate by `source_uri`
    and/or `fact.subject` so each source contributes at most N hits;
    emit a per-source-cluster summary into the LLM synthesis prompt.
    Sketch lives in `packages/compost-core/src/pipeline/ranking.ts`
    (rank assembly) and the `ask` command's hit-to-prompt builder.
    Defer to post-dogfood (5/4+) — touches the `ask` retrieval path
    that user verdict signals depend on; tweaking mid-dogfood would
    contaminate calibration data.
  - **Inventory-class question path** ("我有哪些 X" 类问题) — current
    `ask` runs single-fact retrieval and lets the LLM stitch a list,
    which truncates aggressively under top-K. Better path: detect
    inventory intent at `ask` entry, run `wiki_pages` or grouped
    `subject` aggregation against the candidate corpus, hand the LLM
    a pre-grouped list with explicit "enumerate everything, do not
    drop entries" instruction. Same defer rationale as ranking
    diversity (post-dogfood, ask path).
  - **Obsidian vault → Compost incremental sync scheduler** — current
    workflow is manual (`comm -23 <all_md> <already_ingested>` then
    `compost add` per file). 2026-04-29 batch verified the path works
    (463 files, ~5min on local ollama). Productize as a daemon
    scheduler in `packages/compost-daemon/src/scheduler.ts` (alongside
    drain/reflect/reasoning loops): hourly walk of configured vault
    roots, diff against ledger, ingest delta, log to
    `~/.compost/vault-sync.log`. Configuration via
    `~/.compost/config.json` `vault_roots: string[]`. Defer to post-
    dogfood — adds a new daemon coroutine that could perturb existing
    scheduler timings. Engram fact `6354319c8450` captures the batch
    performance baseline used for sizing. This remains distinct from the
    v4 Obsidian watcher, which records note-change metadata into
    `action_log` but does not ingest note content.
  - **jsonl extractor** — `packages/compost-ingest/compost_ingest/
    extractors/markdown.py` is the only structured-text extractor;
    `.jsonl` files (42 in vaults: XHS `notes.jsonl` author/tags/
    image_urls, GitWiki `Graph/*.jsonl` repo metadata) are skipped.
    Adding a jsonl extractor that emits one observation per line and
    extracts SPO from typed fields would unlock structured signal
    that's denser than the surrounding markdown. Estimate ~1h for
    extractor + dispatcher hookup + tests. Defer to post-dogfood —
    re-running reflect to backfill historical jsonl observations
    would touch the same chain-source corpus the dogfood is measuring.

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
