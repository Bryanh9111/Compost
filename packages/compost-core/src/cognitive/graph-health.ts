import type { Database } from "bun:sqlite";

export interface GraphHealthSnapshot {
  takenAt: string;
  totalFacts: number;
  orphanFacts: number | null;        // null until fact_links table exists
  density: number | null;
  clusterCount: number | null;
  staleClusterCount: number;
}

/**
 * Compute current graph health metrics from v_graph_health view.
 * Returns NULL fields for metrics that depend on Phase 4 fact_links table
 * which lands in a follow-up subtask.
 */
export function currentSnapshot(db: Database): GraphHealthSnapshot {
  // TODO(phase4-batch-d): query v_graph_health view.
  void db;
  return {
    takenAt: new Date().toISOString(),
    totalFacts: 0,
    orphanFacts: null,
    density: null,
    clusterCount: null,
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
