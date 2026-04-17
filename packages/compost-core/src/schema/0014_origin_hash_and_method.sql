-- Migration 0014_origin_hash_and_method.sql
-- Source: debate 017 synthesis + debate 002 (inlet_origin_hash opt-in)
--         + debate 016 Codex I3 (nullable + backfill, NOT NULL + fake default forbidden)
-- Adds observations.origin_hash + method for inlet provenance tracking.
--
-- Purpose:
--   origin_hash = SHA-256 of `adapter|source_uri|idempotency_key` — a stable
--     inlet-signature hash distinct from content_hash (hash of the content
--     itself) and raw_hash (hash of the outbox payload envelope). Used to
--     trace each observation back to its physical inlet without leaking
--     content into the provenance record.
--   method = the concrete ingest method used (mirrors adapter string for
--     now: local-file / web-url / claude-code / etc.). Kept as a separate
--     column so the ingest-method taxonomy can evolve independently of the
--     adapter identifier if needed later.
--
-- Migration strategy (debate 016 Codex I3):
--   - Both columns NULLABLE with no default. No NOT NULL + 'legacy' default
--     because that pollutes analytics: we must be able to distinguish
--     "unknown-because-pre-0014" from "known-missing".
--   - New pipeline writes populate both columns (outbox.drainOne change).
--   - A one-shot backfill script (pipeline/backfill-origin.ts) recomputes
--     origin_hash + method for pre-0014 rows from adapter + source_uri +
--     idempotency_key, which are already present on every row.

ALTER TABLE observations ADD COLUMN origin_hash TEXT;
ALTER TABLE observations ADD COLUMN method TEXT;

CREATE INDEX IF NOT EXISTS idx_obs_origin_hash
  ON observations(origin_hash) WHERE origin_hash IS NOT NULL;
