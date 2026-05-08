-- Backfill context links for Engram-streamed observations.
--
-- Engram entries already preserve project/scope in observations.metadata, but
-- older ingests did not populate fact_context/source_context. That made
-- `compost query ... --contexts <project>` miss Engram-derived facts even
-- when unfiltered retrieval found them.

DROP TABLE IF EXISTS temp._compost_engram_context_backfill;

CREATE TEMP TABLE _compost_engram_context_backfill AS
SELECT
  o.observe_id,
  o.source_id,
  CASE
    WHEN o.metadata IS NOT NULL
      AND json_valid(o.metadata)
      AND NULLIF(json_extract(o.metadata, '$.engram_project'), '') IS NOT NULL
      THEN json_extract(o.metadata, '$.engram_project')
    WHEN o.metadata IS NOT NULL
      AND json_valid(o.metadata)
      AND json_extract(o.metadata, '$.engram_scope') IN ('global', 'meta')
      THEN json_extract(o.metadata, '$.engram_scope')
    ELSE NULL
  END AS context_id
FROM observations o
WHERE o.adapter = 'engram';

INSERT OR IGNORE INTO context (id, display_name)
SELECT DISTINCT context_id, context_id
FROM _compost_engram_context_backfill
WHERE context_id IS NOT NULL;

INSERT OR IGNORE INTO source_context (source_id, context_id)
SELECT DISTINCT source_id, context_id
FROM _compost_engram_context_backfill
WHERE context_id IS NOT NULL;

INSERT OR IGNORE INTO fact_context (fact_id, context_id)
SELECT f.fact_id, e.context_id
FROM facts f
JOIN _compost_engram_context_backfill e ON e.observe_id = f.observe_id
WHERE e.context_id IS NOT NULL;

DROP TABLE _compost_engram_context_backfill;
