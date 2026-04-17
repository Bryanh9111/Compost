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
  "content": "<synthesized text, target length <= 2000 chars>",
  "project": "<compost-project-name or null for cross-project insights>",
  "scope": "project | global | meta",
  "source_trace": {
    "compost_fact_ids": ["<fact_id>", "..."],
    "compost_wiki_path": "<optional wiki page path>",
    "derivation_run_id": "<compost derivation id>",
    "synthesized_at": "<ISO-8601 timestamp>"
  },
  "ttl_seconds": 7776000,
  "confidence": 0.85,
  "tags": ["auto-generated", "compost-insight", "<optional-topic-tags>"]
}
```

### Compost's guarantees

- `content` is always <=2000 chars (splits long synthesis into multiple linked entries)
- `source_trace` always present — insights are always traceable back to Compost facts
- `synthesized_at` monotonic per insight (allows Engram to detect staleness)
- Idempotency: same `(project, source_trace.compost_fact_ids)` produces the same deterministic insight ID — Compost won't spam Engram with duplicates on repeated synthesis

### What Compost expects from Engram

- Engram exposes a write API that accepts this payload (MCP tool or local Bun interface)
- Engram marks `origin=compost` entries distinguishably in recall output (user can filter)
- Engram may GC / archive Compost-origin entries based on TTL, user action, or source invalidation (Compost provides source-change webhooks in Phase 5+)
- Write failure returns a clear error so Compost can log it — Compost will not retry aggressively

### Invalidation semantics (Compost side)

When a Compost fact underlying an insight changes or gets superseded:

- Compost emits an invalidation signal to Engram with the affected `source_trace.compost_fact_ids`
- Engram may mark the matching insight entries as stale / hidden — exact semantics Engram-side
- If Engram is down at invalidation time, Compost queues the signal with idempotent retry

## Engram → Compost (event source)

### Goal

Compost treats selected Engram entries (primarily `kind=event`, `kind=note`, `kind=reflection`) as new ingest sources, feeding them through Compost's observe → extract → facts pipeline. This lets Compost synthesize across both the user's work artifacts (current source) and their personal memories (new source).

### What Engram exposes

Proposed API (Engram may adjust):

- `engram export-stream --kinds=event,note,reflection --since=<timestamp>` — NDJSON output
- Or MCP tool `mcp__engram__stream_for_compost(since, kinds)` — streaming query
- Each entry includes: `memory_id`, `kind`, `content`, `project`, `scope`, `created_at`, `updated_at`, `tags`, `origin`

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

- **Compost Phase 4** (current): only PII / bench / origin_hash / examples — no Engram integration yet
- **Compost Phase 5**: `compost-engram-adapter` package, this contract implemented
- **Engram v3.3**: schema work (unpin, scope, CHECK) — doesn't yet need contract
- **Engram future version**: kind extensions to support Compost write-back

Both sides should cross-reference this document when implementing their respective halves. Changes to this contract need agreement from both sessions.

---

**Next step**: Engram session reviews this, debates implementation choices on their side, and either accepts / requests amendments to this contract. Compost session waits for Engram's response before starting Phase 5 adapter work.
