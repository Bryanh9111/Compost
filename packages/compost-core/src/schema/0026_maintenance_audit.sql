-- Content-free audit trail for explicit repairs and upstream cache invalidation.
CREATE TABLE maintenance_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Give one existing history entry per immutable Engram memory its stable key.
-- Preserve other historical rows; new pulls reuse the canonical entry.
UPDATE action_log SET source_id=json_extract(artifact_locations,'$.engram_memory_uri')
WHERE source_system='engram'
  AND action_id IN (
    SELECT min(action_id) FROM action_log
    WHERE source_system='engram' AND json_extract(artifact_locations,'$.engram_memory_uri') IS NOT NULL
    GROUP BY json_extract(artifact_locations,'$.engram_memory_uri')
  )
  AND NOT EXISTS (
    SELECT 1 FROM action_log other WHERE other.source_system='engram'
      AND other.source_id=json_extract(action_log.artifact_locations,'$.engram_memory_uri')
  );
