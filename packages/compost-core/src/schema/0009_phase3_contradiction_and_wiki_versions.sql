-- Migration 0009_phase3_contradiction_and_wiki_versions.sql
-- Source: Debate 9 synthesis (2026-04-13)
-- Creates: wiki_page_versions table, indexes for contradiction tracking

-- 1. Wiki page versioning: snapshot before rewrite
CREATE TABLE IF NOT EXISTS wiki_page_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
  content TEXT NOT NULL,
  synthesis_model TEXT,
  snapshot_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wiki_versions_page ON wiki_page_versions(page_path);

-- 2. Indexes for contradiction tracking (columns already exist in 0001_init)
CREATE INDEX IF NOT EXISTS idx_facts_superseded ON facts(superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_facts_conflict_group ON facts(conflict_group) WHERE conflict_group IS NOT NULL;
