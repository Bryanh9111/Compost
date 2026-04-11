# Opus — Outbox Architecture: A vs B (independent, pre-synthesis)

**Role**: moderator + participant. Writing this BEFORE reading the other three so I'm not anchored.

## Pick: **Option B — merge outbox into ledger.db**

## Rationale (load-bearing arguments)

1. **The `per-adapter isolation` invariant from debate #1 was a durability argument, not a concurrency argument.** The original reason to give each adapter its own SQLite file was: "if the core daemon crashes, the adapter's local outbox still accumulates events durably." That durability is preserved identically in Option B — `observe_outbox` as a table inside `ledger.db` still gets WAL-committed appends from `compost hook` even when the daemon is down. The daemon is a reader, not a writer, for the hook path. The adapter isolation argument doesn't justify the cross-file transaction complexity that Option A forces.

2. **SQLite's single-writer model works for us, not against us.** `compost hook` invocations, daemon drain, `compost add`, `compost reflect`, and `compost doctor` all contend for ONE write lock. But every write is microseconds: hook shim does one INSERT (5ms), drain does 3-4 statements per claimed row (10ms), reflect does a few bounded DELETEs. Even at 100 hooks/min from Claude Code (high estimate), the contention window is <1 second/min total. The `SQLITE_BUSY` fear is theoretical for this write volume. LanceDB is the actual write hotspot — and that's already behind its own file lock (§10.3). Ledger writes are not the bottleneck.

3. **The ATTACH escape is a landmine.** SQLite's ATTACH has a default limit of 10 attached DBs. Compost's long-term vision has claude-code + openclaw + hermes + airi + generic-mcp + N future adapters. The limit is recompile-time configurable to 125 but requires rebuilding better-sqlite3 with `SQLITE_MAX_ATTACHED` — which breaks the "plain npm install works" distribution story. Option A either caps the adapter count OR forks better-sqlite3. Both are bad.

4. **Codex's drain transaction correctness was the trigger, but it's not the only failure mode.** Reflect races (Codex #5), degraded flags missing (Codex #6), outbox prune during active drain (Codex) — all of these vanish when there is one database, one lock domain, one transaction scope.

## Concrete failure mode Option B survives that Option A doesn't

User has 11 active adapters (Claude Code, OpenClaw, Hermes, airi, 4 CI agents, 2 research crawlers, 1 voice agent). Daemon startup under Option A: attach adapter 1-10 works, ATTACH for adapter 11 fails with `too many attached databases`. Daemon silently drops events from the 11th adapter. Under Option B: same as adapter 1, just another row in `observe_outbox` with a different `adapter` column.

## Concrete concession (what B gives up)

- **Per-adapter backup/restore granularity.** Under A, you can `cp adapters/claude-code/outbox.db` to freeze one adapter's pending events. Under B, you dump the whole ledger. **Mitigation**: `compost export --adapter claude-code` subcommand filters the export by adapter column. Tooling, not architecture.

- **Theoretical SQLite backpressure isolation.** If one adapter's hook spams 10K events/sec, under A it contends with itself only. Under B, it blocks other adapters' writes briefly. **Mitigation**: rate limit at the hook shim, not at the storage layer. A misbehaving adapter is a bug to fix regardless of storage topology.

## Hook shim cold-start impact

Opening `~/.compost/ledger.db` vs `~/.compost/adapters/claude-code/outbox.db` — the file size matters for `mmap` cost, not open() cost. Better-sqlite3's open path is dominated by native module load (~8ms) and SQLite init (~2ms). The actual `sqlite3_open_v2` syscall is sub-millisecond regardless of file size. **p95 < 30ms gate is unaffected.** I'll verify this empirically in Phase 0 with `compost doctor --measure-hook` on the merged ledger — if it drifts > 5ms from the per-adapter version, I back out to A.

## Schema migration path (B)

Migration `0005_merge_outbox.sql` (Phase 0, in the same migration run as 0001-0004):

```sql
-- No existing adapters to migrate — Phase 0 is greenfield.
CREATE TABLE observe_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  adapter TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,                -- NEW: fixes Gemini's drain gap
  idempotency_key TEXT NOT NULL,
  payload TEXT NOT NULL,                    -- JSON ObserveEvent envelope
  appended_at TEXT NOT NULL DEFAULT (datetime('now')),
  drained_at TEXT,
  observe_id TEXT REFERENCES observations(observe_id) ON DELETE SET NULL,
  drain_error TEXT,
  drain_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_outbox_pending
  ON observe_outbox(adapter, seq)
  WHERE drained_at IS NULL AND drain_attempts <= 5;

CREATE UNIQUE INDEX idx_outbox_idempotency
  ON observe_outbox(adapter, source_id, idempotency_key);

-- Drop the per-adapter outbox.db files (none exist yet in Phase 0)
```

The drain transaction becomes:
```sql
BEGIN IMMEDIATE;
-- Step 1: claim next drainable row, respecting quarantine threshold
-- Step 2: INSERT OR IGNORE into observations
-- Step 3: INSERT into source_context (from payload.contexts)
-- Step 4: INSERT OR IGNORE into source (auto-registration for hook-generated source_ids)
-- Step 5: INSERT into ingest_queue (checking no active row first)
-- Step 6: UPDATE observe_outbox SET drained_at, observe_id, drain_error = NULL
COMMIT;
-- Failure path: UPDATE observe_outbox SET drain_attempts = drain_attempts + 1, drain_error = ?
```

All Codex's #2/#3 concerns (drain_attempts tracking, source auto-registration, source_kind presence) are fixed in one schema.

---

**Final note**: if the other three pick A unanimously, I'll concede on ecosystem grounds. But the Codex bug + the ATTACH limit + the operational simplicity of single-DB all point to B as the right architecture shift. Option A preserves an invariant (per-adapter isolation) that was a secondary goal, not a load-bearing decision. Option B trades that for protocol simplicity, which is what the v2.1 review demanded.
