-- Migration 0001_init.sql
-- Source: compost-v2-spec.md §1.1 (phase0-spec.md + debate #3 preserved)
-- Creates: source, observations, ingest_queue, expected_item, captured_item, facts, wiki_pages

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- Source registry
CREATE TABLE source (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('local-file','local-dir','web','claude-code','host-adapter','sensory')),
  refresh_sec INTEGER,
  coverage_target REAL DEFAULT 0.0,
  trust_tier TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_tier IN ('user','first_party','web')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paused_at TEXT
);

-- Observations: immutable append-only ledger (the rebuild anchor)
CREATE TABLE observations (
  observe_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(id),
  source_uri TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_hash TEXT NOT NULL,
  raw_bytes BLOB,
  blob_ref TEXT,
  mime_type TEXT NOT NULL,
  adapter TEXT NOT NULL,
  adapter_sequence INTEGER NOT NULL,
  trust_tier TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  transform_policy TEXT NOT NULL,
  metadata JSON,
  UNIQUE(adapter, source_id, idempotency_key)
);

CREATE INDEX idx_obs_source ON observations(source_id, captured_at);
CREATE INDEX idx_obs_content_hash ON observations(content_hash);

-- Ingest queue (lease columns added in 0002)
-- NOTE: ON DELETE CASCADE on observe_id so that `compost reflect` sensory GC
-- can hard-delete observations without RESTRICT-blocking on pending queue rows.
-- Sensory observations that still have pending queue rows are GC-eligible:
-- the queue row is dropped as a side effect of the observation being aged out.
CREATE TABLE ingest_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  priority INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  enqueued_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX idx_queue_pending ON ingest_queue(priority, enqueued_at)
  WHERE completed_at IS NULL;

-- Coverage SLO tracking
CREATE TABLE expected_item (
  source_id TEXT NOT NULL REFERENCES source(id),
  external_id TEXT NOT NULL,
  expected_at TEXT NOT NULL,
  PRIMARY KEY (source_id, external_id)
);

-- captured_item: ON DELETE CASCADE on observe_id so reflect() can GC sensory rows.
-- Losing captured_item rows for aged sensory observations is acceptable -- SLO tracking
-- does not survive past the sensory TTL window anyway.
CREATE TABLE captured_item (
  source_id TEXT NOT NULL REFERENCES source(id),
  external_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, external_id, captured_at)
);

-- L2 facts (semantic tier base; debate #3 removed contexts TEXT[] in favor of fact_context join)
-- NOTE: ON DELETE CASCADE on observe_id. Facts derived from sensory observations (which
-- expire after 7 days) are cascade-deleted. Facts derived from non-sensory observations
-- are never deleted by reflect() -- only the sensory-kind source_id cohort is GC targeted.
CREATE TABLE facts (
  fact_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  importance REAL NOT NULL DEFAULT 0.5,
  importance_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_by TEXT REFERENCES facts(fact_id),
  conflict_group INTEGER,
  archived_at TEXT  -- soft tombstone (Phase 0 sensory-GC / reflection sweep)
);

CREATE INDEX idx_facts_spo ON facts(subject, predicate);
CREATE INDEX idx_facts_observe ON facts(observe_id);
CREATE INDEX idx_facts_active ON facts(created_at) WHERE archived_at IS NULL;

-- L3 wiki page registry (actual markdown on disk; debate #3 replaced contributing_observes TEXT with wiki_page_observe)
CREATE TABLE wiki_pages (
  path TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  last_synthesis_at TEXT NOT NULL,
  last_synthesis_model TEXT NOT NULL
);
