# Debate #4 — Compost v2 Architectural Decision Stress Test

**Debate ID**: debate4
**Rounds**: 3 thorough (may extend if R3 not converged)
**Mode**: cross-critique, independent per-decision scoring
**Tie-break**: none — continue rounds until consensus
**Started**: 2026-04-11
**Output target**: `docs/compost-v2-spec.md` replacing `phase0-spec.md`

## Scope

Four independent architectural decisions must be stress-tested. Each participant evaluates all four independently — you may agree with some and disagree with others.

### Decision A — Stateless query-time decay

**Claim**: Do NOT run background jobs that write decay updates to importance/freshness columns. Compute decay as SQL expressions at SELECT time:

```sql
SELECT *,
  original_importance * POWER(0.5, (strftime('%s','now') - created_at) / half_life_seconds) AS decayed_score
FROM memories
ORDER BY decayed_score DESC;
```

**Source**: airi DevLog 2025.04.06 (`reference-survey-airi.md` §1 line 95-103)

**Opposing evidence**:
- Ombre Brain uses a background job to write decay to disk (`reference-survey-memory-projects.md` §3)
- LycheeMem scores include activation counts updated on retrieval

**Stress-test questions**:
- Does this scale when `memories` grows to 500K+ rows with no index covering the decay formula?
- In multi-context retrieval with 5+ filter dimensions, does the `ORDER BY decayed_score` force a full scan?
- How do you support "boost this memory manually" (e.g. user pins something important) under a purely stateless model — is the pinned boost also computed, or does it go in a separate column?
- If `access_count` is a retrieval reinforcement signal, where does it get written? If it's written on each retrieval, that reintroduces write amplification.

### Decision B — Probabilistic multi-factor ranking

**Claim**: Replace single-axis vector matching in `compost.query` with a weighted sum:

```
rank = w1*semantic_similarity        (0..1, cosine)
     + w2*temporal_relevance          (0..1, stateless decay)
     + w3*sqrt(access_count)          (reinforcement)
     + w4*importance                  (0..1, manual or inferred)
     + w5*emotional_intensity         (abs(valence) * arousal)
     - w6*repetition_penalty          (served in last N queries)
     - w7*context_mismatch            (if context filter active)
```

Defaults inspired by airi: `w1=1.2, w2=0.2`, others start at 0 in Phase 0 and turn on progressively.

**Stress-test questions**:
- How are weights tuned? Is there a principled calibration, or is this vibes?
- What happens when a user reports "bad results"? Is there an audit path that shows which factor dominated the bad ranking?
- Is the formula differentiable enough to tune automatically from feedback (thumbs up/down on results)?
- Does this formula handle cold-start (first day after install, 0 observations) gracefully?
- Can the formula be overridden per-context? (e.g. work context might weight recency heavier than personal)

### Decision C — 5-tier cognitive memory in ONE physical table

**Claim**: sensory / working / episodic / semantic / procedural are conceptual tiers. Physically they all live in ONE `memories` table with a `kind` ENUM column. Views filter by `kind` to expose per-tier APIs.

**Opposing evidence**:
- airi actually uses 4 separate tables: `memory_fragments`, `memory_episodic`, `memory_long_term_goals`, `memory_short_term_ideas` (`reference-survey-airi.md` §Storage Backends)
- LycheeMem uses 3 separate stores (working / semantic / procedural) with different retrieval logic

**Stress-test questions**:
- How does a single table handle radically different TTLs (sensory: seconds; procedural: forever)?
- If episodic memory has participants/location/event_type metadata that semantic facts don't need, does the one-table design force sparse columns or JSON metadata that can't be indexed?
- Sonnet's earlier debate3 point: `contexts TEXT[]` JSON was a scaling cliff precisely because it forced metadata into unindexable JSON. Does `kind`-discriminated metadata repeat this mistake?
- Query-time performance: a `compost.query` that wants only semantic facts runs `WHERE kind='semantic'` — does that force partial indexes per kind?
- Migration: when Phase 3 adds procedural memory, does the table have to grow more columns that are NULL for the other 99% of rows?

### Decision D — Hook contract replaces MCP notifications for write path

**Claim**: Claude Code's hook model (subprocess + stdin JSON + exit code semantics + async flag) replaces debate#1's locked-in stdio MCP `kb.observe` notification. Write path becomes `compost hook <event>` subprocess. MCP stays only for read path (`compost.query` from LLM).

**Source**: Claude Code `utils/hooks.ts` (`reference-survey-claude-code-source.md` §Hook System Deep Dive)

**Consequences**:
- `packages/compost-adapter-claude-code` disappears
- Claude Code settings.json adds one line: `"command": "compost hook user-prompt-submit"`
- Adapter pattern becomes "any language that can read/write JSON"

**Stress-test questions**:
- debate#1 locked in stdio MCP + outbox after explicit contestation. What new evidence justifies reopening? Is this a real improvement or chasing the latest idea?
- **Cold-start cost**: every hook invocation spawns a `compost hook` subprocess. Node cold start is 50-200ms. At `PreToolUse`/`PostToolUse` frequency (multiple per second in an active session), does this become the bottleneck?
- **Hosts without hook systems**: airi, openclaw, generic MCP clients don't have Claude Code's hook dispatcher. They can't call `compost hook` without adding an integration layer. Does this split the adapter story into two incompatible designs?
- **Backpressure**: in async mode (`{async: true}`), who owns the task tracking — the hook caller (Claude Code) or the hook target (Compost)? If Compost owns it, is the hook just a thin shim over the outbox we already designed?
- **Outbox still needed?**: if the daemon is down when `compost hook` fires, where does the event land? Does `compost hook` itself need an outbox?
- **Observability**: MCP notifications have structured error surfaces. Hook subprocess failures collapse into exit codes + stderr strings. Is that enough?

## Required Output Structure

For each round, each participant produces an analysis covering:

1. **Independent score** on each decision (A/B/C/D) from 0-3:
   - 0 = definitely wrong, architectural dead-end
   - 1 = premature, insufficient evidence to adopt now
   - 2 = correct in principle, requires specific refinement
   - 3 = adopt as-is, strong evidence

2. **For each decision, one concrete failure mode** that is NOT already in the stress-test questions above. If you can't name a new one, say so.

3. **For each decision, one concrete schema/SQL/code change** you would require before ship.

4. **Direct engagement with prior round analyses by name** (R2+) — challenge or concede specific points.

5. **Final merger check**: do the four decisions compose cleanly, or are there hidden conflicts between them?

Prior debate decisions still in force (do NOT relitigate without new evidence):
- Hybrid Node + Python (debate #1 + #2)
- `derivation_run` table with partial unique index on `(observe_id, layer, transform_policy, model_id, context_scope_id, extraction_profile)` (debate #3)
- `policies` SQL table populated from TypeScript registry at startup (debate #3)
- `context` entity table with `isolation_level`, `trust_floor`, hierarchical-path-safe IDs (debate #3)
- `ingest_queue` lease columns (debate #3)
- Auditable Coverage product framing (debate #1)

Reference files (all participants MUST read):
- `docs/phase0-spec.md` — current spec being replaced
- `docs/debate/synthesis.md`, `docs/debate2/synthesis.md`, `docs/debate3/synthesis.md` — locked decisions
- `docs/reference-survey-memory-projects.md` — 14 memory project survey
- `docs/reference-survey-airi.md` — airi architecture survey
- `docs/reference-survey-claude-code-source.md` — Claude Code CLI survey
- `docs/debate4/context.md` — this file

**Tie-break policy**: none. If R3 has not converged on a decision, R4 runs.
