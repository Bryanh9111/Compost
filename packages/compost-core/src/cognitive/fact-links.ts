import type { Database } from "bun:sqlite";

/**
 * P0-0 Fact-Links API — Phase 4 Batch D.
 *
 * The `fact_links` table (migration 0011) stores directed edges between facts.
 * This module wraps it with TypeScript primitives and recursive CTE traversal
 * so P0-3 (graph_health), reflect-time contradiction analysis, and future
 * curiosity / answer-synthesis paths can reason about the fact graph.
 *
 * Edge semantics (mirror migration 0011 CHECK):
 *   supports / contradicts / elaborates / derived_from / same_subject
 *
 * Bidirectional convention: each pair stored once with explicit direction in
 * (from_fact_id, to_fact_id). Queries needing undirected adjacency union both
 * directions (see `traverse` and `getNeighbors`).
 */

export const LINK_KINDS = [
  "supports",
  "contradicts",
  "elaborates",
  "derived_from",
  "same_subject",
] as const;

export type LinkKind = (typeof LINK_KINDS)[number];

export type LinkDirection = "out" | "in" | "both";

export interface FactLink {
  link_id: number;
  from_fact_id: string;
  to_fact_id: string;
  kind: LinkKind;
  weight: number;
  created_at: string;
  observed_count: number;
}

export interface AddLinkOpts {
  weight?: number;          // 0.0–1.0, default 1.0
  reinforceIfExists?: boolean; // default true: bumps observed_count + max(weight)
}

/**
 * Insert a link, or reinforce an existing one (default).
 * Returns the link_id of the affected row.
 */
export function addLink(
  db: Database,
  fromFactId: string,
  toFactId: string,
  kind: LinkKind,
  opts: AddLinkOpts = {}
): number {
  if (fromFactId === toFactId) {
    throw new Error(`fact-links: self-loop rejected (${fromFactId})`);
  }
  const weight = opts.weight ?? 1.0;
  if (weight < 0 || weight > 1) {
    throw new Error(`fact-links: weight must be in [0,1] (got ${weight})`);
  }
  const reinforce = opts.reinforceIfExists ?? true;

  if (reinforce) {
    const existing = db
      .query(
        "SELECT link_id, weight, observed_count FROM fact_links " +
          "WHERE from_fact_id = ? AND to_fact_id = ? AND kind = ?"
      )
      .get(fromFactId, toFactId, kind) as
      | { link_id: number; weight: number; observed_count: number }
      | null;
    if (existing) {
      const newWeight = Math.max(existing.weight, weight);
      db.run(
        "UPDATE fact_links SET observed_count = observed_count + 1, weight = ? " +
          "WHERE link_id = ?",
        [newWeight, existing.link_id]
      );
      return existing.link_id;
    }
  }

  const result = db.run(
    "INSERT INTO fact_links (from_fact_id, to_fact_id, kind, weight) VALUES (?, ?, ?, ?)",
    [fromFactId, toFactId, kind, weight]
  );
  return Number(result.lastInsertRowid);
}

/**
 * Get all links touching a fact. Direction:
 *   - "out": fact_id is the source
 *   - "in":  fact_id is the target
 *   - "both": union (default)
 */
export function getLinks(
  db: Database,
  factId: string,
  direction: LinkDirection = "both",
  kinds?: LinkKind[]
): FactLink[] {
  const kindFilter = kinds && kinds.length > 0 ? kinds : null;

  let sql: string;
  const params: unknown[] = [];

  if (direction === "out") {
    sql = "SELECT * FROM fact_links WHERE from_fact_id = ?";
    params.push(factId);
  } else if (direction === "in") {
    sql = "SELECT * FROM fact_links WHERE to_fact_id = ?";
    params.push(factId);
  } else {
    sql =
      "SELECT * FROM fact_links WHERE from_fact_id = ? OR to_fact_id = ?";
    params.push(factId, factId);
  }

  if (kindFilter) {
    const placeholders = kindFilter.map(() => "?").join(",");
    sql += ` AND kind IN (${placeholders})`;
    params.push(...kindFilter);
  }

  sql += " ORDER BY created_at DESC";
  return db.query(sql).all(...params) as FactLink[];
}

/**
 * Get neighbor fact_ids (one-hop, undirected) optionally filtered by kind.
 */
export function getNeighbors(
  db: Database,
  factId: string,
  kinds?: LinkKind[]
): string[] {
  const links = getLinks(db, factId, "both", kinds);
  const out = new Set<string>();
  for (const l of links) {
    out.add(l.from_fact_id === factId ? l.to_fact_id : l.from_fact_id);
  }
  return [...out];
}

/**
 * Remove a specific link. Returns true if a row was deleted.
 */
export function removeLink(
  db: Database,
  fromFactId: string,
  toFactId: string,
  kind: LinkKind
): boolean {
  const result = db.run(
    "DELETE FROM fact_links WHERE from_fact_id = ? AND to_fact_id = ? AND kind = ?",
    [fromFactId, toFactId, kind]
  );
  return result.changes > 0;
}

export interface TraverseOpts {
  direction?: LinkDirection;       // default "both"
  kinds?: LinkKind[];              // default: all kinds
  maxDepth?: number;               // default 3 (prevents runaway in cycles)
  includeArchived?: boolean;       // default false
}

export interface TraverseResult {
  fact_id: string;
  depth: number;                   // 0 = origin fact
}

/**
 * BFS traversal via recursive CTE. Returns reachable fact_ids with their depth.
 *
 * Cycle protection: SQLite recursive CTE doesn't auto-deduplicate; we maintain
 * a visited set in the recursion via NOT IN subquery + explicit depth gate.
 */
export function traverse(
  db: Database,
  startFactId: string,
  opts: TraverseOpts = {}
): TraverseResult[] {
  const direction = opts.direction ?? "both";
  const kinds = opts.kinds && opts.kinds.length > 0 ? opts.kinds : null;
  const maxDepth = opts.maxDepth ?? 3;
  const includeArchived = opts.includeArchived ?? false;

  if (maxDepth < 0) {
    throw new Error(`fact-links: maxDepth must be >= 0 (got ${maxDepth})`);
  }

  // SQLite recursive CTEs cannot self-reference more than once, so we cannot
  // use NOT IN (SELECT FROM visited) for cycle detection. Instead we use a
  // path-string accumulator: each row carries its visited-set as a `,`-joined
  // string, and we filter expansion by string non-membership. This is O(depth)
  // per row but keeps the recursion single-self-reference.
  const kindFilter = kinds
    ? `AND fl.kind IN (${kinds.map((k) => `'${k}'`).join(",")})`
    : "";

  const nextFactIdExpr =
    direction === "out"
      ? "fl.to_fact_id"
      : direction === "in"
        ? "fl.from_fact_id"
        : "CASE WHEN fl.from_fact_id = visited.fact_id THEN fl.to_fact_id ELSE fl.from_fact_id END";

  const joinClause =
    direction === "out"
      ? "JOIN fact_links fl ON fl.from_fact_id = visited.fact_id"
      : direction === "in"
        ? "JOIN fact_links fl ON fl.to_fact_id = visited.fact_id"
        : "JOIN fact_links fl ON (fl.from_fact_id = visited.fact_id OR fl.to_fact_id = visited.fact_id)";

  const archivedFilter = includeArchived
    ? ""
    : "AND fact_id NOT IN (SELECT fact_id FROM facts WHERE archived_at IS NOT NULL)";

  const sql = `
    WITH RECURSIVE visited(fact_id, depth, path) AS (
      SELECT ?, 0, ',' || ? || ','
      UNION ALL
      SELECT
        ${nextFactIdExpr} AS next_id,
        visited.depth + 1,
        visited.path || ${nextFactIdExpr} || ','
      FROM visited
      ${joinClause}
      WHERE 1=1 ${kindFilter}
        AND visited.depth < ?
        AND INSTR(visited.path, ',' || ${nextFactIdExpr} || ',') = 0
    )
    SELECT fact_id, MIN(depth) AS depth
    FROM visited
    WHERE 1=1 ${archivedFilter}
    GROUP BY fact_id
    ORDER BY depth, fact_id
  `;

  return db
    .query(sql)
    .all(startFactId, startFactId, maxDepth) as TraverseResult[];
}

/**
 * Find facts that are "orphans" by graph criteria:
 *   - active (archived_at IS NULL)
 *   - older than `minAgeHours` (avoid flagging brand-new facts)
 *   - have zero links in either direction
 *
 * Used by triage's `orphan_delta` signal generator (P0-1) and by graph_health
 * snapshots (P0-3).
 */
export function findOrphans(
  db: Database,
  minAgeHours: number = 24
): string[] {
  if (minAgeHours < 0) {
    throw new Error(`fact-links: minAgeHours must be >= 0 (got ${minAgeHours})`);
  }
  const sql = `
    SELECT f.fact_id
    FROM facts f
    LEFT JOIN fact_links fl
      ON fl.from_fact_id = f.fact_id OR fl.to_fact_id = f.fact_id
    WHERE f.archived_at IS NULL
      AND f.created_at < datetime('now', ?)
      AND fl.link_id IS NULL
    GROUP BY f.fact_id
    ORDER BY f.created_at
  `;
  const rows = db
    .query(sql)
    .all(`-${minAgeHours} hours`) as Array<{ fact_id: string }>;
  return rows.map((r) => r.fact_id);
}

/**
 * Compute connected components over the active-fact graph.
 * Returns a Map<fact_id, component_id>. Component IDs are 0-indexed by
 * traversal order. Active facts with no links are their own singleton
 * component.
 *
 * Implementation: Union-Find in TS (faster than recursive CTE for cluster
 * count and avoids the CTE depth/cycle complexity). Acceptable up to ~1M
 * facts; if benchmarks show otherwise we revisit at P0-3.
 */
export function connectedComponents(db: Database): {
  components: Map<string, number>;
  count: number;
} {
  const facts = db
    .query("SELECT fact_id FROM facts WHERE archived_at IS NULL")
    .all() as Array<{ fact_id: string }>;
  const links = db
    .query("SELECT from_fact_id, to_fact_id FROM fact_links")
    .all() as Array<{ from_fact_id: string; to_fact_id: string }>;

  // Union-Find
  const parent = new Map<string, string>();
  for (const f of facts) parent.set(f.fact_id, f.fact_id);

  function find(x: string): string {
    let root = x;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    // path compression
    let cur = x;
    while (parent.get(cur)! !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const l of links) {
    // Only union if both endpoints are active facts (links to archived
    // facts are tolerated until reflect prunes them)
    if (parent.has(l.from_fact_id) && parent.has(l.to_fact_id)) {
      union(l.from_fact_id, l.to_fact_id);
    }
  }

  // Assign component IDs
  const rootToId = new Map<string, number>();
  const components = new Map<string, number>();
  let nextId = 0;
  for (const f of facts) {
    const root = find(f.fact_id);
    let id = rootToId.get(root);
    if (id === undefined) {
      id = nextId++;
      rootToId.set(root, id);
    }
    components.set(f.fact_id, id);
  }

  return { components, count: nextId };
}

/**
 * Count connected components where every active fact is older than
 * `minAgeDays` (default 90). Used by P0-3 `graph_health_snapshot.stale_cluster_count`.
 *
 * Semantics (locked in debate 006 Pre-Week-2): a cluster is "stale" when
 * ALL of its active facts have `created_at < now - minAgeDays`. A single
 * recent fact in the cluster disqualifies it from the count. Archived
 * facts are ignored (not members of any active component).
 *
 * Stub: Week 2 P0-3 lands the real implementation alongside `takeSnapshot`.
 * Keeping the signature locked here prevents P0-3 from relitigating the
 * API shape under schedule pressure.
 */
export function countStaleClusters(
  db: Database,
  minAgeDays: number = 90
): number {
  // TODO(P0-3 Week 2): implement per debate 006 Fix 1 -- iterate
  // connectedComponents(), for each component fetch max(created_at) of
  // active facts, count the components whose max is older than the gate.
  void db;
  void minAgeDays;
  return 0;
}

/**
 * Quick-stats helper used by P0-3 graph_health snapshots and `compost stats`.
 */
export function graphStats(db: Database): {
  totalFacts: number;
  totalLinks: number;
  density: number;        // links / facts (0 if no facts)
  orphanCount: number;
  componentCount: number;
} {
  const totalFactsRow = db
    .query("SELECT COUNT(*) AS c FROM facts WHERE archived_at IS NULL")
    .get() as { c: number };
  const totalLinksRow = db
    .query("SELECT COUNT(*) AS c FROM fact_links")
    .get() as { c: number };
  const orphans = findOrphans(db, 24);
  const { count: componentCount } = connectedComponents(db);
  const totalFacts = totalFactsRow.c;
  return {
    totalFacts,
    totalLinks: totalLinksRow.c,
    density: totalFacts === 0 ? 0 : totalLinksRow.c / totalFacts,
    orphanCount: orphans.length,
    componentCount,
  };
}
