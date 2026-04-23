# Engram Integration Contract

> **Status**: Draft, 2026-04-16
> **Audience**: Engram session / Engram maintainers
> **Purpose**: This document states what **Compost expects from Engram** to support the bidirectional integration described in the Compost v3 roadmap. It does **not** prescribe Engram's implementation — the Engram session decides how to fulfill these expectations.

## Scope

This contract covers:

1. **Compost → Engram** (insight write-back): how Compost deposits synthesized knowledge into Engram
2. **Engram → Compost** (event source): how Compost subscribes to Engram's memory stream as a new ingest source
3. **Independence constraints**: what each side must do to survive the other being absent

Out of scope:

- How Engram implements event storage, kind extensions, LLM-on-write pipelines — Engram session decides
- Engram's own roadmap (v3.3 unpin + scope + schema CHECK + invariant tests continues)
- UI / CLI ergonomics on the Engram side

## Hard constraints (both sides must honor)

### HC-1 — Independence survives

- Compost must run fully without Engram installed. All Compost features (observe, query, ask, reflect, wiki synth) work standalone.
- Engram must run fully without Compost installed. All Engram features (recall, remember, proactive) work standalone.
- Either side crashing / being uninstalled must not degrade the other's availability.

### HC-2 — Engram recall path stays zero-LLM

- Engram's `recall()` path (the <50ms p95 hot path injected before every LLM call) must never invoke an LLM.
- LLM usage is allowed on Engram's **write path** (e.g. splitting a long free-form journal entry into atomic entries) but the runtime recall must remain deterministic FTS5/SQLite.

### HC-3 — Compost owns synthesis, Engram owns working memory

- Compost produces `insight` / `pattern` / `synthesis` outputs (LLM-derived).
- Engram produces `event` / `note` / `reflection` / `preference` / etc. (raw user memory).
- Compost writes back to Engram as a **new origin** (e.g. `origin=compost` or a new `kind=insight`) — Engram marks these entries as externally sourced, eligible for user review, and distinct from `origin=human` / `origin=agent`.

## Compost → Engram (insight write-back)

### Goal

When Compost synthesizes a new insight (from wiki rebuild, reflection, or Phase 7 reasoning), it pushes that insight back to Engram so that the next time Engram does a proactive recall, the insight is available with zero LLM latency.

### What Compost sends

Proposed payload (Engram may adjust schema):

```json
{
  "origin": "compost",
  "kind": "insight",
  "content": "<synthesized text, Compost must pre-split to <= 2000 chars>",
  "project": "<compost-project-name or null for cross-project insights>",
  "scope": "project | global | meta",
  "source_trace": {
    "compost_fact_ids": ["<fact_id>", "..."],
    "compost_wiki_path": "<optional wiki page path>",
    "derivation_run_id": "<compost derivation id>",
    "synthesized_at": "<ISO-8601 timestamp>"
  },
  "expires_at": "<ISO-8601 absolute timestamp, MANDATORY>",
  "confidence": 0.85,
  "tags": ["auto-generated", "compost-insight", "<optional-topic-tags>"]
}
```

> **Schema notes** (per Engram debate 019 revisions, 2026-04-16):
> - `origin="compost"` is a **schema-enforced literal** (Engram CHECK constraint:
>   `origin IN ('human', 'agent', 'compost')`). Not a code-level variant.
> - `expires_at` replaces the older `ttl_seconds` (absolute timestamp is clock-drift-safe).
> - `source_trace` and `expires_at` are **both mandatory** — no optional fields.
> - Engram schema permits `content` up to 4000 chars for other kinds, but Compost
>   must self-split to 2000 chars per insight entry (Compost side owns the splitter).

### Compost's guarantees

- `content` is always <=2000 chars — Compost splits long synthesis into multiple linked entries (parent_id linkage TBD in Phase 5 splitter design)
- `source_trace` always present — insights are always traceable back to Compost facts
- `expires_at` always computed before push (default: synthesized_at + 90 days; overridable per synthesis)
- `synthesized_at` monotonic per insight (allows Engram to detect staleness)
- Idempotency: same `(project, source_trace.compost_fact_ids)` produces the same deterministic insight ID — Compost won't spam Engram with duplicates on repeated synthesis

### Idempotency contract (debate 024)

Compost's `computeRootInsightId(project, factIds)` (`packages/compost-engram-adapter/src/splitter.ts:40-46`) emits a UUIDv5 over `(project ?? "") + "|" + sorted(factIds)`. Same input → same `root_insight_id`, deterministic across processes. Combined with `chunk_index`, this is the **structural identity** of any compost insight chunk.

Engram enforces this identity as a hard storage invariant (migration `003_compost_insight_idempotency.sql`):

- `CREATE UNIQUE INDEX idx_compost_insight_idempotency ON memories(json_extract($.root_insight_id), json_extract($.chunk_index)) WHERE origin='compost' AND json_type checks pass`
- `MemoryStore.remember()` checks `_find_compost_duplicate(rid, cidx)` before INSERT (`Engram/src/engram/store.py`).
- **Behavior on duplicate**: returns the existing `memory_id` to the client (PUT semantics). No `_strengthen` — duplicate compost writes are infrastructure noise (scheduler retry, manual re-push), not user re-confirmation.
- **Compost-side contract**: writer treats "Engram returned existing id" as `status: "written"` (not pending). `PendingWritesQueue` does not retry. See `packages/compost-engram-adapter/test/writer.test.ts` `describe("idempotency contract with Engram (debate 024)")` for the regression suite.

Implication: it is safe to re-run `compost digest --push` against the same fact set; row count in Engram does not grow.

### What Compost expects from Engram (per Engram v3.4 Slice B Phase 2 S2, commit `ea223fa`)

- Write API: **reuses existing `mcp__engram__remember`** tool with `origin='compost'` + `kind='insight'` + `source_trace` + `expires_at`. Engram's `_map_insight_sources` auto-populates the internal `compost_insight_sources` table from `source_trace.compost_fact_ids` on insert — no separate `write_compost_insight` tool exists.
- Engram marks `origin=compost` entries distinguishably in recall output (user can filter)
- Engram implements `expires_at` semantics: hide expired entries from default recall + **30-day physical delete grace window** after expiration (debate 019 Q6)
- Engram **excludes `origin=compost` entries from the return stream by default** (prevents Compost-generated insights looping back into Compost as new source — debate 019 Q7 + prior contract HC)
- Engram enforces structural idempotency on `(root_insight_id, chunk_index)` for `origin=compost` rows (debate 024 / migration 003) — duplicate writes return existing `memory_id`, no error
- Write failure returns a clear error so Compost can log it — Compost will not retry aggressively
- **Append-only invariant**: once written, insight `content` is immutable and `updated_at = created_at`. To "update" an insight, Compost must `invalidate_compost_fact` the underlying fact IDs (soft-deletes the old entry) and then `remember` the new version — there is no edit API on Engram side.

### Invalidation semantics (Compost side)

When a Compost fact underlying an insight changes or gets superseded:

- Compost invokes **MCP tool `mcp__engram__invalidate_compost_fact`** with the affected `compost_fact_ids[]` (per debate 019 Q7 — no HTTP webhook)
- Engram reverse-looks up `compost_insight_sources` to find matching insight entries, marks them `status='obsolete'` (soft delete), physical delete after 30-day grace
- **Pinned `origin=compost` entries are also invalidated by design** — per Engram handover gotcha. If a user wants to preserve a Compost-synthesized insight across its fact-set supersession, they must convert the entry's origin via Engram's user-review path (out of scope for this contract).
- If Engram is unreachable at invalidation time, Compost queues the signal in `~/.compost/pending-engram-writes.db` with idempotent retry on next Engram availability

## Engram → Compost (event source)

### Goal

Compost treats selected Engram entries (primarily `kind=event`, `kind=note`, `kind=reflection`) as new ingest sources, feeding them through Compost's observe → extract → facts pipeline. This lets Compost synthesize across both the user's work artifacts (current source) and their personal memories (new source).

### What Engram exposes (per Engram v3.4 Slice B Phase 2 S2, commit `ea223fa`)

- **MCP tool `mcp__engram__stream_for_compost(since, kinds, project, include_compost, limit)`** — primary, streaming query. Default `limit=1000`; Compost must poll in batches.
- CLI `engram export-stream --since/--kinds/--project/--include-compost/--limit` (JSONL stdout) — same handler underneath, for scripted batch
- Each entry includes: `memory_id`, `kind`, `content`, `project`, `scope`, `created_at`, `updated_at`, `tags`, `origin`
- **Append-only**: `updated_at == created_at` always. If Engram ever adds an edit API, this contract and `_memory_to_compost_dict` on Engram side must be updated in lock-step.
- **`origin=compost` entries excluded by default** from the return set (prevents feedback loop). Use `include_compost=true` / `--include-compost` only for Compost's own audit / reconciliation paths.

### What Compost does with it

- Compost treats each eligible Engram entry as an `observation` with `source_kind=engram`
- Runs standard extraction pipeline (Python extractor + LLM fact extraction)
- Writes derived facts with `source_observation.adapter=engram`, preserving provenance back to the originating `memory_id`

### Sync model

- Pull-based (Compost polls Engram periodically; default 1h, configurable)
- Push-optional (if Engram supports webhook / MCP notification, Compost can subscribe; not required)
- Idempotency: Compost dedupes by `memory_id` — same entry ingested twice produces one observation (use `idempotency_key=engram:<memory_id>`)

### What Compost expects from Engram

- A streaming query interface filtering by kind, time, project
- Stable `memory_id` — never changes once assigned (so Compost's dedup works across session boundaries)
- Clear `updated_at` semantics — Compost re-ingests if updated (re-running extraction is cheap and idempotent)
- `origin=compost` entries are **excluded by default** from the stream (don't loop Compost-generated insights back to Compost)

## Failure modes

### Engram down, Compost running

- Compost skips Engram ingest path (zero-cost)
- Compost insights destined for Engram write-back queue locally in `~/.compost/pending-engram-writes.db`
- On Engram recovery, Compost flushes queue with idempotent retry
- Recent insights unavailable in Engram's proactive recall until flush completes — acceptable degradation

### Compost down, Engram running

- Engram's recall path is unaffected (it runs purely on local FTS5)
- New `origin=compost` entries simply stop appearing in Engram until Compost recovers
- Existing `origin=compost` entries remain valid (stale but useful) until TTL or user cleanup

### Partial failure (one side writes, other side's read blocked)

- Both sides log with a stable correlation ID (`engram_memory_id` ↔ `compost_derivation_id`)
- Reconciliation tool (Phase 5 deliverable): `compost doctor --reconcile-engram` checks for pending/dropped messages

## Questions the Engram session should answer

The Engram session has authority over these; Compost adapts to Engram's choices:

1. **Kind extension strategy**: does Engram extend existing kind enum to include `insight`, or add a separate `origin=compost` marker?
2. **Long-form write path**: does Engram implement LLM-on-write (splitting user journal into atomic entries), or require Compost / user to pre-split?
3. **Cross-project insight routing**: how does Engram tag `scope=global` insights so they surface in any project's recall?
4. **Stream API surface**: MCP tool vs CLI export vs both?
5. **User review UX**: how does the user distinguish `origin=compost` entries in recall output and approve / reject / pin them?
6. **Storage growth**: does Engram GC aged `origin=compost` entries automatically, or require explicit cleanup?

## Phase alignment

- **Compost Phase 4** (shipped 2026-04-17): PII / bench / origin_hash / examples / docs layering — no Engram integration yet
- **Compost Phase 5** (unblocked 2026-04-17): `compost-engram-adapter` package, this contract implemented. Engram side ready at `main @ ea223fa`.
- **Engram v3.3 / v3.4 Slice A** (shipped): schema work (unpin, scope, CHECK, origin=compost literal, expires_at, source_trace columns)
- **Engram v3.4 Slice B Phase 2 S2** (shipped 2026-04-17): `stream_for_compost` + `invalidate_compost_fact` MCP tools live; `remember(origin='compost')` writes auto-fill `compost_insight_sources` via `_map_insight_sources`
- **Engram Phase 3** (data-triggered): recall/proactive layering, GC daemon, engram lint compost checks, ARCHITECTURE docs

Both sides should cross-reference this document when implementing their respective halves. Changes to this contract need agreement from both sessions.

---

**Status**: Phase 5 adapter unblocked. Compost side may begin `compost-engram-adapter` package implementation. The readiness probe (`scripts/probe-engram-readiness.ts`) verifies each start-up that the three tool surfaces (`remember` accepting `origin='compost'`, `stream_for_compost`, `invalidate_compost_fact`) are live.
