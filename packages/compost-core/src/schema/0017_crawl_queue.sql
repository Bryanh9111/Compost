-- Migration 0017_crawl_queue.sql
-- Source: Phase 6 P0 — user-approved crawl queue
--
-- Purpose: record external sources (URLs, docs) that Compost would like
-- to ingest, awaiting explicit user approval. This slice does NOT
-- implement fetching — scope is deliberately queue-management-only so
-- the "never auto-sends requests" first-party principle is enforced by
-- code absence, not code discipline. A future slice adds
-- `compost crawl fetch` as a separate user-initiated verb.
--
-- Design:
--   - UNIQUE(url_hash) dedupes repeated proposals of the same URL (e.g.
--     curiosity agent re-proposing a source that keeps tripping a gap
--     cluster). Re-proposing updates proposed_at + rationale; does NOT
--     resurrect 'rejected' or 'forgotten' rows — users must re-propose
--     explicitly.
--   - Status transitions: 'proposed' -> 'approved' | 'rejected'. 'approved'
--     is a persistent consent record; the still-absent fetch path reads
--     it. 'forgotten' is a hard-delete label retained briefly in debug
--     logs before the row drops.
--   - `proposed_by` lets downstream consumers filter / rank (user-
--     proposed beats curiosity-proposed beats digest-proposed).

CREATE TABLE crawl_queue (
  crawl_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK(status IN ('proposed', 'approved', 'rejected')),

  proposed_by TEXT NOT NULL DEFAULT 'user',
  rationale TEXT,
  tags TEXT,

  proposed_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);

CREATE INDEX idx_crawl_queue_status
  ON crawl_queue(status, proposed_at);

CREATE INDEX idx_crawl_queue_proposed_by
  ON crawl_queue(proposed_by, status);
