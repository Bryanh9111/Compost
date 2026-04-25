-- Migration 0018 — Phase 7 L5 reasoning chains (debate 025)
--
-- Per debate 025 synthesis (4-way Opus/Sonnet/Gemini/Codex; Q3 4/4 consensus
-- on a dedicated table over (A) facts.kind / (C) decision_audit reuse / (D)
-- Engram-as-storage). Stores L5 cross-fact reasoning outputs:
--   seed → retrieved candidate set → LLM-synthesized chain
--
-- Key design notes:
--   * chain_id is deterministic UUIDv5 over (seed_kind, seed_id, policy_version,
--     sorted candidate fact_ids) — same seed + same retrieval + same policy →
--     same id. Mirrors debate 024 idempotency lesson at the L5 layer.
--   * retrieval_trace_json captures ANN/FTS/graph counts + RRF weights so a
--     reasoning failure has its own paper trail (synthesis Q5: this absorbs
--     Gemini's deferred (Z) ask_gap audit kind use case without extending the
--     frozen AuditKind union).
--   * engram_insight_id is forward-compat for `compost reason --push-engram`;
--     not populated by the L5 entry slice but reserves the FK column.
--   * Status lifecycle: active → stale (seed/candidates archived) | superseded
--     (rerun with newer policy_version) | user_rejected (explicit dismissal).
--
-- The migrator (`migrator.ts:92-103`) wraps each file in BEGIN IMMEDIATE/COMMIT
-- itself; this file must NOT include its own transaction control or SQLite
-- raises "cannot start a transaction within a transaction".

CREATE TABLE reasoning_chains (
  chain_id TEXT PRIMARY KEY,
  seed_kind TEXT NOT NULL
    CHECK(seed_kind IN ('fact', 'question', 'gap', 'curiosity_cluster')),
  seed_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  candidate_fact_ids_json TEXT NOT NULL CHECK(json_valid(candidate_fact_ids_json)),
  edge_refs_json TEXT CHECK(edge_refs_json IS NULL OR json_valid(edge_refs_json)),
  retrieval_trace_json TEXT NOT NULL CHECK(json_valid(retrieval_trace_json)),
  answer_json TEXT NOT NULL CHECK(json_valid(answer_json)),
  confidence REAL NOT NULL DEFAULT 0.5 CHECK(confidence >= 0.0 AND confidence <= 1.0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'stale', 'superseded', 'user_rejected')),
  engram_insight_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX idx_reasoning_chains_seed
  ON reasoning_chains(seed_kind, seed_id, status);

CREATE INDEX idx_reasoning_chains_engram
  ON reasoning_chains(engram_insight_id)
  WHERE engram_insight_id IS NOT NULL;

CREATE INDEX idx_reasoning_chains_active_recent
  ON reasoning_chains(created_at DESC)
  WHERE status = 'active' AND archived_at IS NULL;
