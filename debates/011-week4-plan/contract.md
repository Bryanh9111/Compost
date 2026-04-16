# Week 4 Contract Freeze (Day 1, 2026-04-15)

Two contracts pinned for the entire week. Any deviation requires a new debate.

## 1. Triage `SignalKind` enum (6 kinds)

**Source of truth**: `packages/compost-core/src/cognitive/triage.ts:12-18`
(code is authoritative — debate 011 brief §B had a stale 5-kind list; that
list is **incorrect** and must not be followed).

The 6 kinds, aligned with migration 0010 `health_signals.kind` CHECK + 0012
amendment:

| Kind | Semantic | Producer | Source table |
|---|---|---|---|
| `stale_fact` | A fact not reinforced and not archived for > 90d | `scanStaleFact` | `facts` |
| `unresolved_contradiction` | (Debate 013 F1 revision) `(subject, predicate)` with 2+ distinct active objects, none archived, older than `contradictionAgeDays` (default 7) — catches contradictions *before* reflect has processed them | `scanUnresolvedContradiction` | `facts` |
| `stuck_outbox` | outbox row age > 24h, not drained, not quarantined | `scanStuckOutbox` | `observe_outbox` |
| `orphan_delta` | `fact_links` in-degree + out-degree = 0 AND no `access_log` hit in `orphanAccessDays` (default 30) AND created before the window | `scanOrphanDelta` | `facts` + `fact_links` + `access_log` |
| `stale_wiki` | `wiki_pages.stale_at IS NOT NULL` OR `last_synthesis_at IS NULL` OR `last_synthesis_at < now - staleWikiDays` | `scanStaleWiki` | `wiki_pages` |
| `correction_candidate` | One row per `correction_events` entry; **no scanner** — written directly by `correction-detector.scanObservationForCorrection` during the drain hook (debate 006 Pre-Week-2 Fix 5). `triage()` only aggregates it into the report. | drain-hook producer | `correction_events` |

**Contract rules (freeze)**:
- Enum lives in `triage.ts`; CLI imports from there (never hardcoded).
- Surface-only: scanners NEVER mutate `facts` / `fact_links` / any business table.
- Default per-scan `LIMIT 100`. Configurable via `TriageOptions.maxPerKind`.
- Severity always `info` unless explicitly noted; no auto-escalation.
- `resolveSignal()` only sets `resolved_at` + `resolved_by`; does NOT delete.

## 2. LLM `BreakerRegistry` singleton contract

**Source of truth**: `packages/compost-daemon/src/main.ts` (daemon-boot
ctor). Exported as `llmRegistry`, consumed by:

1. `startReflectScheduler(db, { llm: llmRegistry, dataDir })` — already wired
2. `startMcpServer(db, llmRegistry)` — Day 1 change (new signature)

**Removed** (Day 1): `mcp-server.ts` lazy `llmRegistry` closure variable. No
more two-registry topology. `ROADMAP.md` Known-risks row 1 (dual registry)
is eliminated by this.

**Contract rules (freeze)**:
- Exactly one `BreakerRegistry` per daemon process.
- Site keys: `"ask.expand" | "ask.answer" | "wiki.synthesis"` (debate 010
  removed `mcp.ask.factory`).
- Adding a new site requires updating `breaker-registry.ts:20-23` + ARCHITECTURE.md
  LLM call sites table in one commit.
- `OllamaLLMService` ctor is side-effect-free; connection failure surfaces
  at first `generate()` call and is absorbed by the breaker.

## 3. `compost triage` CLI shape (Day 3 deliverable)

```
compost triage list --kind <kind> --limit <n> --since <iso>
compost triage resolve <id> --by <user|agent>
```

- `--kind` validated against the 6 enum values above; invalid → exit 2.
- `--limit` integer 1-10000; invalid → exit 2.
- `--since` ISO timestamp (same shape as `compost audit list`).
- `resolve --by user` is the only CLI-exposed actor; `agent` reserved for
  future auto-resolve.
- stdout: JSON array of `HealthSignal` rows.

## 4. Non-goals (pinned exclusions for Week 4)

- `correctedText` semantic extraction (debate 012 → Week 5+)
- `open_problems` / `origin_hash` / bench / PII redactor (Phase 4 P1)
- `archive_reason='superseded'` schema CHECK tightening
- Half-open circuit-breaker long-task starvation redesign
- `ILLMProvider.forSite()` union signature refactor

Any PR landing in Week 4 touching these is out-of-scope and must be split.

## 5. Test count target

Week 3 ended at 286 pass / 0 fail. Week 4 target: **≥ 295 pass**:
- +12 triage scanner tests (6 kinds × 2 cases)
- +2 scheduler integration test
- +1 doctor --check-llm
- +1 ask() hits=0 wiki tests
- +1-3 CLI tests (triage + audit list)

**Merge gate**: test count must be ≥ 295 AND registry known-risk row
eliminated AND no new TODOs except the one in `correction-detector.ts:65`
(which is a comment update per debate 012, not a new TODO).

DONE_CONTRACT
