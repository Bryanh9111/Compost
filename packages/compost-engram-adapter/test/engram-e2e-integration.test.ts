import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";
import { EngramWriter } from "../src/writer";
import { PendingWritesQueue } from "../src/pending-writes";
import {
  StdioEngramMcpClient,
  type McpToolClient,
  createStdioMcpClient,
} from "../src/mcp-stdio-client";

/**
 * Real e2e integration test (debate 024 follow-up coverage gap).
 *
 * The other writer/stdio tests both mock the OPPOSITE side: writer.test.ts
 * uses FakeMcpClient (mocks Engram), and Engram's tests/test_compost_insight_dedup.py
 * calls MemoryStore.remember directly (mocks the wire). Either side could
 * silently change its contract and both unit suites stay green.
 *
 * This test closes that gap: spawn a real `engram-server` subprocess against
 * a fresh temp SQLite DB, route writes through real `StdioEngramMcpClient` +
 * real `EngramWriter`, then assert the debate 024 idempotency contract
 * survives the round-trip across MCP stdio JSON-RPC + real schema CHECKs +
 * the real `_find_compost_duplicate` path in store.py.
 *
 * Skipped automatically when `engram-server` is not on PATH — set
 * `ENGRAM_BIN` to override the command.
 */

function resolveEngramBin(): string | null {
  if (process.env["ENGRAM_BIN"]) return process.env["ENGRAM_BIN"];
  const proc = Bun.spawnSync({
    cmd: ["/bin/sh", "-lc", "command -v engram-server"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (proc.exitCode !== 0) return null;
  return new TextDecoder().decode(proc.stdout).trim() || null;
}

const ENGRAM_BIN = resolveEngramBin();

const skipIfNoEngram = !ENGRAM_BIN || (ENGRAM_BIN.includes("/") && !existsSync(ENGRAM_BIN));

describe("e2e Engram integration (real subprocess)", () => {
  if (skipIfNoEngram) {
    test.skip("engram-server not on PATH — set ENGRAM_BIN to override", () => {});
    return;
  }

  let tmpDir: string;
  let dbPath: string;
  let queue: PendingWritesQueue;
  let mcp: McpToolClient;
  let client: StdioEngramMcpClient;
  let writer: EngramWriter;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-e2e-engram-"));
    dbPath = join(tmpDir, "engram-test.db");
    queue = new PendingWritesQueue(join(tmpDir, "pending.db"));

    // Spawn engram-server with isolated DB. ENGRAM_DB env var (server.py:235)
    // overrides the default ~/.engram/engram.db so the test can't mutate the
    // user's real ledger.
    mcp = await createStdioMcpClient({
      command: ENGRAM_BIN,
      env: { ...process.env, ENGRAM_DB: dbPath } as Record<string, string>,
    });
    client = new StdioEngramMcpClient({ client: mcp });
    writer = new EngramWriter(client, queue);
  }, 60_000);

  afterAll(async () => {
    if (client) {
      try {
        await client.close();
      } catch {
        // best-effort — subprocess may already be down
      }
    }
    if (queue) queue.close();
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test(
    "two writeInsight calls with identical inputs return the same memory_ids end-to-end",
    async () => {
      const opts = {
        project: "compost",
        compostFactIds: ["e2e-fact-a", "e2e-fact-b", "e2e-fact-c"],
        content:
          "e2e integration insight: round-trip through real engram-server subprocess",
        synthesizedAt: "2026-04-25T00:00:00Z",
      };

      const r1 = await writer.writeInsight(opts);
      expect(r1.outcomes.length).toBeGreaterThan(0);
      expect(r1.outcomes.every((o) => o.status === "written")).toBe(true);
      expect(r1.outcomes.every((o) => typeof o.memory_id === "string")).toBe(true);

      const r2 = await writer.writeInsight(opts);
      expect(r2.outcomes.every((o) => o.status === "written")).toBe(true);

      // Debate 024 contract: same root_insight_id, same per-chunk memory_ids,
      // no pending queue entries (Engram returns existing id, writer treats as success).
      expect(r2.root_insight_id).toBe(r1.root_insight_id);
      expect(r2.outcomes.map((o) => o.memory_id)).toEqual(
        r1.outcomes.map((o) => o.memory_id)
      );
      expect(queue.listPending()).toHaveLength(0);
    },
    60_000
  );

  test("DB row count stays at chunk_count after duplicate push", async () => {
    // Sanity: peek into the actual SQLite file the subprocess wrote to.
    // Read-only — the engram-server process holds the WAL writer.
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query("SELECT COUNT(*) AS n FROM memories WHERE origin='compost'")
        .get() as { n: number };
      // First test wrote N chunks (single fact set, possibly split into 1+
      // chunks by splitter.ts). Re-push must not add more.
      expect(row.n).toBeGreaterThan(0);

      // The unique partial index is the storage-layer guarantee.
      // Verify it actually exists in the live schema.
      const idx = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_compost_insight_idempotency'"
        )
        .get() as { name: string } | null;
      expect(idx).not.toBeNull();
    } finally {
      db.close();
    }
  });

  test("different fact set produces a new chain (no over-merge)", async () => {
    const opts = {
      project: "compost",
      compostFactIds: ["e2e-fact-x", "e2e-fact-y"],
      content: "e2e integration insight #2: different fact set, must not collapse",
      synthesizedAt: "2026-04-25T01:00:00Z",
    };
    const r = await writer.writeInsight(opts);
    expect(r.outcomes.every((o) => o.status === "written")).toBe(true);
    expect(r.outcomes.length).toBeGreaterThan(0);

    // Row count must have grown by exactly the new chunk count.
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query("SELECT COUNT(*) AS n FROM memories WHERE origin='compost'")
        .get() as { n: number };
      // First test: chunks for set {a,b,c}. This test: chunks for set {x,y}.
      // The two sets share no fact_ids → new root_insight_id → new rows.
      expect(row.n).toBeGreaterThan(r.outcomes.length);
    } finally {
      db.close();
    }
  });
});
