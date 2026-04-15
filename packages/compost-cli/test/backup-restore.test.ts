import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../../compost-core/src/schema/migrator";

/**
 * Audit fix #4 (debate 004) — restore must distinguish a stale PID file
 * from a live daemon. existsSync alone is wrong: a crashed daemon leaves
 * the file behind, and treating that as "running" blocks restore until
 * the user manually rms the file.
 *
 * These tests drive the CLI via subprocess (Bun.spawn) because the PID
 * check + process.exit semantics are real-system-dependent.
 */

const CLI_ENTRY = join(__dirname, "..", "src", "main.ts");

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], dataDir: string): Promise<CliResult> {
  const proc = Bun.spawn({
    cmd: ["bun", CLI_ENTRY, ...args],
    env: { ...process.env, COMPOST_DATA_DIR: dataDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

describe("compost backup / restore CLI (audit fix #4)", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "compost-backup-cli-"));
    // Initialize ledger so backup has something real to snapshot
    const db = new Database(join(dataDir, "ledger.db"), { create: true });
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    db.close();
    mkdirSync(join(dataDir, "backups"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("backup CLI succeeds and writes JSON output", async () => {
    const r = await runCli(["backup"], dataDir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('"path"');
    expect(r.stdout).toContain('"prunedCount"');
  });

  test("restore refuses when daemon PID file points to a live process", async () => {
    // First take a backup so restore has something to choose
    const b = await runCli(["backup"], dataDir);
    expect(b.exitCode).toBe(0);

    // Write our own PID into the pid file -- this process IS alive
    const pidFile = join(dataDir, "compost.pid");
    writeFileSync(pidFile, String(process.pid));

    const r = await runCli(["restore"], dataDir);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/daemon running/i);
    // PID file must be preserved (still live)
    expect(existsSync(pidFile)).toBe(true);
  });

  test("restore proceeds when PID file references a dead process (stale)", async () => {
    await runCli(["backup"], dataDir);

    // Write a PID that does not exist. PID 1 is always alive on Unix, so
    // pick a high number unlikely to collide.
    const pidFile = join(dataDir, "compost.pid");
    const fakeStalePid = 9999998;
    writeFileSync(pidFile, String(fakeStalePid));

    const r = await runCli(["restore"], dataDir);
    expect(r.exitCode).toBe(0);
    // Stale PID file should have been cleaned up
    expect(existsSync(pidFile)).toBe(false);
  });

  test("restore handles unreadable/garbage PID file as stale", async () => {
    await runCli(["backup"], dataDir);
    const pidFile = join(dataDir, "compost.pid");
    writeFileSync(pidFile, "not-a-number\n");
    const r = await runCli(["restore"], dataDir);
    expect(r.exitCode).toBe(0);
  });
});
