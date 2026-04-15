import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  currentSnapshot,
  takeSnapshot,
  delta,
} from "../src/cognitive/graph-health";

describe("graph-health (P0-3, Phase 4 Batch D)", () => {
  let dbPath: string;
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-graph-test-"));
    dbPath = join(tmpDir, "ledger.db");
    db = new Database(dbPath);
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("graph_health_snapshot table exists", () => {
    const cols = db
      .query("PRAGMA table_info('graph_health_snapshot')")
      .all() as { name: string }[];
    expect(cols.map((c) => c.name).sort()).toEqual([
      "cluster_count",
      "density",
      "orphan_facts",
      "stale_cluster_count",
      "taken_at",
      "total_facts",
    ]);
  });

  test("v_graph_health view exists and is queryable", () => {
    const row = db
      .query("SELECT total_facts, computed_at FROM v_graph_health")
      .get() as { total_facts: number; computed_at: string } | null;
    expect(row).not.toBeNull();
    expect(row!.total_facts).toBe(0);
  });

  test("currentSnapshot returns concrete zeros on empty DB (matches 0011 view contract)", () => {
    // Debate 005 fix #4: the GraphHealthSnapshot interface no longer admits
    // null for the four numeric fields. migration 0011 made the underlying
    // columns NOT NULL DEFAULT 0 and the view returns 0 on empty inputs.
    const snap = currentSnapshot(db);
    expect(snap.totalFacts).toBe(0);
    expect(snap.orphanFacts).toBe(0);
    expect(snap.density).toBe(0);
    expect(snap.clusterCount).toBe(0);
    expect(snap.staleClusterCount).toBe(0);
  });

  test("v_graph_health view (post-0011) returns concrete zeros on empty DB", () => {
    // This validates the migration 0011 contract directly, independent of TS stub.
    // P0-3 must read these via currentSnapshot once it is implemented.
    const row = db
      .query(
        "SELECT total_facts, orphan_facts, density, cluster_count FROM v_graph_health"
      )
      .get() as {
      total_facts: number;
      orphan_facts: number;
      density: number;
      cluster_count: number;
    };
    expect(row.total_facts).toBe(0);
    expect(row.orphan_facts).toBe(0);
    expect(row.density).toBe(0);
    expect(row.cluster_count).toBe(0);
  });

  // RED tests — will fail until P0-3 implementation + fact_links table
  test.skip("takeSnapshot writes row to graph_health_snapshot", () => {
    void takeSnapshot;
    expect(false).toBe(true);
  });

  test.skip("delta returns null with < 2 snapshots", () => {
    expect(delta(db)).toBeNull();
  });
});
