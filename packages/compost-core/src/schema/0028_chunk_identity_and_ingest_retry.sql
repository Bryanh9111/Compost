-- 0028: chunk identity + bounded ingest retries
--
-- chunks.chunk_id is the global primary key, but every extractor emitted
-- document-local ids (c0, c1, ...) and the writers used INSERT OR IGNORE, so
-- only the first observation to claim each id kept its manifest row. New
-- writers namespace the id as `<observe_id>:<local id>`; legacy rows are
-- rewritten here (their observe_id column is correct: it belongs to the row
-- that won the insert). Engram adapter rows already use uuidv7 and are left.
--
-- fact_id persists the chunk -> fact mapping that previously survived only
-- inside LanceDB rows; embed_error isolates chunks the embedding service
-- cannot vectorise so the pending-embedding sweep does not loop on them.
--
-- ingest_queue gains the retry columns the spec (§4, §10.2) always described:
-- next_attempt_at (exponential backoff) and quarantined_at (attempts
-- exhausted). Claims skip both.

ALTER TABLE chunks ADD COLUMN fact_id TEXT;
ALTER TABLE chunks ADD COLUMN embed_error TEXT;

ALTER TABLE ingest_queue ADD COLUMN next_attempt_at TEXT;
ALTER TABLE ingest_queue ADD COLUMN quarantined_at TEXT;

CREATE INDEX IF NOT EXISTS idx_queue_claimable
  ON ingest_queue(priority, enqueued_at)
  WHERE completed_at IS NULL AND quarantined_at IS NULL;

UPDATE chunks
SET chunk_id = observe_id || ':' || chunk_id
WHERE chunk_id GLOB 'c[0-9]*'
  AND chunk_id NOT GLOB '*-*'
  AND chunk_id NOT GLOB '*:*';
