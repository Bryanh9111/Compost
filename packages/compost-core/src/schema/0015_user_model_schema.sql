-- Migration 0015_user_model_schema.sql
-- Source: docs/phase-5-user-model-design.md + debate 020 synthesis (Compost side)
--
-- Purpose:
--   Ships schema for the derived half of the user model (patterns inferred
--   from observations + facts). Raw user state (preference / goal / habit)
--   stays on the Engram side per anchor v2. Compost owns synthesized
--   patterns with provenance chains back to observations.
--
-- Phase alignment:
--   - Phase 5: schema only, no data written (this migration).
--   - Phase 7: pattern-detection policies populate these tables.
--   - Phase 7+: review UX (`compost user-model list / confirm`).
--
-- Notable deviations from docs/phase-5-user-model-design.md:
--   - Added `project TEXT` (nullable) on user_patterns. Design doc open
--     sub-question 1 leaned this way; shipping now avoids a later ALTER.
--     NULL = cross-project pattern; matches Engram scope semantics.
--   - user_verdict CHECK omits NULL from the IN list. SQLite CHECK passes
--     NULL automatically (NULL comparison yields NULL, not FALSE), so
--     `CHECK(user_verdict IN (NULL, ...))` in the design doc was a no-op
--     on NULL and would have rejected NULLs if SQLite tightened semantics.

-- Inferred patterns about the user. One row per detected pattern.
CREATE TABLE user_patterns (
  pattern_id TEXT PRIMARY KEY,
  pattern_kind TEXT NOT NULL
    CHECK(pattern_kind IN (
      'writing_style',
      'decision_heuristic',
      'blind_spot',
      'recurring_question',
      'skill_growth'
    )),
  description TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'stale', 'contradicted', 'user_rejected')),

  -- Decay: patterns fade if evidence stops accumulating.
  observed_count INTEGER NOT NULL DEFAULT 1,
  first_observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_reinforced_at_unix_sec INTEGER NOT NULL,
  half_life_seconds INTEGER NOT NULL DEFAULT 7776000,

  -- Provenance: every pattern must trace back to specific observations.
  derived_from_fact_ids TEXT,
  derivation_policy TEXT NOT NULL,

  -- Engram coupling: matching Engram user-kind memory, if any.
  engram_memory_id TEXT,

  -- User review state.
  user_reviewed_at TEXT,
  user_verdict TEXT
    CHECK(user_verdict IN ('confirmed', 'rejected', 'refined')),

  -- Scope: NULL = cross-project. Mirrors Engram scope semantics.
  project TEXT
);

CREATE INDEX idx_user_patterns_kind_status
  ON user_patterns(pattern_kind, status, last_reinforced_at_unix_sec);

CREATE INDEX idx_user_patterns_engram
  ON user_patterns(engram_memory_id) WHERE engram_memory_id IS NOT NULL;

CREATE INDEX idx_user_patterns_project_kind
  ON user_patterns(project, pattern_kind) WHERE project IS NOT NULL;

-- Many-to-many link from patterns to the observations that evidence them.
-- Parallel to fact_links. GC of observations cascades here.
CREATE TABLE user_pattern_observations (
  pattern_id TEXT NOT NULL
    REFERENCES user_patterns(pattern_id) ON DELETE CASCADE,
  observe_id TEXT NOT NULL
    REFERENCES observations(observe_id) ON DELETE CASCADE,
  evidence_strength REAL NOT NULL DEFAULT 0.5,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pattern_id, observe_id)
);

CREATE INDEX idx_pattern_obs_observe
  ON user_pattern_observations(observe_id);

-- Append-only log of pattern state changes. Reconstruct user-model evolution
-- for Phase 7 "why did you think X?" audits.
CREATE TABLE user_pattern_events (
  event_id TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL
    REFERENCES user_patterns(pattern_id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL
    CHECK(event_kind IN (
      'created', 'reinforced', 'contradicted',
      'confidence_updated', 'status_changed', 'user_reviewed'
    )),
  event_data TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pattern_events_pattern
  ON user_pattern_events(pattern_id, occurred_at);
