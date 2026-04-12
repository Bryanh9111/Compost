-- Migration 0004_probabilistic_ranking.sql
-- Source: compost-v2-spec.md §1.4 (from debate #4 B)
-- Creates: ranking_profile, ranking_audit_log

CREATE TABLE ranking_profile (
  profile_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  w1_semantic REAL NOT NULL DEFAULT 1.2,
  w2_temporal REAL NOT NULL DEFAULT 0.0,
  w3_access REAL NOT NULL DEFAULT 0.0,
  w4_importance REAL NOT NULL DEFAULT 0.0,
  w5_emotional REAL NOT NULL DEFAULT 0.0,
  w6_repetition_penalty REAL NOT NULL DEFAULT 0.0,
  w7_context_mismatch REAL NOT NULL DEFAULT 0.0,
  access_saturation INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_by TEXT REFERENCES ranking_profile(profile_id)
);

-- Seed with Phase 1 default (only w1 active):
INSERT INTO ranking_profile (profile_id, name, w1_semantic)
VALUES ('rp-phase1-default', 'Phase 1 semantic only', 1.2);

CREATE TABLE ranking_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES ranking_profile(profile_id),
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,  -- v2.2: cascade so sensory GC can proceed
  queried_at_unix_sec INTEGER NOT NULL,
  rank_position INTEGER NOT NULL,
  w1_semantic REAL,
  w2_temporal REAL,
  w3_access REAL,
  w4_importance REAL,
  w5_emotional REAL,
  w6_repetition_penalty REAL,
  w7_context_mismatch REAL,
  final_score REAL NOT NULL,
  result_selected BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_audit_query ON ranking_audit_log(query_id);
CREATE INDEX idx_audit_fact ON ranking_audit_log(fact_id);
