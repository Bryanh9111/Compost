import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  LINK_KINDS,
  addLink,
  getLinks,
  getNeighbors,
  removeLink,
  traverse,
  findOrphans,
  connectedComponents,
  graphStats,
} from "../src/cognitive/fact-links";

/**
 * Test fixture helper: create N facts with shared observation chain so that
 * fact_links FK constraints are satisfied without each test rewriting boilerplate.
 */
function seedFacts(db: Database, factIds: string[]): void {
  db.run(
    "INSERT INTO source VALUES ('s1','file:///x','local-file',NULL,0.0,'user',datetime('now'),NULL)"
  );
  db.run(
    "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','test',1,'user','idem','tp-2026-04',NULL,NULL,NULL)"
  );
  for (const id of factIds) {
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES (?,?,?,?,?)",
      [id, `subj-${id}`, "pred", `obj-${id}`, "obs1"]
    );
  }
}

function ageFact(db: Database, factId: string, hoursAgo: number): void {
  db.run(
    "UPDATE facts SET created_at = datetime('now', ?) WHERE fact_id = ?",
    [`-${hoursAgo} hours`, factId]
  );
}

describe("fact-links (P0-0, Phase 4 Batch D)", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-flink-test-"));
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- Constants ----
  test("LINK_KINDS exposes the 5 SQL CHECK values", () => {
    expect([...LINK_KINDS].sort()).toEqual([
      "contradicts",
      "derived_from",
      "elaborates",
      "same_subject",
      "supports",
    ]);
  });

  // ---- addLink ----
  test("addLink inserts a new row and returns link_id", () => {
    seedFacts(db, ["f1", "f2"]);
    const id = addLink(db, "f1", "f2", "supports");
    expect(id).toBeGreaterThan(0);
    const rows = db
      .query("SELECT COUNT(*) AS c FROM fact_links")
      .get() as { c: number };
    expect(rows.c).toBe(1);
  });

  test("addLink reinforces existing edge (default behavior)", () => {
    seedFacts(db, ["f1", "f2"]);
    const id1 = addLink(db, "f1", "f2", "supports", { weight: 0.5 });
    const id2 = addLink(db, "f1", "f2", "supports", { weight: 0.8 });
    expect(id2).toBe(id1);
    const row = db
      .query(
        "SELECT observed_count, weight FROM fact_links WHERE link_id = ?"
      )
      .get(id1) as { observed_count: number; weight: number };
    expect(row.observed_count).toBe(2);
    expect(row.weight).toBe(0.8);
  });

  test("addLink with reinforceIfExists=false fails on duplicate (FK unique)", () => {
    seedFacts(db, ["f1", "f2"]);
    addLink(db, "f1", "f2", "supports");
    expect(() =>
      addLink(db, "f1", "f2", "supports", { reinforceIfExists: false })
    ).toThrow();
  });

  test("addLink rejects self-loop", () => {
    seedFacts(db, ["f1"]);
    expect(() => addLink(db, "f1", "f1", "supports")).toThrow(/self-loop/);
  });

  test("addLink rejects out-of-range weight", () => {
    seedFacts(db, ["f1", "f2"]);
    expect(() => addLink(db, "f1", "f2", "supports", { weight: 1.5 })).toThrow(/weight/);
    expect(() => addLink(db, "f1", "f2", "supports", { weight: -0.1 })).toThrow(/weight/);
  });

  test("addLink rejects unknown fact_id (FK violation)", () => {
    expect(() => addLink(db, "f-nope-1", "f-nope-2", "supports")).toThrow();
  });

  // ---- getLinks / getNeighbors ----
  test("getLinks 'out' filters by source", () => {
    seedFacts(db, ["a", "b", "c"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "c", "a", "elaborates");
    expect(getLinks(db, "a", "out")).toHaveLength(1);
    expect(getLinks(db, "a", "in")).toHaveLength(1);
    expect(getLinks(db, "a", "both")).toHaveLength(2);
  });

  test("getLinks filters by kinds", () => {
    seedFacts(db, ["a", "b", "c"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "a", "c", "contradicts");
    expect(getLinks(db, "a", "out", ["supports"])).toHaveLength(1);
    expect(getLinks(db, "a", "out", ["supports", "contradicts"])).toHaveLength(2);
    expect(getLinks(db, "a", "out", ["elaborates"])).toHaveLength(0);
  });

  test("getNeighbors returns deduped fact_ids", () => {
    seedFacts(db, ["a", "b", "c"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "a", "b", "elaborates"); // different kind, same neighbor
    addLink(db, "c", "a", "same_subject");
    expect(new Set(getNeighbors(db, "a"))).toEqual(new Set(["b", "c"]));
  });

  // ---- removeLink ----
  test("removeLink deletes the matching row only", () => {
    seedFacts(db, ["a", "b"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "a", "b", "contradicts");
    expect(removeLink(db, "a", "b", "supports")).toBe(true);
    expect(getLinks(db, "a", "out")).toHaveLength(1);
    expect(removeLink(db, "a", "b", "supports")).toBe(false); // already gone
  });

  // ---- ON DELETE CASCADE ----
  test("deleting a fact CASCADES its links (both directions)", () => {
    seedFacts(db, ["a", "b", "c"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "c", "a", "elaborates");
    db.run("DELETE FROM facts WHERE fact_id = 'a'");
    const remaining = db
      .query("SELECT COUNT(*) AS c FROM fact_links")
      .get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  test("archiving a fact does NOT cascade links (debate 003 Sonnet blindspot 3)", () => {
    seedFacts(db, ["a", "b"]);
    addLink(db, "a", "b", "supports");
    db.run("UPDATE facts SET archived_at = datetime('now') WHERE fact_id = 'a'");
    const remaining = db
      .query("SELECT COUNT(*) AS c FROM fact_links")
      .get() as { c: number };
    expect(remaining.c).toBe(1);
  });

  // ---- traverse (recursive CTE) ----
  test("traverse depth=0 returns only the origin", () => {
    seedFacts(db, ["a", "b", "c"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "b", "c", "supports");
    const result = traverse(db, "a", { maxDepth: 0 });
    expect(result.map((r) => r.fact_id)).toEqual(["a"]);
  });

  test("traverse depth=2 reaches grandchildren via 'out'", () => {
    seedFacts(db, ["a", "b", "c", "d"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "b", "c", "supports");
    addLink(db, "c", "d", "supports");
    const result = traverse(db, "a", { maxDepth: 2, direction: "out" });
    const ids = result.map((r) => r.fact_id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
    // d is at depth 3, beyond max
    expect(result.find((r) => r.fact_id === "d")).toBeUndefined();
  });

  test("traverse handles cycles without infinite loop", () => {
    seedFacts(db, ["a", "b", "c"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "b", "c", "supports");
    addLink(db, "c", "a", "supports"); // cycle a -> b -> c -> a
    const result = traverse(db, "a", { maxDepth: 5, direction: "out" });
    expect(result.map((r) => r.fact_id).sort()).toEqual(["a", "b", "c"]);
  });

  test("traverse 'both' direction works in undirected mode", () => {
    seedFacts(db, ["a", "b", "c"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "c", "a", "elaborates"); // c -> a
    const result = traverse(db, "a", { maxDepth: 1, direction: "both" });
    expect(result.map((r) => r.fact_id).sort()).toEqual(["a", "b", "c"]);
  });

  test("traverse filters by kinds", () => {
    seedFacts(db, ["a", "b", "c"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "a", "c", "contradicts");
    const result = traverse(db, "a", {
      maxDepth: 1,
      direction: "out",
      kinds: ["supports"],
    });
    expect(result.map((r) => r.fact_id).sort()).toEqual(["a", "b"]);
  });

  test("traverse excludes archived facts by default", () => {
    seedFacts(db, ["a", "b", "c"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "b", "c", "supports");
    db.run("UPDATE facts SET archived_at = datetime('now') WHERE fact_id = 'c'");
    const result = traverse(db, "a", { maxDepth: 5, direction: "out" });
    expect(result.map((r) => r.fact_id).sort()).toEqual(["a", "b"]);
  });

  test("traverse rejects negative maxDepth", () => {
    seedFacts(db, ["a"]);
    expect(() => traverse(db, "a", { maxDepth: -1 })).toThrow(/maxDepth/);
  });

  // ---- findOrphans ----
  test("findOrphans excludes new facts within age gate", () => {
    seedFacts(db, ["new", "old"]);
    ageFact(db, "old", 48); // 48h old
    // 'new' stays at now()
    expect(findOrphans(db, 24)).toEqual(["old"]);
  });

  test("findOrphans excludes facts with any link", () => {
    seedFacts(db, ["a", "b", "lonely"]);
    ageFact(db, "a", 48);
    ageFact(db, "b", 48);
    ageFact(db, "lonely", 48);
    addLink(db, "a", "b", "supports");
    expect(findOrphans(db, 24)).toEqual(["lonely"]);
  });

  test("findOrphans excludes archived facts", () => {
    seedFacts(db, ["a"]);
    ageFact(db, "a", 48);
    db.run("UPDATE facts SET archived_at = datetime('now') WHERE fact_id = 'a'");
    expect(findOrphans(db, 24)).toEqual([]);
  });

  // ---- connectedComponents ----
  test("connectedComponents: 3 isolated facts -> 3 components", () => {
    seedFacts(db, ["a", "b", "c"]);
    const { count, components } = connectedComponents(db);
    expect(count).toBe(3);
    expect(new Set(components.values()).size).toBe(3);
  });

  test("connectedComponents: a-b, c-d -> 2 components", () => {
    seedFacts(db, ["a", "b", "c", "d"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "c", "d", "supports");
    const { count, components } = connectedComponents(db);
    expect(count).toBe(2);
    expect(components.get("a")).toBe(components.get("b"));
    expect(components.get("c")).toBe(components.get("d"));
    expect(components.get("a")).not.toBe(components.get("c"));
  });

  test("connectedComponents skips archived facts", () => {
    seedFacts(db, ["a", "b"]);
    db.run("UPDATE facts SET archived_at = datetime('now') WHERE fact_id = 'b'");
    const { count } = connectedComponents(db);
    expect(count).toBe(1);
  });

  // ---- graphStats ----
  test("graphStats reports zeros on empty graph", () => {
    const stats = graphStats(db);
    expect(stats.totalFacts).toBe(0);
    expect(stats.totalLinks).toBe(0);
    expect(stats.density).toBe(0);
    expect(stats.orphanCount).toBe(0);
    expect(stats.componentCount).toBe(0);
  });

  test("graphStats density = links / facts", () => {
    seedFacts(db, ["a", "b", "c", "d"]);
    addLink(db, "a", "b", "supports");
    addLink(db, "c", "d", "supports");
    const stats = graphStats(db);
    expect(stats.totalFacts).toBe(4);
    expect(stats.totalLinks).toBe(2);
    expect(stats.density).toBe(0.5);
    expect(stats.componentCount).toBe(2);
  });
});
