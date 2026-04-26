-- Migration 0020 — Phase 7 L5 hybrid scheduler state (debate 026)
--
-- Single-row state table. INSERT one row at migration time, UPDATE thereafter.
-- The CHECK(id=1) clause enforces singleton at the SQL layer; no app-side
-- locking needed.
--
-- Columns rationale (debate 026 §Q4 (A) 4/4 unanimous):
--   paused                  : hard gate (manual or auto-cooldown). 0=running, 1=paused.
--   paused_reason           : human-readable why ("verdict cooldown: 6/10 rejected", "user")
--   paused_at               : ISO timestamp; used by 7d auto-resume check (Opus addition)
--   last_cycle_at           : ISO timestamp of most recent runCycle() invocation
--   last_cycle_stats_json   : {triggered_at, chains_attempted, chains_succeeded,
--                              chains_skipped_idempotent, seeds_selected,
--                              gate_decision} — captures cycle outcome
--   consecutive_skipped_cycles : counts soft-skip transitions toward hard pause.
--                              Reset to 0 on any successful cycle. Triggers hard
--                              pause at K=4 (debate 026 §Q3 (iv) double-layer)
--
-- Why SQLite over JSON file (Codex argument): WAL gives cross-process safety
-- between daemon (writes) and CLI (reads + manual pause/resume); backup/restore
-- inherits the ledger path; no second-truth reconciliation problem.
--
-- The migrator wraps each file in BEGIN IMMEDIATE/COMMIT; do NOT include own
-- transaction control here.

CREATE TABLE reasoning_scheduler_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0, 1)),
  paused_reason TEXT,
  paused_at TEXT,
  last_cycle_at TEXT,
  last_cycle_stats_json TEXT
    CHECK(last_cycle_stats_json IS NULL OR json_valid(last_cycle_stats_json)),
  consecutive_skipped_cycles INTEGER NOT NULL DEFAULT 0
    CHECK(consecutive_skipped_cycles >= 0)
);

INSERT INTO reasoning_scheduler_state (id) VALUES (1);
