-- Migration 0016_open_problems.sql
-- Source: Phase 6 P0 (anchor v2 L4 — Gap tracker / Curiosity foundation)
--
-- Purpose: record user questions that Compost could not answer with high
-- confidence, so Phase 6 Curiosity policies can later drive targeted
-- ingest / synthesis, and so users can review what their brain does not
-- yet know.
--
-- Design:
--   - UNIQUE(question_hash) dedupes repeated asks of the same question;
--     logGap upserts and bumps ask_count instead of inserting duplicates.
--   - Status transitions: 'open' → 'resolved' (answered by later ingest)
--     or 'open' → 'dismissed' (user marks not-worth-pursuing). Never
--     resurrected — re-asking a dismissed question creates a new row.
--   - `last_observation_ids` is a JSON array of observe_ids that ask()
--     saw at the most recent ask; helps diagnose why the answer failed
--     (were observations present but weak? or none at all?).

CREATE TABLE open_problems (
  problem_id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  question_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open', 'resolved', 'dismissed')),

  -- Reinforcement: the more the user asks, the higher the priority.
  ask_count INTEGER NOT NULL DEFAULT 1,
  first_asked_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_asked_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Last-attempt diagnostics.
  last_answer_confidence REAL,
  last_observation_ids TEXT,

  -- Resolution trail (populated when a future ingest / fact edit answers
  -- the question).
  resolved_at TEXT,
  resolved_by_observation_id TEXT,
  resolved_by_fact_id TEXT,

  tags TEXT
);

CREATE INDEX idx_open_problems_status
  ON open_problems(status, last_asked_at);

CREATE INDEX idx_open_problems_ask_count
  ON open_problems(ask_count DESC, last_asked_at DESC)
  WHERE status = 'open';
