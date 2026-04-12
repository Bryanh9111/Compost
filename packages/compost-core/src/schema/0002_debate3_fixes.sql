-- Migration 0002_debate3_fixes.sql
-- Source: compost-v2-spec.md §1.2 (from debate #3)
-- Creates: derivation_run, policies, context, fact_context, source_context, wiki_page_observe
-- Alters: ingest_queue (lease columns)

-- Replace derivations with derivation_run (fixes PK bug for policy-only reruns)
CREATE TABLE derivation_run (
  derivation_id TEXT PRIMARY KEY,                 -- uuid v7
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK(layer IN ('L1','L2','L3')),
  transform_policy TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '',
  context_scope_id TEXT,
  extraction_profile TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','superseded')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  artifact_ref TEXT,
  supersedes_derivation_id TEXT REFERENCES derivation_run(derivation_id),
  error TEXT,
  content_hash TEXT GENERATED ALWAYS AS (
    observe_id || ':' || layer || ':' || transform_policy || ':' ||
    coalesce(model_id,'') || ':' || coalesce(context_scope_id,'') || ':' ||
    coalesce(extraction_profile,'')
  ) STORED
);

CREATE UNIQUE INDEX idx_derivation_run_active
  ON derivation_run(observe_id, layer, transform_policy, model_id,
                    coalesce(context_scope_id,''), coalesce(extraction_profile,''))
  WHERE status IN ('pending','running','succeeded');

CREATE UNIQUE INDEX idx_derivation_run_hash
  ON derivation_run(content_hash) WHERE status = 'succeeded';

-- transform_policy table (populated from TypeScript registry at daemon startup)
CREATE TABLE policies (
  policy_id TEXT PRIMARY KEY,
  supersedes TEXT REFERENCES policies(policy_id),
  effective_from TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  migration_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Context as first-class entity (flat, hierarchical-path-safe IDs)
CREATE TABLE context (
  id TEXT PRIMARY KEY,               -- e.g. 'work', 'work/project-zylo'
  display_name TEXT NOT NULL,
  isolation_level TEXT NOT NULL DEFAULT 'shared'
    CHECK(isolation_level IN ('shared','isolated')),
  trust_floor TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_floor IN ('user','first_party','web')),
  freshness_ttl_sec INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

-- Replace facts.contexts TEXT[] with join table
CREATE TABLE fact_context (
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  freshness TEXT NOT NULL DEFAULT 'fresh'
    CHECK(freshness IN ('fresh','stale','expired')),
  last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fact_id, context_id)
);
CREATE INDEX idx_fc_context ON fact_context(context_id);

-- source context join (replaces source.contexts TEXT[])
CREATE TABLE source_context (
  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, context_id)
);

-- Replace wiki_pages.contributing_observes TEXT with join
-- NOTE (v2.1): ON DELETE CASCADE on BOTH FKs. Sensory GC needs observe_id cascade;
-- wiki page deletion needs page_path cascade.
CREATE TABLE wiki_page_observe (
  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_path, observe_id)
);
CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);

-- ingest_queue lease columns
ALTER TABLE ingest_queue ADD COLUMN lease_owner TEXT;
ALTER TABLE ingest_queue ADD COLUMN lease_token TEXT;
ALTER TABLE ingest_queue ADD COLUMN lease_expires_at TEXT;

CREATE INDEX idx_queue_claim
  ON ingest_queue(priority, enqueued_at, lease_expires_at)
  WHERE completed_at IS NULL;

CREATE UNIQUE INDEX idx_queue_active_lease
  ON ingest_queue(lease_token)
  WHERE completed_at IS NULL AND lease_token IS NOT NULL;
