import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  CORRECTION_PATTERNS,
  detectCorrection,
  recordCorrection,
  findRelatedFacts,
} from "../src/cognitive/correction-detector";

describe("correction-detector (P0-5, Phase 4 Batch D)", () => {
  let dbPath: string;
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-correction-test-"));
    dbPath = join(tmpDir, "ledger.db");
    db = new Database(dbPath);
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("correction_events table exists", () => {
    const cols = db
      .query("PRAGMA table_info('correction_events')")
      .all() as { name: string }[];
    expect(cols.map((c) => c.name).sort()).toEqual([
      "corrected_text",
      "created_at",
      "id",
      "pattern_matched",
      "processed_at",
      "related_fact_ids_json",
      "retracted_text",
      "session_id",
    ]);
  });

  test("CORRECTION_PATTERNS exports at least 5 patterns covering ZH + EN", () => {
    expect(CORRECTION_PATTERNS.length).toBeGreaterThanOrEqual(5);
    const names = CORRECTION_PATTERNS.map((p) => p.name);
    expect(names.some((n) => n.startsWith("zh."))).toBe(true);
    expect(names.some((n) => n.startsWith("en."))).toBe(true);
  });

  test("detectCorrection matches Chinese self-correction", () => {
    const result = detectCorrection("我之前说的 X 是错的, 实际上应该是 Y");
    expect(result).not.toBeNull();
    expect(result!.patternName).toMatch(/zh\./);
  });

  test("detectCorrection matches English self-correction", () => {
    const result = detectCorrection("Wait, I was wrong about the migration count");
    expect(result).not.toBeNull();
    expect(result!.patternName).toMatch(/en\./);
  });

  test("detectCorrection returns null on neutral text", () => {
    expect(detectCorrection("The weather is nice today.")).toBeNull();
    expect(detectCorrection("讨论一下这个 PR 的设计")).toBeNull();
  });

  // RED tests — will fail until P0-5 implementation lands
  test.skip("recordCorrection inserts row and returns id", () => {
    void recordCorrection;
    expect(false).toBe(true);
  });

  test.skip("findRelatedFacts returns fact_ids matching subject/object overlap", () => {
    void findRelatedFacts;
    expect(false).toBe(true);
  });
});
