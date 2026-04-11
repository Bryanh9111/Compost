# R1 — Claude (Opus, Moderator + Participant)

**Role**: independent analysis after reading Gemini R1, Sonnet R1, Codex R1. I am NOT here to pick winners — the user disabled tie-break. I am here to contribute my own take, identify where surface disagreements hide real convergence, and name failure modes nobody else surfaced.

---

## Meta-observation: two of the four "disagreements" are linguistic

Before scoring:

**On C (one table vs N tables)**: Gemini scored 3/3, Sonnet and Codex scored 1/3. But all three proposals converge on **vertical partitioning with shared identity**:
- Gemini: `memory_metadata` + `memory_blobs` (vertical split by hot/cold data)
- Sonnet: keep `facts` + add `procedural_memory` when Phase 3 ships (horizontal split by kind)
- Codex: "one logical `memories` base table + kind-specific extension tables keyed by `memory_id`" (hybrid)

None of them actually want 1 sparse table with all 7 cognitive tiers stuffed in. None of them want 5 fully independent tables with no shared identity. They all want the same thing, phrased differently. The score split is about the strawman framing in context.md, not the underlying design. I am going to reframe C and score it based on the converged design, not the original strawman.

**On D (hook contract vs MCP notifications)**: Gemini scored 3/3, Sonnet 2/3 (scoped adoption), Codex 1/3 (rejection). The difference: Codex interprets D as "replace the debate #1 outbox protocol with hooks," Sonnet interprets it as "use hook subprocess as the integration style for Claude Code specifically, writing to the SAME outbox the debate #1 adapter would have used." These are completely different claims. The strawman said "adapter-claude-code disappears" which is what triggered Codex's rejection. The actual correct framing is "adapter-claude-code **becomes** the `compost hook` binary; the outbox protocol is unchanged."

When the framing conflict is resolved, D is not a debate #1 reopening — it is a Claude-Code-specific adapter implementation detail. Protocol decision from debate #1 stands. I am going to score D on the **corrected** framing.

---

## My scores and rationale

### Decision A — Stateless query-time decay: **2/3**

Everyone agrees in principle. The refinements are additive, not conflicting:

- Codex: bound `as_of_unix_sec` parameter (cursor stability). **Required.**
- Codex: explicit `last_reinforced_at_unix_sec` column, not overloading `created_at`. **Required.**
- Sonnet: `half_life_seconds` per-fact column, set by transform_policy. **Required.**
- Sonnet: `access_log` append-only table with batched aggregation in query, NO inline writes. **Required.**
- Gemini: `decay_floor` column + `decay_function` plugin for pinnable memories. **Phase 2.**

**NEW failure mode nobody named** — the "active forgetting gap": Stateless decay ranks memories lower but never deletes them. Engram's founding insight (from the Compost memory recall I did earlier: "Henry's idea for brain-like associative memory network. Key challenge: forgetting mechanism harder than storage") says forgetting is a first-class cognitive process, not a ranking trick. A memory with `decayed_score = 0.001` still occupies storage, still appears in full-table scans, still shows up in integrity checks. After 5 years of passive ingestion, Compost has 10M rows, 99% of which are effectively invisible but still cost I/O.

**Required addition to Decision A**: Phase 0 must declare a hard-forgetting policy for at least the sensory tier. Concrete form:
```sql
-- Sensory buffer: hard-GC after a fixed TTL
DELETE FROM observations
WHERE adapter = 'claude-code'
  AND idempotency_key LIKE 'sensory:%'
  AND captured_at < datetime('now', '-7 days');
```
Run this from `compost reflect` (no longer a no-op stub). Episodic and semantic memories are append-only with soft-tombstone via `archived_at`. Procedural is never forgotten.

Stateless decay is the right **scoring** architecture. It does not replace the need for an **active forgetting** process.

---

### Decision B — Probabilistic multi-factor ranking: **2/3**

Sonnet's 1/3 is about timing. Gemini and Codex at 2/3 are about principle with refinement. I side with 2/3 principle + staging: ship the skeleton in Phase 1, populate factors progressively.

Required refinements (merged from R1):
- Codex: `COALESCE(..., 0.0)` on every term for NULL safety. **Required.**
- Codex: bounded reinforcement `MIN(1.0, LN(1 + access_count) / LN(1 + access_sat))`. **Required.**
- Codex: `ranking_profile` SQL table for weight versioning (replay). **Required.**
- Gemini: `ranking_components: Record<string, number>` on `QueryHit` for audit. **Required.**
- Sonnet: `ranking_audit_log` table for per-query breakdown, debug-gated. **Required when w ≥ 3 factors active.**
- Sonnet: staged factor enablement (w1 in Phase 1, w2 Phase 2, w3-w4 Phase 3, w5-w7 Phase 4). **Accepted.**

**NEW failure mode nobody named** — the **rerank time budget under two-stage retrieval**: if LanceDB ANN returns top-K=200 candidates and each rerank requires joining `facts` + `access_log` + `fact_context`, at 200 rows × 7 factor evaluations the formula cost is non-trivial even with proper indexes. Sonnet named the two-stage architecture concern but nobody pinned the budget. Phase 1 spec must commit: `compost.query` p50 < 100ms, p99 < 500ms on 100K fact database. If the formula can't hit these with all enabled factors, the response is to **drop terms, not scale the hardware**. This is the forcing function for the staging approach.

Sonnet's `compost.query` vs `compost.ask` divergence concern is real but solvable: `compost.ask` should call `compost.query` internally to select wiki pages, not bypass it. Same formula, different call site. Noted for v2 spec.

---

### Decision C — Memory physical layout: **2/3** (reframed)

I score the **converged** proposal, not the strawman. Converged proposal:

1. One logical `memories` surface exposed as views and the public API
2. Physical storage: `facts` (existing, from debate #3) + future kind-specific tables (`memory_episodic`, `memory_procedural`, ...) added as each tier ships
3. Shared identity via `observe_id` + derivation_run linkage
4. Vertical partitioning for heavy blobs (vectors go in `memory_blobs` or stay in LanceDB, not mixed with row data)
5. Partial indexes per kind on the base table for hot query paths
6. Views (`SELECT ... FROM facts UNION ALL SELECT ... FROM memory_episodic`) expose unified query surface

This matches airi's 4-table precedent, LycheeMem's 3-store precedent, and debate #3's normalization philosophy (removing `contexts TEXT[]` because JSON metadata didn't index). It preserves Gemini's portability story (single `~/.compost/ledger.db` file) while addressing Sonnet's migration-lock and Codex's page-churn concerns.

**NEW failure mode nobody named** — the **semantic-vs-episodic boundary is harder than the storage decision**: Sonnet is right about the physical layout, but the REAL hard question is: when the Python extractor returns "Zion deployed Compost on 2026-04-11", is that a semantic fact (triple: `Zion -[deployed]-> Compost`) or an episodic event (event_type=deployment, actor=Zion, object=Compost, time=2026-04-11)? The extractor has to decide at extraction time. Phase 0 has no guidance.

**Required addition**: Phase 0 decides the default. My recommendation: **default to semantic, promote to episodic only when explicit temporal or participant metadata is present**. The extractor's chunk metadata already includes timestamps and participants; when both are populated, emit an episodic record. When only one or neither, emit a semantic fact. This rule is simple enough to implement in the Python extractor and deterministic enough to replay.

---

### Decision D — Hook contract (reframed): **2/3**

Corrected framing (from the meta-observation above): hook contract is a Claude-Code-specific adapter *implementation style*, not a protocol replacement. The debate #1 outbox protocol stays. `compost hook <event>` subprocess writes to `~/.compost/adapters/claude-code/outbox.db` exactly as the long-running adapter would have done. The daemon's reconciliation loop is unchanged.

Consequences of the corrected framing:
- `packages/compost-adapter-claude-code` **does NOT disappear**. It becomes the `compost hook` binary (CLI subcommand in compost-cli that Claude Code's `settings.json` invokes).
- MCP notification path stays as the fallback protocol for non-Claude-Code hosts (airi, openclaw, generic MCP clients)
- Codex's idempotency drift concern is fixed by: `compost hook` computes `idempotency_key = sha256(adapter || source_id || JSON.stringify(envelope))` deterministically, so Claude Code retries produce the same key, the existing `observations.UNIQUE(adapter, source_id, idempotency_key)` constraint deduplicates

**NEW failure mode nobody named** — the **cold-start latency wall**: Claude Code fires `PreToolUse` + `PostToolUse` on every tool call. In a fast session that is 10+ events per minute. Each `compost hook` invocation spawns a fresh Node process: 50-200ms cold start, 20ms for outbox write, exit. Aggregate wallclock cost to Claude Code: 500ms-2s per minute of tool activity. At `asyncTimeout: 30s` this fits inside the timeout but shows up as "claude feels slow."

**Required mitigation** — one of:
1. **`compost hook` is a native static binary (Go or Rust) that does stdin → SQLite append → exit in <5ms cold start.** Adds one new language to the toolchain but solves the latency wall definitively. Compost is already hybrid (Node + Python); adding Rust/Go brings it to 3 languages.
2. **`compost hook` returns `{async: true}` immediately, then spawns a detached child that does the actual write.** Claude Code sees success in <20ms. The detached child can take its full time. Uses Claude Code's own async protocol. No new language.
3. **Persistent unix socket between `compost hook` and `compost-daemon`.** First hook invocation opens a named socket; subsequent invocations reuse. Avoids cold start entirely. More complex error handling.

I recommend option 2 (async: true immediate return) for Phase 0 because it costs zero new infrastructure and composes cleanly with the debate #1 outbox protocol. Option 1 is the Phase 2+ upgrade if latency still hurts. Option 3 is the fallback if async gets blocked by Claude Code.

---

## Composition check

Agreeing with Sonnet and Codex that A+B have a write-path tension that must be resolved together. Expanding on their points:

**A (stateless decay) + B (reinforcement signal via access_count)** compose cleanly IF:
- `access_count` is written batch-async to `access_log` table (append-only, no row locks)
- Decay formula JOINs `access_log` aggregate at query time, not inline updates
- The join is bounded because it happens AFTER LanceDB narrows top-K to ~200 candidates
- Phase 1 DoD includes a query-plan test that proves this join uses an index

**C (vertical partitioning) + B (formula)** compose cleanly IF:
- Kind-specific tables expose their own `ranking_score` subquery
- The unified view on top does `SELECT * FROM (SELECT *, score FROM facts UNION ALL SELECT *, score FROM memory_episodic) ORDER BY score`
- Each kind's formula can weight factors differently (procedural's `success_rate` replaces `emotional_intensity`)
- Zero NULL COALESCE required because each physical table has its own column set

**D (hook contract) + outbox protocol** compose cleanly IF:
- `compost hook` writes to the adapter's outbox.db with deterministic idempotency_key
- No separate task registry — the adapter's outbox IS the task registry
- Daemon replay semantics from debate #1 are unchanged

**Conflict that does NOT exist**: D cold-start vs B formula evaluation — these run in different processes on different paths (write vs read), they don't interact.

---

## Final paragraph — if forced to ship 2 of 4

If forced to ship Compost v2 tomorrow with only 2 of these 4 decisions, I pick **A (with refinements)** and **C (reframed as vertical partitioning with kind-specific tables)**.

Rationale:
- **A eliminates an entire background-job subsystem** Compost would otherwise have to build and operate. That is the largest single simplification in the debate.
- **C sets the storage architecture before any data is written**. Changing physical table layout after Phase 2 is painful. Getting the vertical partitioning right on day one is nearly free.
- **B can wait** because Phase 1 only needs `w1 * semantic_similarity` which is just cosine distance — no new infrastructure. The full 7-factor formula is a Phase 2+ upgrade.
- **D can wait** because the debate #1 outbox protocol works as-is. The hook shim is a latency optimization for one specific host, not a foundational decision.

This differs from Sonnet's pick (A+D) because I think the storage architecture decision is more load-bearing than the adapter implementation detail. It differs from Codex's pick (A+B) because B needs query history we don't have yet. It differs from Gemini's pick (C+D) because I think A is the highest-leverage simplification in the entire proposal.

Opus R1 complete. Ready for R2 cross-critique.
