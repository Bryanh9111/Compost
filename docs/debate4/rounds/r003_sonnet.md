# Debate #4 — Round 3: Pragmatic Implementer (Sonnet 4.6) — FINAL POSITIONS

**Role**: Pragmatic Implementer — ships this, debugs it at 2am
**Date**: 2026-04-11

---

## Final scores

| Decision | R1 | R2 | R3 | Change R2->R3 |
|---|---|---|---|---|
| A (stateless decay) | 2/3 | 2/3 | 2/3 | None |
| B (multi-factor ranking) | 1/3 | 2/3 | 2/3 | None |
| C (physical layout) | 1/3 | 2/3 | 2/3 | None |
| D (hook contract) | 2/3 | 2/3 | 2/3 | None — but Q2 position revised |

---

## Q1 resolution — Dual-emit (maintained)

**Final position: dual-emit wins. Single-emit-with-promotion is wrong.**

Opus's promotion rule is deterministic at write time but creates a retrieval gap that cannot be patched at query time without significant complexity. When a memory is promoted from semantic to episodic-only, it disappears from `compost.query`'s semantic path unless every query site joins across both tables by default. That join is not free and it makes "semantic search" a misnomer — you can't know whether a missing result was never ingested or was promoted. Dual-emit preserves the invariant: `compost.query` over the `facts` table will always find what the extractor found semantically meaningful, regardless of whether it also has episodic character. The episodic record is additive context, not a replacement. Shared `observe_id` between both records lets any query site correlate them without duplication cost. The write-path overhead is one additional INSERT on promotion-eligible records — acceptable.

---

## Q2 resolution — Synchronous append mandatory (Codex position adopted)

**Final position: Codex is right. Synchronous outbox append is mandatory. Async-true is not acceptable.**

I accepted Opus's Option 2 in R2 because it solved the double-write hazard I named. Codex's R2 attack is more fundamental and I was wrong to overlook it: `{async: true}` means the hook has acknowledged an event that may not yet be durable. If the detached child dies between hook exit and outbox write — OOM, SIGKILL, disk full — the event is silently lost with no retry path. This is not a theoretical failure mode; it is the exact scenario that outbox-pattern architecture exists to prevent. A hook that acks before durability is not a hook — it is a fire-and-forget notification with a durability theater wrapper.

**Required mitigation for cold-start**: Option (a) — a minimal Node entry point that loads ONLY `better-sqlite3` (no TypeScript bootstrap, no workspace deps, no config loading). Target: cold start ≤ 15ms + 5ms write = ≤ 20ms total. This is achievable: `better-sqlite3` loads in ~8ms on modern hardware with SQLite pre-compiled. The fat Node startup cost comes from TypeScript runtime + workspace dep resolution, not SQLite. A dedicated `packages/compost-hook-shim/index.cjs` pre-bundled with `esbuild --bundle --platform=node` with only the SQLite append path eliminates this. Phase 2 upgrade to Go/Rust binary if 20ms budget is still violated in production.

---

## What I require in the final spec (one sentence per decision)

**A**: The spec must declare `half_life_seconds` as a per-fact column set by transform_policy, `last_reinforced_at_unix_sec` as the decay anchor, `:as_of_unix_sec` as a required query bind parameter, and a sensory-tier hard-GC TTL (7 days default) executed by `compost reflect`.

**B**: The spec must commit to `ranking_audit_log` with `result_selected: boolean` settable via `compost feedback`, required from Phase 1 even when only `w1` is active, so Phase 2 weight calibration has signal.

**C**: The spec must mandate dual-emit with shared `observe_id` for records that meet temporal+participant promotion criteria, with both records written in the same transaction and resolved via UNION view at query time.

**D**: The spec must mandate that `compost hook` performs a synchronous SQLite append before returning any success response, implemented as a pre-bundled CJS shim (`esbuild --bundle`) that loads no workspace dependencies beyond `better-sqlite3`.

---

## Tie-break statement

On Q1 (dual-emit vs single-emit): I will not concede. The retrieval gap from single-emit-with-promotion is a correctness issue, not a preference issue. If Opus synthesizes a compromise, it must guarantee that `compost.query` over semantic records never silently misses a promoted-to-episodic-only record. If the synthesis achieves that guarantee, I accept it. If it does not, the spec is wrong and I require this be documented as an open risk.

On Q2 (sync-append mandatory): I will not concede on the principle. Durability before ack is non-negotiable for an outbox pattern. I concede on the implementation: if the bundled-CJS-shim approach is rejected as toolchain complexity, I accept Go/Rust binary (Codex's preferred path) as the alternative. What I will not accept is moving the append behind the ack boundary.
