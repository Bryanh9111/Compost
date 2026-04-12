-- Migration 0007_phase2_search.sql
-- Source: Debate 8 synthesis (2026-04-12)
-- Creates: web_fetch_state, rp-phase2-default profile
-- Fixes: FTS5 backfill for pre-existing facts

-- 1. FTS5 backfill: rebuild the full-text index from all existing facts.
-- Phase 1 triggers only sync new writes; pre-existing facts are missing.
-- 'rebuild' is a special FTS5 command that repopulates from the content table.
INSERT INTO facts_fts(facts_fts) VALUES('rebuild');

-- 2. Web fetch state table for freshness loop.
-- Stores ETag/Last-Modified/scheduling state per web source.
CREATE TABLE web_fetch_state (
  source_id TEXT PRIMARY KEY REFERENCES source(id) ON DELETE CASCADE,
  etag TEXT,
  last_modified TEXT,
  last_fetched_at_unix_sec INTEGER,
  next_check_at_unix_sec INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  backoff_until_unix_sec INTEGER,
  last_status_code INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_wfs_next_check
  ON web_fetch_state(next_check_at_unix_sec)
  WHERE backoff_until_unix_sec IS NULL OR backoff_until_unix_sec < next_check_at_unix_sec;

-- 3. Phase 2 default ranking profile: activate w2_temporal + w3_access.
INSERT INTO ranking_profile (profile_id, name, w1_semantic, w2_temporal, w3_access)
VALUES ('rp-phase2-default', 'Phase 2 semantic + temporal + access', 1.2, 0.15, 0.1);
