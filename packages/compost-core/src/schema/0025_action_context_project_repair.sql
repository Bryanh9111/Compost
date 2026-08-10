-- Migration 0025 — repair URI-leaf action projects from routing contexts.
--
-- Older action processing used a URI basename when no explicit project/cwd
-- existed. For numeric job ids, Markdown filenames, and absolute paths this
-- polluted pattern groups. Only replace labels with a clearly malformed shape,
-- and only when the source has a non-generic routing context.

WITH context_repairs AS (
  SELECT
    a.action_id,
    a.what_text,
    MIN(sc.context_id) AS corrected_project
  FROM action_log a
  JOIN observations o ON o.observe_id = a.source_observe_id
  JOIN source_context sc ON sc.source_id = o.source_id
  WHERE (
      a.project GLOB '[0-9]*'
      OR lower(a.project) GLOB '*.md'
      OR a.project LIKE '/%'
      OR lower(a.project) IN ('pull', 'issues', 'commits', 'compare')
    )
    AND lower(sc.context_id) NOT IN (
      'claude-code',
      'codex',
      'content-production',
      'cross-agent-memory',
      'global',
      'meta',
      'video',
      'work'
    )
  GROUP BY a.action_id, a.what_text
)
UPDATE action_log
SET
  project = context_repairs.corrected_project,
  next_query_hint = substr(
    context_repairs.corrected_project || ': ' || action_log.what_text,
    1,
    240
  ),
  updated_at = datetime('now')
FROM context_repairs
WHERE context_repairs.action_id = action_log.action_id
  AND context_repairs.corrected_project IS NOT NULL
  AND context_repairs.corrected_project != action_log.project;
