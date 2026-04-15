import type { Database } from "bun:sqlite";
import { connectedComponents, countStaleClusters } from "./fact-links";

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
  // v_graph_health returns cluster_count as a hardcoded 0 placeholder,
  // so we deliberately exclude it from this SELECT and compute it in TS.
  const viewRow = db
    .query(
      "SELECT total_facts, orphan_facts, density FROM v_graph_health"
    )
    .get() as {
    total_facts: number;
    orphan_facts: number;
    density: number;
  };
  const { count: clusterCount } = connectedComponents(db);
  const staleClusterCount = countStaleClusters(db, 90);
  return {
    takenAt: new Date().toISOString(),
    totalFacts: viewRow.total_facts,
    orphanFacts: viewRow.orphan_facts,
    density: viewRow.density,
    clusterCount,
    staleClusterCount,
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
  const snap = currentSnapshot(db);
  const sqliteTs = snap.takenAt.replace("T", " ").slice(0, 19);
  const tx = db.transaction(() => {
    db.run(
      "DELETE FROM graph_health_snapshot WHERE date(taken_at) = date(?)",
      [sqliteTs]
    );
    db.run(
      "INSERT INTO graph_health_snapshot " +
        "(taken_at, total_facts, orphan_facts, density, cluster_count, stale_cluster_count) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
      [
        sqliteTs,
        snap.totalFacts,
        snap.orphanFacts,
        snap.density,
        snap.clusterCount,
        snap.staleClusterCount,
      ]
    );
  });
  tx();
  return snap;
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
  const rows = db
    .query(
      "SELECT taken_at, orphan_facts, density " +
        "FROM graph_health_snapshot ORDER BY taken_at DESC LIMIT 2"
    )
    .all() as Array<{
    taken_at: string;
    orphan_facts: number;
    density: number;
  }>;
  if (rows.length < 2) return null;
  const [latest, prior] = rows;
  const latestMs = Date.parse(latest!.taken_at.replace(" ", "T") + "Z");
  const priorMs = Date.parse(prior!.taken_at.replace(" ", "T") + "Z");
  return {
    orphanDelta: latest!.orphan_facts - prior!.orphan_facts,
    densityDelta: latest!.density - prior!.density,
    windowDays: Math.max(
      0,
      Math.round((latestMs - priorMs) / 86_400_000)
    ),
  };
}
