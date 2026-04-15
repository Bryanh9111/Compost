import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  CONFIDENCE_FLOORS,
  recordDecision,
  listDecisions,
} from "../src/cognitive/audit";

describe("decision_audit (P0-2, Phase 4 Batch D)", () => {
  let dbPath: string;
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-audit-test-"));
    dbPath = join(tmpDir, "ledger.db");
    db = new Database(dbPath);
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("decision_audit table exists with all expected columns", () => {
    const cols = db
      .query("PRAGMA table_info('decision_audit')")
      .all() as { name: string }[];
    expect(cols.map((c) => c.name).sort()).toEqual([
      "confidence_actual",
      "confidence_floor",
      "decided_at",
      "decided_by",
      "evidence_refs_json",
      "id",
      "kind",
      "rationale",
      "target_id",
    ]);
  });

  test("CONFIDENCE_FLOORS exports kernel/instance/exploration tiers", () => {
    expect(CONFIDENCE_FLOORS.kernel).toBe(0.9);
    expect(CONFIDENCE_FLOORS.instance).toBe(0.85);
    expect(CONFIDENCE_FLOORS.exploration).toBe(0.75);
  });

  test("listDecisions on empty DB returns []", () => {
    expect(listDecisions(db)).toEqual([]);
  });

  // ---- P0-2 Week 3 implementation tests ----

  test("recordDecision throws if confidence_actual < tier floor", () => {
    expect(() =>
      recordDecision(db, {
        kind: "wiki_rebuild",
        targetId: "wiki/test.md",
        confidenceTier: "kernel",
        confidenceActual: 0.85, // below 0.90 floor
        decidedBy: "wiki",
      })
    ).toThrow(/below kernel floor/);
  });

  test("recordDecision throws if evidenceRefs.kind mismatches entry.kind", () => {
    expect(() =>
      recordDecision(db, {
        kind: "wiki_rebuild",
        targetId: "wiki/test.md",
        confidenceTier: "instance",
        confidenceActual: 0.85,
        evidenceRefs: {
          kind: "contradiction_arbitration", // wrong!
          winner_id: "f1",
          loser_ids: ["f2"],
          subject: "x",
          predicate: "y",
        },
        decidedBy: "wiki",
      })
    ).toThrow(/does not match/);
  });

  test("recordDecision inserts with confidence_floor derived from tier", () => {
    const rec = recordDecision(db, {
      kind: "contradiction_arbitration",
      targetId: "cg-123",
      confidenceTier: "instance",
      confidenceActual: 0.9,
      rationale: "test",
      decidedBy: "reflect",
    });
    expect(rec.id).toBeGreaterThan(0);

    const row = db
      .query("SELECT confidence_floor, confidence_actual, rationale FROM decision_audit WHERE id = ?")
      .get(rec.id) as {
      confidence_floor: number;
      confidence_actual: number;
      rationale: string;
    };
    expect(row.confidence_floor).toBe(0.85);
    expect(row.confidence_actual).toBe(0.9);
    expect(row.rationale).toBe("test");
  });

  test("recordDecision serializes evidenceRefs as JSON", () => {
    const rec = recordDecision(db, {
      kind: "wiki_rebuild",
      targetId: "paris.md",
      confidenceTier: "instance",
      confidenceActual: 0.85,
      evidenceRefs: {
        kind: "wiki_rebuild",
        page_path: "paris.md",
        input_fact_ids: ["f1", "f2", "f3"],
        input_fact_count: 3,
      },
      decidedBy: "wiki",
    });
    const row = db
      .query("SELECT evidence_refs_json FROM decision_audit WHERE id = ?")
      .get(rec.id) as { evidence_refs_json: string };
    const parsed = JSON.parse(row.evidence_refs_json);
    expect(parsed.kind).toBe("wiki_rebuild");
    expect(parsed.input_fact_ids).toEqual(["f1", "f2", "f3"]);
    expect(parsed.input_fact_count).toBe(3);
  });

  test("listDecisions filters by kind", () => {
    recordDecision(db, {
      kind: "contradiction_arbitration",
      targetId: "cg-1",
      confidenceTier: "instance",
      confidenceActual: 0.85,
      decidedBy: "reflect",
    });
    recordDecision(db, {
      kind: "wiki_rebuild",
      targetId: "page.md",
      confidenceTier: "instance",
      confidenceActual: 0.85,
      decidedBy: "wiki",
    });
    expect(listDecisions(db, { kind: "wiki_rebuild" })).toHaveLength(1);
    expect(listDecisions(db, { kind: "contradiction_arbitration" })).toHaveLength(1);
    expect(listDecisions(db)).toHaveLength(2);
  });

  test("listDecisions filters by targetId + decidedBy", () => {
    recordDecision(db, {
      kind: "wiki_rebuild",
      targetId: "a.md",
      confidenceTier: "instance",
      confidenceActual: 0.85,
      decidedBy: "wiki",
    });
    recordDecision(db, {
      kind: "wiki_rebuild",
      targetId: "b.md",
      confidenceTier: "instance",
      confidenceActual: 0.85,
      decidedBy: "wiki",
    });
    expect(listDecisions(db, { targetId: "a.md" })).toHaveLength(1);
    expect(listDecisions(db, { decidedBy: "reflect" })).toHaveLength(0);
    expect(listDecisions(db, { decidedBy: "wiki" })).toHaveLength(2);
  });

  test("listDecisions respects limit", () => {
    for (let i = 0; i < 5; i++) {
      recordDecision(db, {
        kind: "wiki_rebuild",
        targetId: `p${i}.md`,
        confidenceTier: "instance",
        confidenceActual: 0.85,
        decidedBy: "wiki",
      });
    }
    expect(listDecisions(db, { limit: 3 })).toHaveLength(3);
  });

  test("listDecisions round-trips evidenceRefs and tier mapping", () => {
    recordDecision(db, {
      kind: "fact_excretion",
      targetId: "reflect:batch-1",
      confidenceTier: "exploration",
      confidenceActual: 0.75,
      evidenceRefs: {
        kind: "fact_excretion",
        fact_ids: ["f1", "f2"],
        reason: "duplicate",
        count: 2,
      },
      decidedBy: "reflect",
    });
    const [rec] = listDecisions(db);
    expect(rec.confidenceTier).toBe("exploration");
    expect(rec.evidenceRefs).toEqual({
      kind: "fact_excretion",
      fact_ids: ["f1", "f2"],
      reason: "duplicate",
      count: 2,
    });
  });
});
