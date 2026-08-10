-- Migration 0024 — repair action_log project labels derived from URI leaves.
--
-- Direct MCP observations often carry an explicit `project` in their JSON
-- content. Older action processing ignored it and fell back to the final URI
-- path segment, producing labels such as GitHub pull-request numbers. Prefer
-- explicit project metadata, then recover the repository name from GitHub
-- URLs. Keep next_query_hint aligned with the repaired project.

WITH source_rows AS (
  SELECT
    a.action_id,
    a.project,
    a.what_text,
    CASE
      WHEN json_valid(CAST(o.raw_bytes AS TEXT))
        THEN CAST(o.raw_bytes AS TEXT)
      ELSE '{}'
    END AS payload_json,
    CASE
      WHEN json_valid(o.metadata) THEN o.metadata
      ELSE '{}'
    END AS metadata_json,
    CASE
      WHEN o.source_uri LIKE 'https://github.com/%'
        THEN substr(o.source_uri, length('https://github.com/') + 1)
      ELSE NULL
    END AS github_path
  FROM action_log a
  JOIN observations o ON o.observe_id = a.source_observe_id
),
candidate_rows AS (
  SELECT
    action_id,
    project,
    what_text,
    CASE
      WHEN json_type(payload_json, '$.project') = 'text'
        THEN NULLIF(trim(json_extract(payload_json, '$.project')), '')
      WHEN json_type(metadata_json, '$.project') = 'text'
        THEN NULLIF(trim(json_extract(metadata_json, '$.project')), '')
      ELSE NULL
    END AS explicit_project,
    CASE
      WHEN github_path IS NOT NULL AND instr(github_path, '/') > 0
        THEN substr(github_path, instr(github_path, '/') + 1)
      ELSE NULL
    END AS github_repo_path
  FROM source_rows
),
repairs AS (
  SELECT
    action_id,
    what_text,
    COALESCE(
      explicit_project,
      CASE
        WHEN github_repo_path IS NULL THEN NULL
        WHEN instr(github_repo_path, '/') > 0
          THEN substr(github_repo_path, 1, instr(github_repo_path, '/') - 1)
        ELSE github_repo_path
      END
    ) AS corrected_project
  FROM candidate_rows
)
UPDATE action_log
SET
  project = repairs.corrected_project,
  next_query_hint = substr(
    repairs.corrected_project || ': ' || action_log.what_text,
    1,
    240
  ),
  updated_at = datetime('now')
FROM repairs
WHERE repairs.action_id = action_log.action_id
  AND repairs.corrected_project IS NOT NULL
  AND repairs.corrected_project != action_log.project;
