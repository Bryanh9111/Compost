import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import { reflect } from "../src/cognitive/reflect";

/**
 * P0-4 tests: verify reflect.ts writes archive_reason and replaced_by_fact_id
 * per the docs/ARCHITECTURE.md frozen enum.
 *
 * Behavior validated:
 * - Step 2 (decay tombstone): archive_reason = 'stale'
 * - Step 3 (contradiction loser): archive_reason = 'contradicted',
 *   replaced_by_fact_id = winner, archived_at = now
 */

function seedSemanticChain(db: Database): void {
  // 'local-file' is in the source.kind CHECK enum (see migration 0001).
  // Reflect step 1 only GCs sensory observations — non-sensory facts stay
  // until step 2 decay-tombstones them or step 3 archives a contradicted loser.
  db.run(
    "INSERT INTO source VALUES ('s1','file:///x','local-file',NULL,0.0,'user',datetime('now'),NULL)"
  );
  db.run(
    "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','test',1,'user','idem','tp-2026-04',NULL,NULL,NULL)"
  );
}

function insertFact(
  db: Database,
  factId: string,
  subject: string,
  predicate: string,
  object: string,
  opts: { confidence?: number; importance?: number; daysAgo?: number } = {}
): void {
  const conf = opts.confidence ?? 0.8;
  const imp = opts.importance ?? 0.5;
  db.run(
    "INSERT INTO facts(fact_id, subject, predicate, object, observe_id, confidence, importance) VALUES (?,?,?,?,?,?,?)",
    [factId, subject, predicate, object, "obs1", conf, imp]
  );
  if (opts.daysAgo) {
    db.run(
      "UPDATE facts SET created_at = datetime('now', ?) WHERE fact_id = ?",
      [`-${opts.daysAgo} days`, factId]
    );
  }
}

describe("reflect archive_reason writes (P0-4, Phase 4 Batch D)", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-archreason-test-"));
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    seedSemanticChain(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("Step 2 decay tombstone writes archive_reason='stale'", () => {
    // Decay formula: importance * 0.5^(elapsed/half_life) < DECAY_THRESHOLD (0.001).
    // We pick importance < 0.001 so the fact tombstones on the first reflect
    // regardless of elapsed time / half-life — the focus of this test is the
    // archive_reason write, not the decay math.
    insertFact(db, "stale-1", "old-subject", "fades", "into-noise", {
      confidence: 0.5,
      importance: 0.0001,
    });

    const report = reflect(db);
    expect(report.semanticFactsTombstoned).toBeGreaterThanOrEqual(1);

    const row = db
      .query(
        "SELECT archived_at, archive_reason FROM facts WHERE fact_id = 'stale-1'"
      )
      .get() as { archived_at: string | null; archive_reason: string | null };
    expect(row.archived_at).not.toBeNull();
    expect(row.archive_reason).toBe("stale");
  });

  test("Step 3 contradiction loser gets archive_reason='contradicted' + replaced_by_fact_id", () => {
    // Two facts with same (subject, predicate), different object
    // Winner picked by higher confidence
    insertFact(db, "winner", "paris", "capital-of", "france", { confidence: 0.95 });
    insertFact(db, "loser", "paris", "capital-of", "england", { confidence: 0.3 });

    const report = reflect(db);
    expect(report.contradictionsResolved).toBeGreaterThanOrEqual(1);

    const loser = db
      .query(
        "SELECT archived_at, archive_reason, replaced_by_fact_id, superseded_by, conflict_group " +
          "FROM facts WHERE fact_id = 'loser'"
      )
      .get() as {
      archived_at: string | null;
      archive_reason: string | null;
      replaced_by_fact_id: string | null;
      superseded_by: string | null;
      conflict_group: string | null;
    };
    expect(loser.archived_at).not.toBeNull();
    expect(loser.archive_reason).toBe("contradicted");
    expect(loser.replaced_by_fact_id).toBe("winner");
    expect(loser.superseded_by).toBe("winner");
    expect(loser.conflict_group).toMatch(/^cg-/);

    // Winner stays active but is in the same conflict_group
    const winner = db
      .query(
        "SELECT archived_at, archive_reason, conflict_group FROM facts WHERE fact_id = 'winner'"
      )
      .get() as {
      archived_at: string | null;
      archive_reason: string | null;
      conflict_group: string | null;
    };
    expect(winner.archived_at).toBeNull();
    expect(winner.archive_reason).toBeNull();
    expect(winner.conflict_group).toMatch(/^cg-/);
  });

  test("contradicted loser is removed from active queries (no longer triggers re-resolution)", () => {
    insertFact(db, "winner", "paris", "capital-of", "france", { confidence: 0.9 });
    insertFact(db, "loser", "paris", "capital-of", "england", { confidence: 0.5 });

    const r1 = reflect(db);
    expect(r1.contradictionsResolved).toBe(1);

    // Second reflect must NOT re-resolve the same conflict (loser is archived)
    const r2 = reflect(db);
    expect(r2.contradictionsResolved).toBe(0);
  });

  test("does NOT archive multi-valued extraction predicates", () => {
    insertFact(db, "d1", "repo-a", "describes", "a CLI tool", { confidence: 0.9 });
    insertFact(db, "d2", "repo-a", "describes", "an MCP server", {
      confidence: 0.8,
    });
    insertFact(db, "h1", "repo-b", "has_architecture", "SQLite storage", {
      confidence: 0.9,
    });
    insertFact(db, "h2", "repo-b", "has_architecture", "Bun CLI", {
      confidence: 0.8,
    });

    const report = reflect(db);
    expect(report.contradictionsResolved).toBe(0);

    const active = db
      .query(
        "SELECT COUNT(*) AS c FROM facts WHERE fact_id IN ('d1','d2','h1','h2') AND archived_at IS NULL"
      )
      .get() as { c: number };
    expect(active.c).toBe(4);

    const audits = db
      .query("SELECT COUNT(*) AS c FROM decision_audit WHERE kind = 'contradiction_arbitration'")
      .get() as { c: number };
    expect(audits.c).toBe(0);

    const links = db
      .query("SELECT COUNT(*) AS c FROM fact_links WHERE kind = 'contradicts'")
      .get() as { c: number };
    expect(links.c).toBe(0);
  });

  test("does NOT archive unknown LLM-style predicates by default", () => {
    insertFact(db, "r1", "service-a", "runs_on", "linux", { confidence: 0.9 });
    insertFact(db, "r2", "service-a", "runs_on", "macos", { confidence: 0.8 });

    const report = reflect(db);
    expect(report.contradictionsResolved).toBe(0);

    const active = db
      .query(
        "SELECT COUNT(*) AS c FROM facts WHERE fact_id IN ('r1','r2') AND archived_at IS NULL"
      )
      .get() as { c: number };
    expect(active.c).toBe(2);
  });

  test("manual-archived fact already has archive_reason='manual' preserved (no overwrite)", () => {
    insertFact(db, "manual-1", "user-curated", "decided", "to-forget", {
      confidence: 0.5,
      importance: 0.001,
      daysAgo: 30,
    });
    db.run(
      "UPDATE facts SET archived_at = datetime('now'), archive_reason = 'manual' WHERE fact_id = 'manual-1'"
    );

    // reflect's step 2 only operates on archived_at IS NULL, so this row is
    // not touched. archive_reason stays 'manual'.
    const before = db
      .query("SELECT archive_reason FROM facts WHERE fact_id = 'manual-1'")
      .get() as { archive_reason: string };
    expect(before.archive_reason).toBe("manual");

    reflect(db);

    const after = db
      .query("SELECT archive_reason FROM facts WHERE fact_id = 'manual-1'")
      .get() as { archive_reason: string };
    expect(after.archive_reason).toBe("manual");
  });

  test("archive_reason CHECK constraint: 'stale' is in the allowed enum", () => {
    // Sanity: confirm the migration enum lists what reflect now writes.
    insertFact(db, "f-stale", "s", "p", "o");
    db.run(
      "UPDATE facts SET archived_at = datetime('now'), archive_reason = 'stale' WHERE fact_id = 'f-stale'"
    );
    const row = db
      .query("SELECT archive_reason FROM facts WHERE fact_id = 'f-stale'")
      .get() as { archive_reason: string };
    expect(row.archive_reason).toBe("stale");
  });

  test("archive_reason CHECK constraint: 'contradicted' is in the allowed enum", () => {
    insertFact(db, "f-c", "s", "p", "o");
    db.run(
      "UPDATE facts SET archived_at = datetime('now'), archive_reason = 'contradicted' WHERE fact_id = 'f-c'"
    );
    const row = db
      .query("SELECT archive_reason FROM facts WHERE fact_id = 'f-c'")
      .get() as { archive_reason: string };
    expect(row.archive_reason).toBe("contradicted");
  });

  // ---- Audit fix #1 (debate 004): multi-conflict cg + loser dedup ----

  test("3-way conflict: each loser points to single strongest winner (deterministic)", () => {
    // Same (subject, predicate), three different objects with descending confidence.
    // Strongest is 'a' (0.95), then 'b' (0.7), then 'c' (0.4).
    insertFact(db, "a", "paris", "capital-of", "france", { confidence: 0.95 });
    insertFact(db, "b", "paris", "capital-of", "england", { confidence: 0.7 });
    insertFact(db, "c", "paris", "capital-of", "spain", { confidence: 0.4 });

    const report = reflect(db);
    // Both b and c should be archived as losers, exactly once each.
    expect(report.contradictionsResolved).toBe(2);

    const b = db
      .query(
        "SELECT archive_reason, replaced_by_fact_id, superseded_by FROM facts WHERE fact_id = 'b'"
      )
      .get() as {
      archive_reason: string;
      replaced_by_fact_id: string;
      superseded_by: string;
    };
    const c = db
      .query(
        "SELECT archive_reason, replaced_by_fact_id, superseded_by FROM facts WHERE fact_id = 'c'"
      )
      .get() as {
      archive_reason: string;
      replaced_by_fact_id: string;
      superseded_by: string;
    };

    // Both losers point to the cluster's strongest winner ('a'), not each other
    expect(b.archive_reason).toBe("contradicted");
    expect(b.replaced_by_fact_id).toBe("a");
    expect(b.superseded_by).toBe("a");
    expect(c.archive_reason).toBe("contradicted");
    expect(c.replaced_by_fact_id).toBe("a");
    expect(c.superseded_by).toBe("a");
  });

  test("two unrelated arbitrations get distinct conflict_group ids", () => {
    // Cluster 1: paris.capital-of.france vs paris.capital-of.england
    insertFact(db, "earth-w", "paris", "capital-of", "france", { confidence: 0.9 });
    insertFact(db, "earth-l", "paris", "capital-of", "england", { confidence: 0.4 });
    // Cluster 2: berlin.capital-of.germany vs berlin.capital-of.austria
    insertFact(db, "sky-w", "berlin", "capital-of", "germany", { confidence: 0.9 });
    insertFact(db, "sky-l", "berlin", "capital-of", "austria", { confidence: 0.4 });

    reflect(db);

    const winnerEarth = db
      .query("SELECT conflict_group FROM facts WHERE fact_id = 'earth-w'")
      .get() as { conflict_group: string };
    const winnerSky = db
      .query("SELECT conflict_group FROM facts WHERE fact_id = 'sky-w'")
      .get() as { conflict_group: string };
    expect(winnerEarth.conflict_group).not.toBe(winnerSky.conflict_group);
    expect(winnerEarth.conflict_group).toMatch(/^cg-/);
    expect(winnerSky.conflict_group).toMatch(/^cg-/);
  });

  test("3-way conflict: report.contradictionsResolved counts losers, not raw pairs", () => {
    // 3 objects -> SQL returns 3 pairs (a>b, a>c, b>c) but only 2 losers
    insertFact(db, "a", "paris", "capital-of", "france", { confidence: 0.9 });
    insertFact(db, "b", "paris", "capital-of", "england", { confidence: 0.7 });
    insertFact(db, "c", "paris", "capital-of", "spain", { confidence: 0.4 });
    const report = reflect(db);
    expect(report.contradictionsResolved).toBe(2);
  });

  // ---- Debate 005 fix #1: contradiction creates fact_links edges ----

  test("contradiction resolution writes 'contradicts' edges to fact_links", () => {
    insertFact(db, "winner", "paris", "capital-of", "france", { confidence: 0.95 });
    insertFact(db, "loser", "paris", "capital-of", "england", { confidence: 0.3 });

    reflect(db);

    const edge = db
      .query(
        "SELECT from_fact_id, to_fact_id, kind FROM fact_links WHERE from_fact_id = 'loser'"
      )
      .get() as { from_fact_id: string; to_fact_id: string; kind: string } | null;
    expect(edge).not.toBeNull();
    expect(edge!.from_fact_id).toBe("loser");
    expect(edge!.to_fact_id).toBe("winner");
    expect(edge!.kind).toBe("contradicts");
  });

  test("3-way conflict creates one 'contradicts' edge per loser (not per SQL pair)", () => {
    insertFact(db, "a", "paris", "capital-of", "france", { confidence: 0.9 });
    insertFact(db, "b", "paris", "capital-of", "england", { confidence: 0.7 });
    insertFact(db, "c", "paris", "capital-of", "spain", { confidence: 0.4 });

    reflect(db);

    const edges = db
      .query(
        "SELECT from_fact_id, to_fact_id FROM fact_links WHERE kind = 'contradicts' ORDER BY from_fact_id"
      )
      .all() as Array<{ from_fact_id: string; to_fact_id: string }>;
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e.to_fact_id).toBe("a");
    }
    expect(new Set(edges.map((e) => e.from_fact_id))).toEqual(new Set(["b", "c"]));
  });

  // ---- P0-2 Week 3: reflect writes contradiction_arbitration audit ----

  test("reflect step 3 writes one contradiction_arbitration audit row per cluster", () => {
    insertFact(db, "winner", "paris", "capital-of", "france", { confidence: 0.95 });
    insertFact(db, "loser", "paris", "capital-of", "england", { confidence: 0.3 });

    reflect(db);

    const audit = db
      .query(
        "SELECT kind, target_id, confidence_floor, evidence_refs_json, decided_by FROM decision_audit WHERE kind = 'contradiction_arbitration'"
      )
      .get() as {
      kind: string;
      target_id: string;
      confidence_floor: number;
      evidence_refs_json: string;
      decided_by: string;
    };
    expect(audit.kind).toBe("contradiction_arbitration");
    expect(audit.target_id).toMatch(/^cg-/);
    expect(audit.confidence_floor).toBe(0.85);
    expect(audit.decided_by).toBe("reflect");

    const ev = JSON.parse(audit.evidence_refs_json);
    expect(ev.kind).toBe("contradiction_arbitration");
    expect(ev.winner_id).toBe("winner");
    expect(ev.loser_ids).toEqual(["loser"]);
    expect(ev.subject).toBe("paris");
    expect(ev.predicate).toBe("capital-of");
  });

  test("reflect step 3: 3-way cluster records one audit row with plural loser_ids", () => {
    insertFact(db, "a", "paris", "capital-of", "france", { confidence: 0.9 });
    insertFact(db, "b", "paris", "capital-of", "england", { confidence: 0.7 });
    insertFact(db, "c", "paris", "capital-of", "spain", { confidence: 0.4 });

    reflect(db);

    const auditRows = db
      .query(
        "SELECT evidence_refs_json FROM decision_audit WHERE kind = 'contradiction_arbitration'"
      )
      .all() as Array<{ evidence_refs_json: string }>;
    expect(auditRows).toHaveLength(1);
    const ev = JSON.parse(auditRows[0]!.evidence_refs_json);
    expect(ev.winner_id).toBe("a");
    expect(new Set(ev.loser_ids)).toEqual(new Set(["b", "c"]));
  });

  test("reflect step 2 stale tombstone does NOT write an audit row (contract: 'none')", () => {
    insertFact(db, "stale-1", "old", "p", "o", {
      confidence: 0.5,
      importance: 0.0001,
    });
    reflect(db);

    const auditCount = db
      .query("SELECT COUNT(*) AS c FROM decision_audit")
      .get() as { c: number };
    expect(auditCount.c).toBe(0);
  });

  test("reflect with no conflicts writes no contradiction_arbitration rows", () => {
    insertFact(db, "alone", "x", "p", "v", { confidence: 0.9 });
    reflect(db);
    const count = db
      .query("SELECT COUNT(*) AS c FROM decision_audit WHERE kind = 'contradiction_arbitration'")
      .get() as { c: number };
    expect(count.c).toBe(0);
  });
});
