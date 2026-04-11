# Fresh-Eyes Spec Review: compost-v2-spec.md

Reviewer: Claude Sonnet 4.6 (fresh eyes, no debate history read)
Date: 2026-04-11

---

## 1. Shippability Verdict

**SHIP WITH REQUIRED CHANGES** — The concept is sound and the schema work is thorough, but three specific issues must be resolved before a dev touches implementation: a broken SQLite scalar UDF reference in the canonical query SQL, an unspecified outbox drain contract that Phase 0 DoD depends on, and a hard delete in `reflect()` that violates the FK chain without specifying cascade order.

---

## 2. Top 3 Concerns

### Concern 1: `semantic_similarity(f.fact_id)` is an undefined SQLite UDF (§5.1, lines 759-766)

The Stage-2 rerank SQL in §5.1 calls `semantic_similarity(f.fact_id)` as if it were a registered SQLite scalar function. SQLite has no such built-in. The spec never defines where this function comes from, how the LanceDB ANN scores from Stage 1 are threaded into the SQLite query, or how `candidate_ids` (which contains the result set from LanceDB) is bound into the `IN (:candidate_ids)` clause — SQLite's parameterized queries do not accept arrays.

Failure mode: any developer who implements §5.1 literally will write broken SQL. The most natural fix (a temp table or CTE carrying `(fact_id, cosine_score)` from Stage 1 joined into Stage 2) is not specified, meaning each implementer will invent their own bridge. The `w1_semantic` column in `ranking_audit_log` (§1.4) expects this score to be captured, so whatever bridge is invented must also feed the audit path.

**Required fix**: Add a subsection to §5.1 specifying exactly how Stage-1 scores cross the LanceDB-to-SQLite boundary (e.g., temp table, JSON blob, or application-side join), and replace `semantic_similarity(f.fact_id)` with the actual expression that reads from it.

### Concern 2: Outbox drain protocol is unspecified but Phase 0 DoD requires it (§3b.2, §11)

§3b.2 says `compost-daemon` "drains `~/.compost/adapters/claude-code/outbox.db`" and §11 DoD item 4 asserts "Outbox persistence across daemon restart - kill daemon mid-send -> restart daemon -> outbox event appears in L0 exactly once." But nowhere in the spec is the drain loop defined: polling interval, crash-recovery cursor, how the daemon detects a new outbox row, idempotency on drain (the `observe_outbox` table is referenced in §3b.2 but never defined - no DDL, no column list), or what the daemon does if the Python subprocess fails mid-drain.

The non-Claude-Code outbox in §3.2 says "Same as phase0-spec.md §3" — a forward reference to a superseded document that the reader is not supposed to consult. Phase 0 can't be implemented without this contract.

**Required fix**: Add a §3b.5 defining: (1) `observe_outbox` DDL (columns, indices), (2) drain polling mechanism (interval or file-watch), (3) drain cursor/ack column so restarts are idempotent, (4) failure handling when the downstream `observations` INSERT fails.

### Concern 3: `reflect()` hard-DELETEs `observations` with FK children (§8.4, lines 909-914)

The sensory-GC in §8.4 runs:
```sql
DELETE FROM observations
WHERE captured_at < datetime('now', '-7 days')
  AND source_id IN (SELECT id FROM source WHERE kind = 'sensory')
```

`observations` is the FK parent of `ingest_queue` (ON DELETE not specified in §1.1, defaults to RESTRICT), `derivation_run` (ON DELETE CASCADE per §1.2), `captured_item` (no ON DELETE in §1.1), and `wiki_page_observe` (ON DELETE CASCADE per §1.2). With `PRAGMA foreign_keys = ON` (required by §1.1), this DELETE will hard-fail on any row that still has an `ingest_queue` or `captured_item` child, silently under-deleting without any error surfacing to the caller. The `ReflectionReport` struct returns only `sensoryDeleted` count - there is no field for "skipped due to FK violation."

**Required fix**: Specify ON DELETE behavior for `ingest_queue.observe_id` and `captured_item.observe_id` FK constraints, or add a pre-GC cleanup step in `reflect()` that removes child rows before the parent DELETE, and add a `gcBlocked` field to `ReflectionReport`.

---

## 3. Internal Inconsistencies

1. **`compost.feedback` tool phase mismatch**: §6 table says `compost.feedback` is Phase 1. §11 DoD non-functional section says "`ranking_audit_log` table exists (Phase 0 does not write to it)". §5 Compost interface includes `feedback()` as a first-class method. But §6 also says "Phase 0 implements: `compost.observe`, `compost.query`, `compost.reflect`" - no mention of `feedback`. The `compost feedback <query-id> <fact-id>` CLI subcommand is listed in §0 as a day-one CLI command. Contradictory signals about whether this ships in Phase 0 or 1.

2. **`ranking_audit_log` write condition**: §8.3 says "Per-query `ranking_audit_log` with `result_selected` telemetry from Phase 1 onward" (non-negotiable). §5.1 code writes to `ranking_audit_log` conditionally: `if (opts.debug_ranking || shouldSample())`. Those two statements conflict - one says always-write from Phase 1, the other says sample. No definition of `shouldSample()` sampling rate or behavior is given anywhere in the spec.

3. **`access_log` index missing on `fact_id` for the rerank LEFT JOIN**: §1.3 migration 0003 creates `idx_access_log_fact ON access_log(fact_id)` and `idx_access_log_time ON access_log(accessed_at_unix_sec)`. The Stage-2 rerank JOIN aggregates `COUNT(*) GROUP BY fact_id` - the index on `fact_id` covers this. This one is actually fine. Noting it as checked.

4. **`contexts` column in `QueryHit` has no join path**: §5 defines `QueryHit.contexts: string[]` as a returned field (line 723). The `facts` table (§1.1) has no `contexts` column - it was explicitly removed in debate #3 in favor of the `fact_context` join table. The Stage-2 SQL in §5.1 selects `f.*` from `facts` - it never joins `fact_context`. So `r.contexts` on line 790 reads from a column that does not exist on the `facts` table. This will be `undefined` at runtime.

5. **`reference-survey-claude-code-source.md` referenced but not in docs/**: §3b.1 cites "Claude Code's hook payload format per `reference-survey-claude-code-source.md`" as the source of truth for parsing stdin. This file does not appear in the project layout (§0) and is not listed in the `docs/` directory tree. If this document doesn't exist, implementers have no authoritative hook payload format to code against.

---

## 4. Missing Pieces

**Python subprocess failure handling in the ingest pipeline**: §4 specifies the CLI contract (stdin/stdout JSON) but gives no spec for: timeout on the Python process, behavior when `compost_ingest` returns non-zero exit code, behavior when it returns malformed JSON, or retry policy. Phase 0 DoD item "compost add `<markdown-file>` writes to L0 + enqueues + runs Python extraction + stores chunks" will be impossible to implement robustly without this. Every developer will invent their own timeout value and error path.

**`~/.compost/` permissions model**: The spec (§9, §10) mandates local disk, detects sync services, but never specifies file permissions. `~/.compost/ledger.db` contains potentially sensitive personal knowledge. If `install.sh` creates the dir with default umask (typically 022), it becomes world-readable. With `PRAGMA foreign_keys = ON` and WAL mode, any process on the machine can read the WAL files. The spec should specify `chmod 700 ~/.compost` at minimum.

**`compost-daemon` process supervision**: §11 DoD requires daemon start/stop/status via `compost daemon`. The spec says nothing about what happens when the daemon crashes - no PID file spec, no socket path, no supervisor integration, no startup idempotency (what if you run `compost daemon start` twice). A developer implementing this has zero guidance.

**No test strategy for the hook shim cold-start measurement**: §3b.3 says "Phase 0 DoD requires: `compost doctor --measure-hook` reports p50 and p95 cold-start." But there is no spec for how this measurement is taken - what the benchmark harness looks like, how many samples constitute a valid p95, whether it tests against the actual `compost hook` binary or a synthetic harness. This is a ship-gate criterion with no defined measurement methodology.

---

## 5. Personal Sign-off

I would not approve this for coding today, but I'm close. The spec is genuinely impressive in depth - the schema migrations are meticulous, the cognitive tier model is coherent, and the staging schedule is sensible. The issues that block me are not architectural hand-waving; they're specific implementation gaps that will produce divergent implementations across the codebase. The `semantic_similarity()` UDF problem in §5.1 is the most dangerous: it's in the canonical query code that every developer will copy, and it will compile fine in TypeScript while being dead wrong at the SQLite layer. The missing `fact_context` join in `QueryHit` is a second silent runtime bug in the same function. Fix those two, add the `observe_outbox` DDL and drain protocol, and this spec is ready to code against. Estimated fix effort: half a day to write two missing subsections and correct the SQL. The rest of the spec earns its complexity.
