# Phase 5 — Open Questions Resolution

> **Status**: Resolved, 2026-04-17
> **Scope**: Two open questions from v7 handover blocking Phase 5 `compost-engram-adapter` design.
> **Authority**: Compost-side decisions. Engram session may counter-propose; adapter will follow the current contract (`docs/engram-integration-contract.md`) if so.

Both resolutions are **design choices** — no new Engram schema columns required. Compost-side logic only.

---

## Q1: insight parent_id chain for content > 2000 chars

### Problem

Engram schema caps `origin=compost` entries at 2000 chars (contract). Compost synthesis can exceed that (wiki pages, multi-fact reasoning). How do we chunk a long insight while keeping chunks linkable back to the logical whole?

### Considered designs

| Option | Approach | Tradeoff |
|---|---|---|
| A | Linked list via `parent_id` column (each chunk points at prev) | Requires new Engram schema column; sibling query is O(N) walks |
| B | Root + index via `root_id` / `chunk_index` / `total_chunks` columns | Cleaner queries; still requires Engram schema change |
| C | Embed position marker in `content` prefix (e.g. `[2/5] ...`) | No schema support; crude; loses machine-readable structure |
| D | Use existing `source_trace` JSON field for chunking metadata | Zero Engram schema change; structure preserved; queryable with `json_extract` |
| E | Single-entry if < 4000 (Engram's general cap), only split if truly huge | Breaks the 2000-char contract cap for compost kind |

### Decision: **D — chunking metadata in `source_trace`**

Rationale:
- Zero Engram schema change — survives Engram evolution without adapter coupling.
- `source_trace` is already JSON (per contract §Compost → Engram), so adding fields is a Compost-side choice.
- Engram can already query `WHERE json_extract(source_trace, '$.root_insight_id') = ?` using SQLite's native JSON operator.
- Staying Compost-side keeps the chunking logic swappable (future Phase 7 reasoning might want richer structure).

### Chunking schema

For a logical insight that exceeds 2000 chars, Compost emits N entries, each with:

```json
{
  "origin": "compost",
  "kind": "insight",
  "content": "<chunk text <= 2000 chars>",
  "source_trace": {
    "compost_fact_ids": ["...", "..."],
    "compost_wiki_path": "...",
    "derivation_run_id": "...",
    "synthesized_at": "<ISO-8601>",
    "root_insight_id": "<stable UUIDv7 for the logical insight>",
    "chunk_index": 0,
    "total_chunks": 3,
    "split_strategy": "paragraph"
  },
  "expires_at": "...",
  "tags": ["compost-insight", "chunked", "<topic-tags>"]
}
```

All chunks of one logical insight share:
- Same `root_insight_id`
- Same `synthesized_at`
- Same `expires_at`
- Same `compost_fact_ids` (the logical insight's full fact set)

Chunk-specific:
- `chunk_index` 0..N-1
- `content` slice

### Chunking algorithm (Compost side)

1. If content ≤ 2000 chars: single entry, `root_insight_id = entry's deterministic ID`, `chunk_index = 0`, `total_chunks = 1`, `split_strategy = "none"`.
2. If content > 2000 chars:
   - Prefer splitting on paragraph boundaries (`\n\n`) while each chunk ≤ 2000.
   - Fall back to sentence boundaries (`. `) if any paragraph itself exceeds 2000.
   - Hard truncate at 2000 as last resort with `split_strategy = "hard-cut"` so user review can flag it.
3. Write chunks in one transactional batch to `pending-engram-writes.db` so partial writes don't leave half-chunked insights in Engram.

### Idempotency

`root_insight_id` is deterministic: `uuidv5(NAMESPACE, project || '|' || sorted_compost_fact_ids.join(','))`. Re-running synthesis on the same fact set produces the same `root_insight_id`, so Engram sees an update (Compost invokes `mcp__engram__invalidate_compost_fact` for the fact set, then writes fresh chunks).

### Open sub-question (not blocking Phase 5)

Should Engram surface chunked insights as one "logical" result in recall, or return chunks independently and let Compost / the caller reassemble?

- **Current decision**: return independent. Engram's recall stays dumb-fast and zero-LLM (HC-2). Any caller that wants full insight joins by `root_insight_id`.
- Revisit when Phase 6 `ask` starts reading Engram insights — might want Compost-side reassembly helper.

---

## Q2: expires_at default policy

### Problem

Contract mandates `expires_at` on every `origin=compost` entry (debate 019 Q6: 30-day physical delete grace after expiration). What should the default be, and what knobs override it?

### Considered defaults

| Option | Value | Rationale | Failure mode |
|---|---|---|---|
| A | `synthesized_at + 90 days` | Aligns with quarterly retrospective; v7 handover suggestion | Long-lived strategic insights expire silently |
| B | `synthesized_at + half_life_seconds × k` (derived from source facts) | Inherits decay from source | Complex; each insight needs fact lookup |
| C | `synthesized_at + 30 days` (match default fact half-life) | Simple, ties to existing decay constant | Fresh synthesis expires before user can review |
| D | `NULL` (no expiry, user cleanup only) | No staleness bias | Violates contract (expires_at MANDATORY) |
| E | Tied to wiki rebuild cycle (expire on next rebuild) | Matches provenance lifecycle | Breaks HC-1 independence (Compost crash → Engram undefined) |
| F | Adaptive by confidence: 30d low / 90d mid / 180d high | Better signal utilization | No data to calibrate; premature |

### Decision: **A — synthesized_at + 90 days default, overridable per synthesis**

Rationale:
- 90 days = quarterly review cadence. Matches how users actually revisit strategic synthesis.
- Simple, predictable. One constant, easy to document, easy to audit.
- Composable with Engram's 30-day physical delete grace → total retention 120 days before gone.
- Overridable per synthesis site means we can tune per kind without touching the default.

### Per-synthesis overrides (Phase 5 adapter config)

Per Compost synthesis producer, the default can be overridden:

| Producer | Default | Suggested override | Why |
|---|---|---|---|
| `wiki-rebuild` | 90d | 90d (no override) | Matches rebuild cadence; wiki rebuilds on reflect |
| `contradiction-arbitration` | 90d | 180d | Arbitrated facts are user-reviewed; longer shelf life |
| `reflection-summary` | 90d | 30d | Ephemeral; next reflection will replace |
| `fact-cluster-insight` (Phase 7) | 90d | 90d | Default holds until data shows otherwise |
| User-initiated synthesis (`compost ask` → "save insight") | 90d | 365d | Explicit user action = higher intent |

Overrides live in the adapter config (`packages/compost-engram-adapter/config.ts`) and can be tuned without schema change.

### Refresh on reinforcement (Phase 6+)

When Engram recalls an `origin=compost` entry, Compost MAY push `mcp__engram__refresh_compost_insight(memory_id, extend_by_days)` to extend `expires_at`. This makes frequently-accessed insights stick around, mirroring Compost's own fact reinforcement. Deferred to Phase 6 — don't design it now.

### Migration / backfill

Not applicable — no existing `origin=compost` entries in Engram yet. Phase 5 is the first write.

### Edge cases

1. **Clock skew between Compost and Engram machines**: same machine, single user; out of scope.
2. **User pins an `origin=compost` entry** (converts it to `origin=human`-equivalent): Engram owns this. Contract §HC-3 says Compost writes are "eligible for user review, and distinct from `origin=human` / `origin=agent`" — pinning is the review outcome. Pinned entries should bypass `expires_at` on the Engram side (Engram session confirms in kind-extension debate).
3. **Source facts all superseded**: Compost invokes `mcp__engram__invalidate_compost_fact` immediately, not waiting for `expires_at`. The mandatory TTL is a safety net, not the primary invalidation.

---

## Unblocked vs still-blocked

After these resolutions, Phase 5 adapter can:

- ✅ Design the chunking splitter (`compost-engram-adapter/splitter.ts`) against the `source_trace` chunk metadata schema.
- ✅ Design the `expires_at` computation per synthesis producer.
- ✅ Write the pending-writes queue schema (knows it batches by `root_insight_id`).

Unblocked by Engram v3.4 Slice B Phase 2 S2 (2026-04-17, commit `ea223fa`):

- ✅ `mcp__engram__remember(origin='compost', ...)` writes with auto `compost_insight_sources` mapping via Engram's `_map_insight_sources` — the write path **reuses** the existing tool rather than adding a new one. This simplifies the Compost adapter: one less tool to mock.
- ✅ `mcp__engram__stream_for_compost` live with `limit=1000` default — Compost must poll in batches.
- ✅ `mcp__engram__invalidate_compost_fact` live. Note: **pinned `origin=compost` entries are also invalidated** by design per Engram handover gotcha.

The probe script (`scripts/probe-engram-readiness.ts`, Phase 5 track A) is the start-of-adapter gate. An agent session must ToolSearch-verify the two new tools are loaded (`mcp__engram__remember`'s schema already shows `origin` vocabulary includes `compost`).

---

## Cross-reference

- Contract: `docs/engram-integration-contract.md`
- Product identity: Compost anchor v2 (Engram memory `565f184a2fb1`), Engram anchor v2 (`c266b5d41250`)
- Debate source: 015 / 016 / 017 / 019 (Engram side)
- Phase 5 blocker: v7 handover → Engram Phase 2 first commit (`test_api_surface_coverage.py` + 4 drift)

If Engram session disagrees with any decision here, file an amendment in `debates/XXX-phase-5-contract-amendment/` and this doc supersedes accordingly.
