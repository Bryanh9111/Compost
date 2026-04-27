import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createConnection } from "net";
import { startDaemon, stopDaemon } from "../src/main";
import { appendToOutbox } from "../../compost-core/src/ledger/outbox";
import { drainOne } from "../../compost-core/src/ledger/outbox";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { upsertPolicies } from "../../compost-core/src/policies/registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "compost-test-"));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function sendSocket(sockPath: string, cmd: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(sockPath);
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        sock.destroy();
        resolve(JSON.parse(buf.slice(0, nl)));
      }
    });
    sock.on("error", reject);
    sock.on("connect", () => {
      sock.write(`${cmd}\n`);
    });
  });
}

/** Open an in-memory DB with all migrations and policies applied. */
function makeTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  const result = applyMigrations(db);
  if (result.errors.length > 0) {
    throw new Error(`Migration failed: ${result.errors[0]?.error}`);
  }
  upsertPolicies(db);
  return db;
}

// ---------------------------------------------------------------------------
// Suite 1: startDaemon
// ---------------------------------------------------------------------------

describe("startDaemon", () => {
  let tmpDir: string | null = null;

  afterEach(async () => {
    await stopDaemon();
    if (tmpDir) {
      cleanupDir(tmpDir);
      tmpDir = null;
    }
  });

  it("creates data directory if missing", async () => {
    tmpDir = makeTmpDir();
    const dataDir = join(tmpDir, "compost-new");

    const { db } = await startDaemon(dataDir, false);

    const { existsSync } = await import("fs");
    expect(existsSync(dataDir)).toBe(true);
    expect(existsSync(join(dataDir, "ledger.db"))).toBe(true);

    db.close();
  });

  it("writes PID file", async () => {
    tmpDir = makeTmpDir();
    const dataDir = join(tmpDir, "compost-pid");

    await startDaemon(dataDir, false);

    const { readFileSync } = await import("fs");
    const pid = Number(readFileSync(join(dataDir, "daemon.pid"), "utf-8"));
    expect(pid).toBe(process.pid);
  });

  it("applies migrations (tracking table exists)", async () => {
    tmpDir = makeTmpDir();
    const dataDir = join(tmpDir, "compost-mig");

    const { db } = await startDaemon(dataDir, false);

    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='_compost_migrations'")
      .get();
    expect(row).not.toBeNull();
    db.close();
  });

  it("upserts policies (tp-2026-04 present)", async () => {
    tmpDir = makeTmpDir();
    const dataDir = join(tmpDir, "compost-pol");

    const { db } = await startDaemon(dataDir, false);

    const row = db
      .query("SELECT policy_id FROM policies WHERE policy_id = 'tp-2026-04'")
      .get() as { policy_id: string } | null;
    expect(row?.policy_id).toBe("tp-2026-04");
    db.close();
  });

  it("status includes per-scheduler health without removing pid and uptime", async () => {
    tmpDir = makeTmpDir();
    const dataDir = join(tmpDir, "compost-status");

    await startDaemon(dataDir, false);

    const status = await sendSocket(join(dataDir, "daemon.sock"), "status") as {
      pid?: unknown;
      uptime?: unknown;
      schedulers?: unknown;
    };
    expect(status.pid).toBe(process.pid);
    expect(typeof status.uptime).toBe("number");
    expect(Array.isArray(status.schedulers)).toBe(true);

    const schedulers = status.schedulers as Array<Record<string, unknown>>;
    for (const name of ["drain", "reflect", "ingest", "freshness", "reasoning"]) {
      const health = schedulers.find((s) => s["name"] === name);
      expect(health).toBeDefined();
      expect(typeof health?.["running"]).toBe("boolean");
      expect(typeof health?.["error_count"]).toBe("number");
      expect(
        health?.["last_tick_at"] === null || typeof health?.["last_tick_at"] === "string"
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Outbox / drain loop (unit-level, no daemon)
// ---------------------------------------------------------------------------

describe("drain loop processes outbox events", () => {
  it("drainOne returns null on empty outbox", () => {
    const db = makeTestDb();
    const result = drainOne(db);
    expect(result).toBeNull();
    db.close();
  });

  it("drainOne processes a valid outbox row", () => {
    const db = makeTestDb();

    const event = {
      adapter: "test-adapter",
      source_id: "src-001",
      source_kind: "local-file" as const,
      source_uri: "file:///tmp/test.txt",
      idempotency_key: "idem-001",
      trust_tier: "user" as const,
      transform_policy: "tp-2026-04",
      payload: JSON.stringify({
        content: "hello world",
        mime_type: "text/plain",
        occurred_at: "2026-04-01 00:00:00",
      }),
    };

    appendToOutbox(db, event);

    const result = drainOne(db);
    expect(result).not.toBeNull();
    expect(result!.seq).toBeGreaterThan(0);
    expect(result!.observe_id).toBeTruthy();

    // Second call should return null (nothing left)
    expect(drainOne(db)).toBeNull();
    db.close();
  });

  it("appendToOutbox is idempotent (duplicate idempotency_key ignored)", () => {
    const db = makeTestDb();

    const event = {
      adapter: "test-adapter",
      source_id: "src-002",
      source_kind: "web" as const,
      source_uri: "https://example.com",
      idempotency_key: "idem-dup",
      trust_tier: "web" as const,
      transform_policy: "tp-2026-04",
      payload: JSON.stringify({
        content: "dupe",
        mime_type: "text/plain",
        occurred_at: "2026-04-01 00:00:00",
      }),
    };

    appendToOutbox(db, event);
    appendToOutbox(db, event); // second append should be ignored

    const count = db
      .query("SELECT COUNT(*) as c FROM observe_outbox WHERE idempotency_key = 'idem-dup'")
      .get() as { c: number };
    expect(count.c).toBe(1);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: MCP tool registration (structural check without SDK runtime)
// ---------------------------------------------------------------------------

describe("MCP server exposes Phase 0 tools", () => {
  it("mcp-server module exports startMcpServer function", async () => {
    const mod = await import("../src/mcp-server");
    expect(typeof mod.startMcpServer).toBe("function");
  });

  it("compost-core exports all required functions", async () => {
    const outbox = await import("../../compost-core/src/ledger/outbox");
    const search = await import("../../compost-core/src/query/search");
    const cognitive = await import("../../compost-core/src/cognitive/reflect");

    expect(typeof outbox.appendToOutbox).toBe("function");
    expect(typeof search.query).toBe("function");
    expect(typeof cognitive.reflect).toBe("function");
  });

  it("query() returns correct shape", async () => {
    const db = makeTestDb();
    const { query } = await import("../../compost-core/src/query/search");

    const result = await query(db, "test query");
    expect(result).toHaveProperty("query_id");
    expect(result).toHaveProperty("hits");
    expect(Array.isArray(result.hits)).toBe(true);
    expect(result.hits.length).toBe(0); // no vectorStore = empty
    expect(result).toHaveProperty("ranking_profile_id");
    expect(result).toHaveProperty("budget");
    db.close();
  });

  it("reflect() returns correct shape", async () => {
    const db = makeTestDb();
    const { reflect } = await import("../../compost-core/src/cognitive/reflect");

    const report = reflect(db);
    expect(report).toHaveProperty("sensoryObservationsDeleted");
    expect(report).toHaveProperty("outboxRowsPruned");
    expect(report).toHaveProperty("reflectionDurationMs");
    expect(Array.isArray(report.errors)).toBe(true);
    db.close();
  });
});
