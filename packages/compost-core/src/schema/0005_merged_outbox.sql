-- Migration 0005_merged_outbox.sql
-- Source: compost-v2-spec.md §1.6 (debate #6, 3B/1A -- merge outbox into ledger.db)
-- Creates: observe_outbox
--
-- Architecture decision: observe_outbox lives inside ~/.compost/ledger.db,
-- NOT as per-adapter outbox.db files. Single transaction boundary for
-- drain (outbox -> observations -> ingest_queue). Debate #6 resolved 3B/1A.

CREATE TABLE observe_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,  -- monotonic, global; feeds observations.adapter_sequence per-adapter via window
  adapter TEXT NOT NULL,                  -- e.g. 'compost-adapter-claude-code'
  source_id TEXT NOT NULL,                -- e.g. 'claude-code:018f:/Users/zion/Repos/Zylo/Compost'
  source_kind TEXT NOT NULL               -- denormalized from source.kind so drain can skip a JOIN
    CHECK(source_kind IN ('local-file','local-dir','web','claude-code','host-adapter','sensory')),
  source_uri TEXT NOT NULL,               -- e.g. 'file:///Users/.../notes.md' -- registers source row if missing
  idempotency_key TEXT NOT NULL,          -- sha256(adapter||source_id||stable(envelope))
  trust_tier TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_tier IN ('user','first_party','web')),
  transform_policy TEXT NOT NULL,         -- must exist in policies table at drain time
  payload TEXT NOT NULL,                  -- JSON ObserveEvent envelope (content, mime, metadata, contexts, ...)
  appended_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Drain state (set by daemon only, never by writers):
  drained_at TEXT,
  drain_error TEXT,                       -- last drain attempt error (retained for diagnosis)
  drain_attempts INTEGER NOT NULL DEFAULT 0,
  drain_quarantined_at TEXT,              -- set when drain_attempts > 5; blocks future claims until --drain-retry
  observe_id TEXT REFERENCES observations(observe_id) ON DELETE SET NULL
);

-- Pending rows for drain loop (partial index excludes quarantined)
CREATE INDEX idx_outbox_pending
  ON observe_outbox(adapter, seq)
  WHERE drained_at IS NULL AND drain_quarantined_at IS NULL;

-- Idempotency: same (adapter, source_id, idempotency_key) -> single row
CREATE UNIQUE INDEX idx_outbox_idempotency
  ON observe_outbox(adapter, source_id, idempotency_key);

-- Drained rows older than retention window are pruned by compost reflect
CREATE INDEX idx_outbox_drained_time
  ON observe_outbox(drained_at)
  WHERE drained_at IS NOT NULL;
