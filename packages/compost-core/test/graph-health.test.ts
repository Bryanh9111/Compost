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

  // ---- P0-3 Week 2 implementation tests ----

  function seed(db: Database, facts: Array<{ id: string; daysAgo?: number }>) {
    db.run(
      "INSERT INTO source VALUES ('s1','file:///x','local-file',NULL,0.0,'user',datetime('now'),NULL)"
    );
    db.run(
      "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','t',1,'user','i','tp-2026-04',NULL)"
    );
    for (const f of facts) {
      db.run(
        "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES (?,?,?,?,?)",
        [f.id, `s-${f.id}`, "p", `o-${f.id}`, "obs1"]
      );
      if (f.daysAgo) {
        db.run(
          "UPDATE facts SET created_at = datetime('now', ?) WHERE fact_id = ?",
          [`-${f.daysAgo} days`, f.id]
        );
      }
    }
  }

  test("takeSnapshot on empty DB writes one row with all zeros", () => {
    const snap = takeSnapshot(db);
    expect(snap.totalFacts).toBe(0);
    expect(snap.orphanFacts).toBe(0);
    expect(snap.clusterCount).toBe(0);
    expect(snap.staleClusterCount).toBe(0);

    const rows = db
      .query("SELECT * FROM graph_health_snapshot")
      .all() as Array<{ total_facts: number; cluster_count: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total_facts).toBe(0);
    expect(rows[0]!.cluster_count).toBe(0);
  });

  test("takeSnapshot counts active facts + orphans via fact_links", () => {
    seed(db, [
      { id: "a", daysAgo: 2 },
      { id: "b", daysAgo: 2 },
      { id: "orphan", daysAgo: 2 },
    ]);
    db.run(
      "INSERT INTO fact_links (from_fact_id, to_fact_id, kind) VALUES ('a','b','supports')"
    );

    const snap = takeSnapshot(db);
    expect(snap.totalFacts).toBe(3);
    expect(snap.orphanFacts).toBe(1); // only "orphan" has no link; a+b linked
    expect(snap.clusterCount).toBe(2); // {a,b} + {orphan}
    expect(snap.density).toBeCloseTo(1 / 3, 5);
  });

  test("takeSnapshot is idempotent for the same UTC date (DELETE + INSERT)", () => {
    seed(db, [{ id: "a" }]);
    takeSnapshot(db);
    expect(
      (db.query("SELECT COUNT(*) AS c FROM graph_health_snapshot").get() as {
        c: number;
      }).c
    ).toBe(1);

    // Insert another fact (source+obs already seeded), retake snapshot same
    // day -> overwrite, not duplicate.
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES ('b','s','p','o','obs1')"
    );
    const second = takeSnapshot(db);
    expect(second.totalFacts).toBe(2);

    const all = db
      .query("SELECT total_facts FROM graph_health_snapshot")
      .all() as Array<{ total_facts: number }>;
    expect(all).toHaveLength(1);
    expect(all[0]!.total_facts).toBe(2);
  });

  test("delta returns null when fewer than 2 snapshots exist", () => {
    expect(delta(db)).toBeNull();
    takeSnapshot(db);
    expect(delta(db)).toBeNull();
  });

  test("delta computes orphan + density + windowDays between last two snapshots", () => {
    seed(db, [{ id: "a", daysAgo: 2 }]);
    // First snapshot manually backdated by 3 days
    db.run(
      "INSERT INTO graph_health_snapshot (taken_at, total_facts, orphan_facts, density, cluster_count) " +
        "VALUES (datetime('now', '-3 days'), 1, 1, 0.0, 1)"
    );
    // Second snapshot now (adds no orphan since one fact, still orphan)
    takeSnapshot(db);

    const d = delta(db);
    expect(d).not.toBeNull();
    expect(d!.orphanDelta).toBe(0); // 1 -> 1
    expect(d!.windowDays).toBe(3);
  });

  test("countStaleClusters via takeSnapshot: old cluster counts, fresh does not", () => {
    // 95d cluster (stale) + fresh cluster
    seed(db, [
      { id: "old1", daysAgo: 95 },
      { id: "old2", daysAgo: 95 },
      { id: "fresh", daysAgo: 1 },
    ]);
    db.run(
      "INSERT INTO fact_links (from_fact_id, to_fact_id, kind) VALUES ('old1','old2','supports')"
    );
    const snap = takeSnapshot(db);
    expect(snap.clusterCount).toBe(2); // {old1,old2} + {fresh}
    expect(snap.staleClusterCount).toBe(1); // only {old1,old2}
  });

  test("countStaleClusters: a single recent fact disqualifies cluster", () => {
    seed(db, [
      { id: "old", daysAgo: 100 },
      { id: "recent", daysAgo: 3 },
    ]);
    db.run(
      "INSERT INTO fact_links (from_fact_id, to_fact_id, kind) VALUES ('old','recent','supports')"
    );
    const snap = takeSnapshot(db);
    expect(snap.clusterCount).toBe(1);
    expect(snap.staleClusterCount).toBe(0);
  });
});
