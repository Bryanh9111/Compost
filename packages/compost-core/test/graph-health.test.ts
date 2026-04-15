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

  test("currentSnapshot returns stub with null fact_links-dependent fields", () => {
    const snap = currentSnapshot(db);
    expect(snap.totalFacts).toBe(0);
    // These will be non-null after fact_links table lands in a follow-up
    expect(snap.orphanFacts).toBeNull();
    expect(snap.density).toBeNull();
    expect(snap.clusterCount).toBeNull();
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
