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
 * Compute current graph health metrics from v_graph_health view.
 * Stub: P0-3 (Week 2) will implement by querying `v_graph_health` + TS-side
 * recursive-CTE cluster_count. Current stub returns all zeros, consistent
 * with what the view returns on an empty database.
 */
export function currentSnapshot(db: Database): GraphHealthSnapshot {
  // TODO(P0-3 Week 2): query v_graph_health view and fact-links helpers.
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
 * Persist a daily snapshot to graph_health_snapshot table.
 * Called by daemon scheduler at most once per day.
 */
export function takeSnapshot(db: Database): GraphHealthSnapshot {
  // TODO(phase4-batch-d): compute + INSERT into graph_health_snapshot.
  void db;
  throw new Error("graph-health.takeSnapshot not implemented (P0-3 stub)");
}

/**
 * Compare latest two snapshots; returns deltas useful for triage signal generation.
 * Returns null if fewer than 2 snapshots exist.
 */
export function delta(db: Database): {
  orphanDelta: number;
  densityDelta: number;
  windowDays: number;
} | null {
  // TODO(phase4-batch-d): implement.
  void db;
  return null;
}
