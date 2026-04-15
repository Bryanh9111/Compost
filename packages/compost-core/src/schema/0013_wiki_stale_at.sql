-- Migration 0013_wiki_stale_at.sql
-- Source: debates/007-week3-plan-audit/synthesis.md Lock 6 (2026-04-15)
-- Adds `wiki_pages.stale_at` to support the P0-6 wiki circuit-breaker fallback.
--
-- Flow locked in debate 007 Lock 6:
--   1. wiki.ts rebuild calls the LLM. If the breaker is open, fallback
--      keeps the existing markdown on disk BUT marks wiki_pages.stale_at = now.
--   2. ask.ts (query/ask.ts:123-128 wiki-context read) checks stale_at
--      when pulling wiki pages into the answer context. Non-null stale_at
--      causes the answer to prefix `[stale wiki: <date>]` so the user is
--      explicitly told the LLM wasn't available for the most recent refresh.
--   3. Next successful rebuild clears stale_at to NULL.
--
-- Without this column, the silent-stale-wiki failure mode identified by
-- Codex R1 (debate 007) would mean users see old answers as if they were
-- fresh during a prolonged LLM outage.

ALTER TABLE wiki_pages ADD COLUMN stale_at TEXT;

CREATE INDEX IF NOT EXISTS idx_wiki_pages_stale
  ON wiki_pages(stale_at) WHERE stale_at IS NOT NULL;
