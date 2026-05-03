-- Migration 0021 — v4 Phase 2 action_log foundation
--
-- Compost v4 is the metacognitive layer above Engram, Obsidian, git, and
-- agent sessions. action_log is the normalized action surface that later
-- processors populate from raw observations; it does not replace observations
-- or facts.
--
-- The migrator wraps each file in BEGIN IMMEDIATE/COMMIT; do NOT include own
-- transaction control here.

CREATE TABLE action_log (
  action_id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL CHECK(length(trim(source_system)) > 0),
  source_id TEXT NOT NULL CHECK(length(trim(source_id)) > 0),
  source_observe_id TEXT REFERENCES observations(observe_id) ON DELETE SET NULL,
  who TEXT NOT NULL CHECK(length(trim(who)) > 0),
  what_text TEXT NOT NULL CHECK(length(trim(what_text)) > 0),
  when_ts TEXT NOT NULL DEFAULT (datetime('now')),
  project TEXT,
  artifact_locations TEXT
    CHECK(artifact_locations IS NULL OR json_valid(artifact_locations)),
  coverage_audit TEXT
    CHECK(coverage_audit IS NULL OR json_valid(coverage_audit)),
  next_query_hint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_system, source_id)
);

CREATE INDEX idx_action_log_when ON action_log(when_ts DESC);
CREATE INDEX idx_action_log_project ON action_log(project, when_ts DESC);
CREATE INDEX idx_action_log_source ON action_log(source_system, source_id);
CREATE INDEX idx_action_log_observe ON action_log(source_observe_id);
