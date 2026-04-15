import type { Database } from "bun:sqlite";

/**
 * Debate 005 fix #4: the four numeric fields are non-null since migration
 * 0011 rebuilt `graph_health_snapshot` with `NOT NULL DEFAULT 0` on all of
 * them, and the updated `v_graph_health` view returns 0 instead of NULL on
 * empty inputs. The prior `number | null` typing was a lie to callers.
 */
export interface GraphHealthSnapshot {
  takenAt: string;
  totalFacts: number;
  orphanFacts: number;
  density: number;
  clusterCount: number;
  staleClusterCount: number;
}

/**
 * Compute current graph health metrics.
 *
 * Query split (locked in debate 006 Pre-Week-2 Fix 1): `v_graph_health`
 * returns `total_facts`, `orphan_facts`, `density` as real values; the view's
 * own `cluster_count` column is a hardcoded 0 placeholder. The Week 2
 * implementation MUST NOT read `cluster_count` from the view -- it must
 * compute both `clusterCount` and `staleClusterCount` in TypeScript via
 * `connectedComponents()` and `countStaleClusters()` from `./fact-links`.
 * Reading cluster_count from the view would silently write 0 to every
 * daily snapshot and break `delta()`'s diagnostic signal on day one.
 */
export function currentSnapshot(db: Database): GraphHealthSnapshot {
  // TODO(P0-3 Week 2): implement per the query-split locked above:
  //   const viewRow = db.query("SELECT total_facts, orphan_facts, density FROM v_graph_health").get()
  //   const { count: clusterCount } = connectedComponents(db)
  //   const staleClusterCount = countStaleClusters(db, 90)
  void db;
  return {
    takenAt: new Date().toISOString(),
    totalFacts: 0,
    orphanFacts: 0,
    density: 0,
    clusterCount: 0,
    staleClusterCount: 0,
  };
}

/**
 * Persist a daily snapshot to `graph_health_snapshot`.
 *
 * Idempotency contract (locked in debate 006 Pre-Week-2 Fix 2): same-day
 * retriggers (daemon restart, grace-window refire) must not produce
 * multiple rows or PK collisions. Week 2 implementation will wrap
 * `DELETE FROM graph_health_snapshot WHERE date(taken_at) = date(?)` and
 * a fresh `INSERT` in a single `db.transaction(...)`. Result: at most one
 * row per UTC date, always reflecting the latest call.
 *
 * Called by `startGraphHealthScheduler` (daemon) at 04:00 UTC daily.
 */
export function takeSnapshot(db: Database): GraphHealthSnapshot {
  // TODO(P0-3 Week 2): transactional DELETE-same-date + INSERT, return snapshot.
  void db;
  throw new Error("graph-health.takeSnapshot not implemented (P0-3 stub)");
}

/**
 * Compare latest two snapshots; returns deltas useful for triage signal
 * generation. Returns null if fewer than 2 snapshots exist.
 */
export function delta(db: Database): {
  orphanDelta: number;
  densityDelta: number;
  windowDays: number;
} | null {
  // TODO(P0-3 Week 2): ORDER BY taken_at DESC LIMIT 2, diff the two rows.
  void db;
  return null;
}
