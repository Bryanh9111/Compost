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

  // RED tests — will fail until P0-2 implementation lands
  test.skip("recordDecision throws if confidence_actual < tier floor", () => {
    expect(() =>
      recordDecision(db, {
        kind: "wiki_rebuild",
        targetId: "wiki/test",
        confidenceTier: "kernel",
        confidenceActual: 0.85, // below 0.90 floor
        decidedBy: "wiki",
      })
    ).toThrow();
  });

  test.skip("recordDecision inserts row with correct floor mapping", () => {
    expect(false).toBe(true);
  });

  test.skip("listDecisions filters by kind and sinceIso", () => {
    expect(false).toBe(true);
  });
});
