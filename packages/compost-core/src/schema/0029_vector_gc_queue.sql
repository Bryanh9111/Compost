-- 0029: durable vector cleanup queue
--
-- A re-derivation must drop the observation's previous LanceDB vectors
-- before its new chunks are embedded (pre-0028 observations may hold
-- vectors without any manifest row). persistExtraction records that need
-- here inside its transaction; embedPendingChunks claims rows, deletes the
-- vectors, and removes the rows only after LanceDB confirmed, so a crash or
-- a transient failure is retried. Chunks of a queued observation are not
-- embedded until its row is gone, and the claim keeps two concurrent
-- drainers (daemon sweep + `compost add`) from deleting each other's work.
--
-- The queue is transient work, so an earlier shape of the table (created
-- without the claim columns by a pre-release build) is replaced outright
-- rather than altered column by column.
DROP TABLE IF EXISTS vector_gc_queue;
CREATE TABLE vector_gc_queue (
  observe_id TEXT PRIMARY KEY REFERENCES observations(observe_id) ON DELETE CASCADE,
  enqueued_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_token TEXT,
  claimed_at TEXT
);
