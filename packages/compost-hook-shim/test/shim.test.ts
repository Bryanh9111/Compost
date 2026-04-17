import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We test the shim by spawning it as a subprocess (like Claude Code would)
// using Bun to run the TS source directly.

const SHIM_PATH = join(import.meta.dir, "../src/index.ts");

function makeEnvelope(sessionId: string = "test-session") {
  return JSON.stringify({
    hook_event_name: "SessionStart",
    session_id: sessionId,
    cwd: "/tmp/test-project",
    timestamp: new Date().toISOString(),
    payload: { test: true },
  });
}

describe("compost-hook-shim", () => {
  let tmpDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-shim-"));
    dataDir = join(tmpDir, "compost");
    // Create data dir and initialize DB with migrations
    const { mkdirSync } = require("fs");
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });

    // Apply migrations so observe_outbox table exists
    const { applyMigrations } = require("../../compost-core/src/schema/migrator");
    const { upsertPolicies } = require("../../compost-core/src/policies/registry");
    const db = new Database(join(dataDir, "ledger.db"));
    applyMigrations(db);
    upsertPolicies(db);
    db.close();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("shim writes to observe_outbox and exits 0", async () => {
    const envelope = makeEnvelope();
    const proc = Bun.spawn(["bun", SHIM_PATH, "session-start"], {
      stdin: new Blob([envelope]),
      env: { ...process.env, COMPOST_DATA_DIR: dataDir },
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const db = new Database(join(dataDir, "ledger.db"));
    const row = db
      .query("SELECT * FROM observe_outbox WHERE seq = 1")
      .get() as Record<string, unknown>;
    db.close();

    expect(row).toBeTruthy();
    expect(row.adapter).toBe("compost-adapter-claude-code");
    expect(row.source_kind).toBe("claude-code");
    expect(row.drained_at).toBeNull();
  });

  test("shim is idempotent (same envelope = same idempotency_key)", async () => {
    const envelope = makeEnvelope("fixed-session");

    // Run twice with same payload
    for (let i = 0; i < 2; i++) {
      const proc = Bun.spawn(["bun", SHIM_PATH, "session-start"], {
        stdin: new Blob([envelope]),
        env: { ...process.env, COMPOST_DATA_DIR: dataDir },
      });
      await proc.exited;
    }

    const db = new Database(join(dataDir, "ledger.db"));
    const count = db
      .query("SELECT count(*) as cnt FROM observe_outbox")
      .get() as { cnt: number };
    db.close();

    expect(count.cnt).toBe(1);
  });

  test("shim exits 2 on missing event name", async () => {
    const proc = Bun.spawn(["bun", SHIM_PATH], {
      stdin: new Blob([makeEnvelope()]),
      env: { ...process.env, COMPOST_DATA_DIR: dataDir },
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(2);
  });

  test("shim exits 0 on measurement-warmup with empty stdin", async () => {
    const proc = Bun.spawn(["bun", SHIM_PATH, "measurement-warmup"], {
      stdin: new Blob([""]),
      env: { ...process.env, COMPOST_DATA_DIR: dataDir },
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("shim cold-start is under 200ms (sanity check, not ship gate)", async () => {
    const envelope = makeEnvelope(`perf-${Date.now()}`);
    const t0 = performance.now();
    const proc = Bun.spawn(["bun", SHIM_PATH, "session-start"], {
      stdin: new Blob([envelope]),
      env: { ...process.env, COMPOST_DATA_DIR: dataDir },
    });
    await proc.exited;
    const elapsed = performance.now() - t0;

    // Sanity check: should be well under 200ms on any modern machine
    // The real ship gate (p95 < 30ms) is enforced by compost doctor --measure-hook
    expect(elapsed).toBeLessThan(200);
  });

  test("shim redacts PII (credit card) from payload before writing outbox", async () => {
    const dirtyEnvelope = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "pii-test-cc",
      cwd: "/tmp/test-project",
      timestamp: new Date().toISOString(),
      payload: { user_said: "my card is 4532015112830366 please charge" },
    });
    const proc = Bun.spawn(["bun", SHIM_PATH, "pre-tool-use"], {
      stdin: new Blob([dirtyEnvelope]),
      env: { ...process.env, COMPOST_DATA_DIR: dataDir },
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const db = new Database(join(dataDir, "ledger.db"));
    const row = db
      .query("SELECT payload FROM observe_outbox WHERE source_id LIKE '%pii-test-cc%'")
      .get() as { payload: string };
    db.close();

    expect(row).toBeTruthy();
    expect(row.payload).not.toContain("4532015112830366");
    expect(row.payload).toContain("[REDACTED_CC]");
  });

  test("shim redacts API token from payload", async () => {
    const dirtyEnvelope = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "pii-test-token",
      cwd: "/tmp/test-project",
      timestamp: new Date().toISOString(),
      payload: {
        command: "curl -H 'Authorization: Bearer abc.def.ghijklmnopqrstuv'",
      },
    });
    const proc = Bun.spawn(["bun", SHIM_PATH, "pre-tool-use"], {
      stdin: new Blob([dirtyEnvelope]),
      env: { ...process.env, COMPOST_DATA_DIR: dataDir },
    });
    await proc.exited;

    const db = new Database(join(dataDir, "ledger.db"));
    const row = db
      .query("SELECT payload FROM observe_outbox WHERE source_id LIKE '%pii-test-token%'")
      .get() as { payload: string };
    db.close();

    expect(row.payload).not.toContain("abc.def.ghijklmnopqrstuv");
    expect(row.payload).toContain("REDACTED_TOKEN");
  });

  test("COMPOST_PII_STRICT=true redacts raw 13-19 digit sequences (non-Luhn)", async () => {
    const dirtyEnvelope = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "pii-strict",
      cwd: "/tmp/test-project",
      timestamp: new Date().toISOString(),
      payload: { order: "Order #1234567890123 placed" },
    });
    const proc = Bun.spawn(["bun", SHIM_PATH, "pre-tool-use"], {
      stdin: new Blob([dirtyEnvelope]),
      env: {
        ...process.env,
        COMPOST_DATA_DIR: dataDir,
        COMPOST_PII_STRICT: "true",
      },
    });
    await proc.exited;

    const db = new Database(join(dataDir, "ledger.db"));
    const row = db
      .query("SELECT payload FROM observe_outbox WHERE source_id LIKE '%pii-strict%'")
      .get() as { payload: string };
    db.close();

    expect(row.payload).not.toContain("1234567890123");
    expect(row.payload).toContain("[REDACTED_CC]");
  });

  test("clean payload passes through unchanged", async () => {
    const cleanEnvelope = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "clean-session",
      cwd: "/tmp/test-project",
      timestamp: new Date().toISOString(),
      payload: { note: "Just a plain hello world" },
    });
    const proc = Bun.spawn(["bun", SHIM_PATH, "session-start"], {
      stdin: new Blob([cleanEnvelope]),
      env: { ...process.env, COMPOST_DATA_DIR: dataDir },
    });
    await proc.exited;

    const db = new Database(join(dataDir, "ledger.db"));
    const row = db
      .query("SELECT payload FROM observe_outbox WHERE source_id LIKE '%clean-session%'")
      .get() as { payload: string };
    db.close();

    expect(row.payload).toContain("Just a plain hello world");
    expect(row.payload).not.toContain("REDACTED");
  });
});
