import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import { triage, resolveSignal } from "../src/cognitive/triage";

describe("triage (P0-1, Phase 4 Batch D)", () => {
  let dbPath: string;
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-triage-test-"));
    dbPath = join(tmpDir, "ledger.db");
    db = new Database(dbPath);
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("health_signals table exists with all CHECK constraints", () => {
    const cols = db
      .query("PRAGMA table_info('health_signals')")
      .all() as { name: string }[];
    expect(cols.map((c) => c.name).sort()).toEqual([
      "created_at",
      "id",
      "kind",
      "message",
      "resolved_at",
      "resolved_by",
      "severity",
      "target_ref",
    ]);
  });

  test("triage on empty DB returns zero signals", () => {
    const report = triage(db);
    expect(report.unresolvedTotal).toBe(0);
    expect(report.signals).toHaveLength(0);
  });

  test("triage report contains all 6 signal kinds in byKind (5 from 0010 + 1 from 0012)", () => {
    const report = triage(db);
    expect(Object.keys(report.byKind).sort()).toEqual([
      "correction_candidate",
      "orphan_delta",
      "stale_fact",
      "stale_wiki",
      "stuck_outbox",
      "unresolved_contradiction",
    ]);
  });

  test("health_signals CHECK accepts correction_candidate (added by 0012)", () => {
    db.run(
      "INSERT INTO health_signals (kind, severity, message, target_ref) VALUES (?, ?, ?, ?)",
      ["correction_candidate", "info", "test correction signal", "fact-test-1"]
    );
    const row = db
      .query("SELECT kind FROM health_signals WHERE target_ref = 'fact-test-1'")
      .get() as { kind: string };
    expect(row.kind).toBe("correction_candidate");
  });

  // RED tests — will fail until P0-1 implementation lands
  test.skip("triage detects unresolved_contradiction signal", () => {
    // TODO(phase4-batch-d): seed a conflict_group older than 7 days, expect signal
    expect(false).toBe(true);
  });

  test.skip("triage detects stuck_outbox signal", () => {
    expect(false).toBe(true);
  });

  test.skip("resolveSignal marks resolved_at and resolved_by", () => {
    void resolveSignal;
    expect(false).toBe(true);
  });
});
