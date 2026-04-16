-- Migration 0010_phase4_myco_integration.sql
-- Source: debates/001-myco-integration/synthesis_v2.md (2026-04-14)
-- Phase 4 Batch D: 5 P0 schema additions from Myco design distillation
--
-- P0-1: health_signals — boot-time triage surface (6 signal kinds with 0012 amendment, no auto-execute)
-- P0-2: decision_audit — high-cost decision audit trail with confidence ladder
-- P0-3: graph_health_snapshot + v_graph_health view — structural decay perception
-- P0-4: facts.archive_reason / replaced_by_fact_id / revival_at — compression 3-criteria
-- P0-5: correction_events — explicit self-correction signal capture

------------------------------------------------------------------
-- P0-1: health_signals (compost triage surface)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN (
    'stale_fact',                  -- fact past freshness threshold
    'unresolved_contradiction',    -- conflict_group with no superseded_by, > N days old
    'stuck_outbox',                -- outbox row not drained for > M hours
    'orphan_delta',                -- new orphan facts vs baseline > 5
    'stale_wiki'                   -- wiki_pages.last_synthesis_at past threshold
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  target_ref TEXT,                 -- fact_id / wiki_page_path / outbox_id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT                 -- 'user' / 'agent' / 'auto-cleared'
);

CREATE INDEX IF NOT EXISTS idx_health_signals_unresolved
  ON health_signals(created_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_health_signals_kind
  ON health_signals(kind, created_at);

------------------------------------------------------------------
-- P0-2: decision_audit (confidence ladder + write-path audit trail)
------------------------------------------------------------------
-- Confidence floor convention (see synthesis_v2 §P0-2):
--   kernel       = 0.90  (schema / ranking profile / talking profile changes)
--   instance     = 0.85  (fact merge / wiki L3 rebuild / fact excretion)
--   exploration  = 0.75  (default capture / heuristic suggestions)
CREATE TABLE IF NOT EXISTS decision_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN (
    'contradiction_arbitration',
    'wiki_rebuild',
    'fact_excretion',
    'profile_switch'
  )),
  target_id TEXT NOT NULL,         -- fact_id / wiki_path / profile_id (TEXT for cross-table refs)
  confidence_floor REAL NOT NULL CHECK (confidence_floor IN (0.90, 0.85, 0.75)),
  confidence_actual REAL NOT NULL CHECK (confidence_actual >= 0.0 AND confidence_actual <= 1.0),
  rationale TEXT,                  -- short note (≤ 200 chars by convention; not enforced)
  evidence_refs_json TEXT,         -- JSON array of fact_ids / observe_ids
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by TEXT NOT NULL CHECK (decided_by IN ('reflect', 'wiki', 'user', 'agent'))
);

CREATE INDEX IF NOT EXISTS idx_decision_audit_kind ON decision_audit(kind, decided_at);
CREATE INDEX IF NOT EXISTS idx_decision_audit_target ON decision_audit(target_id);

------------------------------------------------------------------
-- P0-3: graph_health_snapshot (daily structural metrics; view is below)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS graph_health_snapshot (
  taken_at TEXT PRIMARY KEY DEFAULT (datetime('now')),
  total_facts INTEGER NOT NULL,
  orphan_facts INTEGER NOT NULL,             -- facts older than 24h with no fact_links edges
  density REAL NOT NULL,                     -- edges / nodes (Phase 4 fact_links graph)
  cluster_count INTEGER NOT NULL,            -- connected components count
  stale_cluster_count INTEGER NOT NULL DEFAULT 0  -- clusters with all facts older than 90d
);

-- v_graph_health: convenience view for current-state read
-- NOTE: This view is a stub. It will be implemented in P0-3 follow-up
-- once fact_links table from Phase 4 fact-graph subtask lands.
-- For now it returns NULL graph metrics so callers don't break.
CREATE VIEW IF NOT EXISTS v_graph_health AS
SELECT
  (SELECT COUNT(*) FROM facts WHERE archived_at IS NULL) AS total_facts,
  NULL AS orphan_facts,           -- stub; superseded by migration 0011 (fact_links-backed view)
  NULL AS density,
  NULL AS cluster_count,
  datetime('now') AS computed_at;

------------------------------------------------------------------
-- P0-4: facts.archive_reason + replaced_by_fact_id + revival_at
-- (compression 3-criteria: frequency, recency, exclusivity)
------------------------------------------------------------------
ALTER TABLE facts ADD COLUMN archive_reason TEXT
  CHECK (archive_reason IS NULL OR archive_reason IN (
    'stale',          -- recency: age > 90d AND access_count_30d = 0
    'superseded',     -- replaced by newer fact (already covered by superseded_by)
    'contradicted',   -- conflict_group resolution chose another fact
    'duplicate',      -- exclusivity: same subject + similarity > 0.92, lower confidence
    'low_access',     -- frequency: never accessed in 60+ days
    'manual'          -- user-driven excretion
  ));

ALTER TABLE facts ADD COLUMN replaced_by_fact_id TEXT
  REFERENCES facts(fact_id);

ALTER TABLE facts ADD COLUMN revival_at TEXT;  -- if archived fact gets re-captured

CREATE INDEX IF NOT EXISTS idx_facts_archive_reason
  ON facts(archive_reason) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_facts_replaced_by
  ON facts(replaced_by_fact_id) WHERE replaced_by_fact_id IS NOT NULL;

------------------------------------------------------------------
-- P0-5: correction_events (self-correction signal capture)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS correction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,                 -- claude session id from hook env
  retracted_text TEXT NOT NULL,    -- what user said was wrong
  corrected_text TEXT,             -- what user said instead (optional, may be on later turn)
  related_fact_ids_json TEXT,      -- JSON array — facts whose confidence should be reduced
  pattern_matched TEXT,            -- which regex pattern triggered (debug/audit)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT                -- when reflect() consumed this event
);

CREATE INDEX IF NOT EXISTS idx_correction_events_unprocessed
  ON correction_events(created_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_correction_events_session
  ON correction_events(session_id, created_at);

------------------------------------------------------------------
-- Migration footer: bump schema_version
------------------------------------------------------------------
-- (handled by migrator.ts — no-op in this file)
