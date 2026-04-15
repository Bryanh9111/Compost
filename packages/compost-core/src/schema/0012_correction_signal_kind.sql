-- Migration 0012_correction_signal_kind.sql
-- Source: debates/003-p0-readiness/synthesis.md Pre-P0 fix #4 (2026-04-14)
-- Bug: 0010 created health_signals.kind CHECK with 5 values but P0-5 needs to
-- write 'correction_candidate' from correction-detector. Sonnet R1 + Codex R1
-- independently identified — would cause runtime constraint violation.
--
-- SQLite cannot ALTER existing CHECK constraint in place — must rebuild table.
-- Safe: no production rows yet at this revision.

DROP TABLE IF EXISTS health_signals;
CREATE TABLE health_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN (
    'stale_fact',                  -- fact past freshness threshold
    'unresolved_contradiction',    -- conflict_group with no superseded_by, > N days old
    'stuck_outbox',                -- outbox row not drained for > M hours
    'orphan_delta',                -- new orphan facts vs baseline > 5
    'stale_wiki',                  -- wiki_pages.last_synthesis_at past threshold
    'correction_candidate'         -- correction-detector found facts to review (P0-5)
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  target_ref TEXT,                 -- fact_id / wiki_page_path / outbox_id / correction_event_id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_health_signals_unresolved
  ON health_signals(created_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_health_signals_kind
  ON health_signals(kind, created_at);
