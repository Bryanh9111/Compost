import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { msUntilNextBackupWindow, runBackupTick } from "../src/scheduler";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../../compost-core/src/schema/migrator";

/**
 * Audit fix #5 (debate 004): the backup scheduler must fire immediately
 * when a daemon starts inside the 03:00 UTC grace window AND no backup
 * exists for today. Without this, a 03:01 restart waits ~24h.
 */
describe("msUntilNextBackupWindow (audit fix #5)", () => {
  let backupDir: string;

  beforeEach(() => {
    backupDir = mkdtempSync(join(tmpdir(), "compost-sched-test-"));
  });

  afterEach(() => {
    rmSync(backupDir, { recursive: true, force: true });
  });

  test("at 02:59 UTC: returns ~1 minute until 03:00", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 2, 59, 0, 0));
    const ms = msUntilNextBackupWindow(backupDir, now);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(60_000);
  });

  test("at 03:00 UTC with no backup today: fires immediately (returns 0)", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 3, 0, 0, 0));
    expect(msUntilNextBackupWindow(backupDir, now)).toBe(0);
  });

  test("at 03:01 UTC with no backup today: fires immediately (grace window)", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 3, 1, 0, 0));
    expect(msUntilNextBackupWindow(backupDir, now)).toBe(0);
  });

  test("at 03:59 UTC with no backup today: fires immediately (grace window edge)", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 3, 59, 59, 0));
    expect(msUntilNextBackupWindow(backupDir, now)).toBe(0);
  });

  test("at 04:01 UTC with no backup today: waits until next day 03:00", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 4, 1, 0, 0));
    const ms = msUntilNextBackupWindow(backupDir, now);
    // ~22 hours 59 minutes
    expect(ms).toBeGreaterThan(22 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(24 * 60 * 60 * 1000);
  });

  test("at 03:30 UTC WITH backup file already for today: waits until tomorrow", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 3, 30, 0, 0));
    // Pre-create today's backup file
    writeFileSync(join(backupDir, "2026-04-15.db"), "fake-backup-content");
    const ms = msUntilNextBackupWindow(backupDir, now);
    // Within grace window but backup exists -> should NOT fire immediately
    expect(ms).toBeGreaterThan(0);
    // Should be ~23.5 hours until tomorrow 03:00 UTC
    expect(ms).toBeGreaterThan(23 * 60 * 60 * 1000);
  });

  test("at 12:00 UTC (mid-day, no backup): waits ~15 hours to next 03:00", () => {
    const now = new Date(Date.UTC(2026, 3, 15, 12, 0, 0, 0));
    const ms = msUntilNextBackupWindow(backupDir, now);
    expect(ms).toBeGreaterThan(14 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(16 * 60 * 60 * 1000);
  });
});

describe("runBackupTick", () => {
  let dir: string;
  let db: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "compost-backup-tick-"));
    db = new Database(join(dir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("backs up, prunes and compacts the vector index", async () => {
    let optimized = 0;
    const tick = await runBackupTick(db, {
      ledgerPath: join(dir, "ledger.db"),
      backupDir: join(dir, "backups"),
      vectorStore: { async optimize() { optimized++; } },
    });
    expect(tick.optimized).toBe(true);
    expect(tick.optimize_error).toBeUndefined();
    expect(tick.prunedCount).toBe(0);
    expect(tick.path).toMatch(/backups\/\d{4}-\d{2}-\d{2}\.db$/);
    expect(optimized).toBe(1);
  });

  test("an optimize failure is reported without failing the backup", async () => {
    const tick = await runBackupTick(db, {
      ledgerPath: join(dir, "ledger.db"),
      backupDir: join(dir, "backups"),
      vectorStore: { async optimize() { throw new Error("lance busy"); } },
    });
    expect(tick.optimized).toBe(false);
    expect(tick.optimize_error).toBe("lance busy");
    expect(tick.path).toContain("backups");
  });

  test("without a vector store the tick only snapshots", async () => {
    const tick = await runBackupTick(db, { ledgerPath: join(dir, "ledger.db"), backupDir: join(dir, "backups") });
    expect(tick.optimized).toBe(false);
  });
});
