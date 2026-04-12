-- Migration 0006_chunks_and_fts5.sql
-- Source: Debate 7 synthesis (2026-04-12)
-- Creates: chunks (L1 manifest for rebuild/reconcile), facts_fts (BM25 index)
--
-- chunks table provides the authoritative mapping from (observe_id, transform_policy, chunk_id)
-- to LanceDB rows. This enables compost doctor --rebuild L1 to detect drift and do
-- incremental reconciliation. Without this table, rebuild can only full-rewrite.
--
-- facts_fts is a FTS5 virtual table for BM25 keyword search. Phase 1 maintains the index
-- on INSERT but sets w_bm25 weight = 0.0. Phase 2 activates BM25 in hybrid candidate generation.

CREATE TABLE chunks (
  chunk_id TEXT PRIMARY KEY,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  derivation_id TEXT NOT NULL REFERENCES derivation_run(derivation_id),
  chunk_index INTEGER NOT NULL,
  text_content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  transform_policy TEXT NOT NULL,
  embedded_at TEXT,  -- NULL until embedding written to LanceDB; set by Step 4c
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(observe_id, chunk_index, transform_policy)
);

CREATE INDEX idx_chunks_observe ON chunks(observe_id);
CREATE INDEX idx_chunks_derivation ON chunks(derivation_id);
CREATE INDEX idx_chunks_not_embedded ON chunks(created_at) WHERE embedded_at IS NULL;

-- FTS5 external content table backed by facts.
-- We use a content-less (external content) FTS5 table to avoid doubling storage.
-- Inserts/deletes must be manually kept in sync (via triggers below).
CREATE VIRTUAL TABLE facts_fts USING fts5(
  subject,
  predicate,
  object,
  content='facts',
  content_rowid='rowid'
);

-- Triggers to keep FTS5 in sync with facts table.
-- On INSERT: add to FTS index
CREATE TRIGGER facts_fts_insert AFTER INSERT ON facts BEGIN
  INSERT INTO facts_fts(rowid, subject, predicate, object)
  VALUES (new.rowid, new.subject, new.predicate, new.object);
END;

-- On DELETE: remove from FTS index
CREATE TRIGGER facts_fts_delete AFTER DELETE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, subject, predicate, object)
  VALUES ('delete', old.rowid, old.subject, old.predicate, old.object);
END;

-- On UPDATE: remove old, add new
CREATE TRIGGER facts_fts_update AFTER UPDATE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, subject, predicate, object)
  VALUES ('delete', old.rowid, old.subject, old.predicate, old.object);
  INSERT INTO facts_fts(rowid, subject, predicate, object)
  VALUES (new.rowid, new.subject, new.predicate, new.object);
END;
