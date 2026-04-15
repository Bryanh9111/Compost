-- Migration 0011_fact_links_and_health_fix.sql
-- Source: debates/002-roadmap-gap-audit/synthesis.md (2026-04-14)
-- Two atomic changes from Phase 4-6 gap audit (4/4 consensus):
--   1. Promote `fact_links` to P0-0 (was Phase 3 carried) — prerequisite for P0-3 graph_health
--   2. Fix Sonnet B3 bug: graph_health_snapshot NOT NULL columns conflict with v_graph_health stub NULL
--   3. Replace v_graph_health stub with real implementation backed by fact_links

------------------------------------------------------------------
-- Part 1: fact_links table (P0-0)
------------------------------------------------------------------
-- Bidirectional storage convention: each pair stored once with explicit
-- direction in (from_fact_id, to_fact_id). Queries needing undirected
-- adjacency UNION ALL both directions.
CREATE TABLE IF NOT EXISTS fact_links (
  link_id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  to_fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'supports',         -- from corroborates to (same conclusion, different evidence)
    'contradicts',      -- from refutes to (used by contradiction arbitration)
    'elaborates',       -- from adds detail to to (parent-child knowledge)
    'derived_from',     -- from was extracted using to as context
    'same_subject'      -- from and to share canonical subject (auto via reflect)
  )),
  weight REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0.0 AND weight <= 1.0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  observed_count INTEGER NOT NULL DEFAULT 1,
  CHECK (from_fact_id != to_fact_id)  -- no self-loops
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_links_unique
  ON fact_links(from_fact_id, to_fact_id, kind);
CREATE INDEX IF NOT EXISTS idx_fact_links_from ON fact_links(from_fact_id);
CREATE INDEX IF NOT EXISTS idx_fact_links_to ON fact_links(to_fact_id);
CREATE INDEX IF NOT EXISTS idx_fact_links_kind ON fact_links(kind, created_at);

------------------------------------------------------------------
-- Part 2: Fix graph_health_snapshot NOT NULL bug (Sonnet B3)
-- 0010 declared orphan_facts / density / cluster_count NOT NULL with no DEFAULT.
-- v_graph_health stub returned NULL. Any INSERT … SELECT FROM v_graph_health
-- would fail with constraint error. SQLite cannot ALTER existing column to add
-- DEFAULT, so we rebuild the table (safe: no rows yet at this revision).
------------------------------------------------------------------
DROP TABLE IF EXISTS graph_health_snapshot;
CREATE TABLE graph_health_snapshot (
  taken_at TEXT PRIMARY KEY DEFAULT (datetime('now')),
  total_facts INTEGER NOT NULL DEFAULT 0,
  orphan_facts INTEGER NOT NULL DEFAULT 0,
  density REAL NOT NULL DEFAULT 0.0,
  cluster_count INTEGER NOT NULL DEFAULT 0,
  stale_cluster_count INTEGER NOT NULL DEFAULT 0
);

------------------------------------------------------------------
-- Part 3: Replace v_graph_health stub with fact_links-backed view
-- Definition order: SQLite stores the view's SELECT as text, so we need
-- to drop and recreate to swap implementation.
------------------------------------------------------------------
DROP VIEW IF EXISTS v_graph_health;
CREATE VIEW v_graph_health AS
WITH active_facts AS (
  SELECT fact_id FROM facts WHERE archived_at IS NULL
),
edges_undirected AS (
  -- Treat each link as undirected for orphan detection and density
  SELECT from_fact_id AS fact_id FROM fact_links
  UNION ALL
  SELECT to_fact_id AS fact_id FROM fact_links
),
linked_facts AS (
  SELECT DISTINCT fact_id FROM edges_undirected
)
SELECT
  (SELECT COUNT(*) FROM active_facts) AS total_facts,
  -- Orphan = active fact older than 24h with no link in either direction
  (SELECT COUNT(*) FROM active_facts a
   LEFT JOIN linked_facts l ON l.fact_id = a.fact_id
   JOIN facts f ON f.fact_id = a.fact_id
   WHERE l.fact_id IS NULL
     AND f.created_at < datetime('now', '-24 hours')
  ) AS orphan_facts,
  -- Density = edges / nodes (clamped: 0 if no nodes)
  CASE
    WHEN (SELECT COUNT(*) FROM active_facts) = 0 THEN 0.0
    ELSE CAST((SELECT COUNT(*) FROM fact_links) AS REAL)
       / CAST((SELECT COUNT(*) FROM active_facts) AS REAL)
  END AS density,
  -- Cluster count placeholder — true connected components needs recursive CTE
  -- in TS layer (graph-health.ts). View returns 0; takeSnapshot computes real.
  0 AS cluster_count,
  datetime('now') AS computed_at;
