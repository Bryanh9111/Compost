-- Migration 0003_stateless_decay.sql
-- Source: compost-v2-spec.md §1.3 (from debate #4 A)
-- Alters: facts (decay anchor columns)
-- Creates: access_log

-- Decay anchor on facts (separate from created_at which is rebuild identity)
ALTER TABLE facts ADD COLUMN last_reinforced_at_unix_sec INTEGER NOT NULL DEFAULT (unixepoch());
ALTER TABLE facts ADD COLUMN half_life_seconds INTEGER NOT NULL DEFAULT 2592000;  -- 30 days

-- Append-only access log (batched, no inline writes)
CREATE TABLE access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  accessed_at_unix_sec INTEGER NOT NULL DEFAULT (unixepoch()),
  query_id TEXT,
  ranking_profile_id TEXT
);
CREATE INDEX idx_access_log_fact ON access_log(fact_id);
CREATE INDEX idx_access_log_time ON access_log(accessed_at_unix_sec);
