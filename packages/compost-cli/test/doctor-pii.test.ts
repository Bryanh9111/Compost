import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { upsertPolicies } from "../../compost-core/src/policies/registry";
import {
  isFatalLlmProbeError,
  parsePositiveInteger,
} from "../src/commands/doctor";

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

function setupDb(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dataDir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  upsertPolicies(db);
  return db;
}

function insertOutboxRow(
  db: Database,
  sourceId: string,
  payload: string
): void {
  db.run(
    `INSERT INTO observe_outbox
      (adapter, source_id, source_kind, source_uri, idempotency_key,
       trust_tier, transform_policy, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "test-adapter",
      sourceId,
      "claude-code",
      `claude-code://${sourceId}`,
      `key-${sourceId}-${payload.length}`,
      "first_party",
      "tp-2026-04",
      payload,
    ]
  );
}

describe("doctor --check-pii", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "compost-doctor-pii-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("reports zero findings on clean DB", async () => {
    const db = setupDb(dataDir);
    insertOutboxRow(db, "s1", JSON.stringify({ plain: "clean text" }));
    db.close();

    const result = await runCli(["doctor", "--check-pii"], dataDir);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.rows_scanned).toBe(1);
    expect(report.rows_with_pii).toBe(0);
    expect(report.total_redactions).toBe(0);
  });

  test("detects CC in outbox payload and reports sample", async () => {
    const db = setupDb(dataDir);
    insertOutboxRow(
      db,
      "s-with-cc",
      JSON.stringify({ note: "card 4532015112830366" })
    );
    insertOutboxRow(db, "s-clean", JSON.stringify({ plain: "safe" }));
    db.close();

    const result = await runCli(["doctor", "--check-pii"], dataDir);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.rows_scanned).toBe(2);
    expect(report.rows_with_pii).toBe(1);
    expect(report.total_redactions).toBeGreaterThanOrEqual(1);
    expect(report.sample_sources).toBeArray();
    expect(report.sample_sources[0].source_id).toBe("s-with-cc");
    expect(report.hint).toContain("PII found");
  });

  test("detects multiple PII types across rows", async () => {
    const db = setupDb(dataDir);
    insertOutboxRow(
      db,
      "s-token",
      JSON.stringify({ cmd: "ghp_1234567890abcdefghijklmnopqrstuvwxyz" })
    );
    insertOutboxRow(
      db,
      "s-cc",
      JSON.stringify({ note: "card 4532015112830366" })
    );
    db.close();

    const result = await runCli(["doctor", "--check-pii"], dataDir);
    const report = JSON.parse(result.stdout);
    expect(report.rows_with_pii).toBe(2);
    expect(report.total_redactions).toBeGreaterThanOrEqual(2);
  });
});

describe("doctor --check-integrity", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "compost-doctor-integrity-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("reports zero issues on fresh empty DB", async () => {
    const db = setupDb(dataDir);
    db.close();

    const result = await runCli(["doctor", "--check-integrity"], dataDir);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.orphan_observations).toBe(0);
    expect(report.dangling_fact_links).toBe(0);
    expect(report.stale_wiki_pages).toBe(0);
    expect(report.unknown_transform_policies.in_observe_outbox).toBe(0);
    expect(report.unknown_transform_policies.in_observations).toBe(0);
    expect(report.total_issues).toBe(0);
  });

  test("detects orphan observations (observation without derivation_run)", async () => {
    const db = setupDb(dataDir);
    // Insert source first (FK dependency)
    db.run(
      `INSERT INTO source (id, uri, kind, trust_tier)
       VALUES ('orphan-src', 'test://orphan', 'local-file', 'first_party')`
    );
    db.run(
      `INSERT INTO observations
        (observe_id, source_id, source_uri, occurred_at, captured_at,
         content_hash, raw_hash, mime_type, adapter, adapter_sequence,
         trust_tier, idempotency_key, transform_policy)
       VALUES ('obs-orphan-1', 'orphan-src', 'test://orphan',
               datetime('now'), datetime('now'),
               'hash1', 'raw1', 'text/plain', 'test-adapter', 1,
               'first_party', 'idem-orphan-1', 'tp-2026-04')`
    );
    db.close();

    const result = await runCli(["doctor", "--check-integrity"], dataDir);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.orphan_observations).toBe(1);
    expect(report.total_issues).toBeGreaterThanOrEqual(1);
    expect(report.hint).toContain("Integrity issues detected");
  });

  test("detects unknown transform_policy in observe_outbox", async () => {
    const db = setupDb(dataDir);
    db.run(
      `INSERT INTO observe_outbox
        (adapter, source_id, source_kind, source_uri, idempotency_key,
         trust_tier, transform_policy, payload)
       VALUES ('test', 's1', 'claude-code', 'claude-code://s1', 'k1',
               'first_party', 'tp-nonexistent-2099', '{}')`
    );
    db.close();

    const result = await runCli(["doctor", "--check-integrity"], dataDir);
    const report = JSON.parse(result.stdout);
    expect(report.unknown_transform_policies.in_observe_outbox).toBe(1);
    expect(report.total_issues).toBeGreaterThanOrEqual(1);
  });
});

describe("doctor argument validation", () => {
  test("reports error when no option is specified", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "compost-doctor-noarg-"));
    const db = setupDb(dataDir);
    db.close();

    const result = await runCli(["doctor"], dataDir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--check-pii");
    expect(result.stderr).toContain("--check-integrity");

    rmSync(dataDir, { recursive: true, force: true });
  });
});

describe("doctor --check-llm helpers", () => {
  test("parses positive integer options with fallback", () => {
    expect(parsePositiveInteger(undefined, 3000)).toBe(3000);
    expect(parsePositiveInteger("12000", 3000)).toBe(12000);
    expect(parsePositiveInteger(4500, 3000)).toBe(4500);
    expect(parsePositiveInteger("0", 3000)).toBe(3000);
    expect(parsePositiveInteger("not-a-number", 3000)).toBe(3000);
  });

  test("treats quick generation timeout as warning unless strict", () => {
    const timeout = { name: "AbortError", message: "The operation was aborted." };
    const realError = { name: "Error", message: "model not found" };

    expect(isFatalLlmProbeError(timeout, false)).toBe(false);
    expect(isFatalLlmProbeError(timeout, true)).toBe(true);
    expect(isFatalLlmProbeError(realError, false)).toBe(true);
  });
});
