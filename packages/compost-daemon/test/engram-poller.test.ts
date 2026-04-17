import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import {
  type EngramStreamClient,
  type EngramStreamEntry,
  type StreamForCompostArgs,
} from "../../compost-engram-adapter/src";
import { runEngramPullOnce, startEngramPoller } from "../src/engram-poller";

class FakeStreamClient implements EngramStreamClient {
  callCount = 0;
  responses: EngramStreamEntry[][];

  constructor(responses: EngramStreamEntry[][]) {
    this.responses = responses;
  }

  async streamForCompost(_args: StreamForCompostArgs) {
    this.callCount++;
    return {
      ok: true as const,
      data: this.responses.shift() ?? [],
    };
  }
}

function entry(overrides: Partial<EngramStreamEntry> = {}): EngramStreamEntry {
  return {
    memory_id: `mem-${Math.random().toString(36).slice(2, 8)}`,
    kind: "preference",
    content: "c",
    project: null,
    scope: "project",
    created_at: "2026-04-17T00:00:00Z",
    updated_at: "2026-04-17T00:00:00Z",
    tags: [],
    origin: "human",
    ...overrides,
  };
}

describe("runEngramPullOnce", () => {
  let tmpDir: string;
  let cursorPath: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-poller-"));
    cursorPath = join(tmpDir, "cursor.json");
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("seeds engram source and ingests a batch", async () => {
    const client = new FakeStreamClient([
      [
        entry({ memory_id: "a", updated_at: "2026-04-17T00:00:01Z" }),
        entry({
          memory_id: "b",
          kind: "goal",
          updated_at: "2026-04-17T00:00:02Z",
        }),
      ],
      [],
    ]);

    const stats = await runEngramPullOnce(db, { client, cursorPath });

    expect(stats.entries_seen).toBe(2);
    expect(stats.entries_new).toBe(2);
    expect(stats.entries_duplicate).toBe(0);
    expect(stats.errors).toEqual([]);

    const source = db
      .query("SELECT id FROM source WHERE id = 'engram-stream'")
      .get() as { id: string };
    expect(source.id).toBe("engram-stream");

    const obsCount = db
      .query("SELECT COUNT(*) AS n FROM observations")
      .get() as { n: number };
    expect(obsCount.n).toBe(2);
  });

  test("cursor boundary dedupe drops already-seen entry on next pull", async () => {
    const client = new FakeStreamClient([
      [entry({ memory_id: "a", updated_at: "2026-04-17T00:00:01Z" })],
      [],
    ]);
    await runEngramPullOnce(db, { client, cursorPath });

    // StreamPuller.dedupeAndValidate drops the boundary memory_id on
    // subsequent pulls. A second pull returning the same row yields 0
    // processed entries, and no duplicate observation is written.
    const client2 = new FakeStreamClient([
      [entry({ memory_id: "a", updated_at: "2026-04-17T00:00:01Z" })],
      [],
    ]);
    const stats2 = await runEngramPullOnce(db, { client: client2, cursorPath });
    expect(stats2.entries_new).toBe(0);
    expect(stats2.entries_duplicate).toBe(0);

    const obsCount = db
      .query("SELECT COUNT(*) AS n FROM observations")
      .get() as { n: number };
    expect(obsCount.n).toBe(1);
  });

  test("collects ingest failures without throwing", async () => {
    // Drop observations table after seed so ingestEngramEntry fails the
    // INSERT but ensureEngramSource succeeds. This mimics a corrupted
    // ledger or migration drift.
    db.exec("DROP TABLE observations");
    const client = new FakeStreamClient([
      [entry({ memory_id: "a", updated_at: "2026-04-17T00:00:01Z" })],
      [],
    ]);
    const stats = await runEngramPullOnce(db, { client, cursorPath });
    expect(stats.errors.length).toBeGreaterThan(0);
    expect(stats.errors[0]).toContain("a");
  });
});

describe("startEngramPoller", () => {
  let tmpDir: string;
  let cursorPath: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-poller-"));
    cursorPath = join(tmpDir, "cursor.json");
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("one-shot mode (intervalMs=0) runs once then exits", async () => {
    const client = new FakeStreamClient([
      [entry({ memory_id: "a", updated_at: "2026-04-17T00:00:01Z" })],
      [],
    ]);
    const s = startEngramPoller(db, {
      client,
      cursorPath,
      intervalMs: 0,
      runImmediately: true,
    });
    // Give loop a tick
    await Bun.sleep(50);
    s.stop();

    const obsCount = db
      .query("SELECT COUNT(*) AS n FROM observations")
      .get() as { n: number };
    expect(obsCount.n).toBe(1);
    expect(client.callCount).toBeGreaterThan(0);
  });

  test("stop() halts loop before next interval fires", async () => {
    const client = new FakeStreamClient([[], [], []]);
    const s = startEngramPoller(db, {
      client,
      cursorPath,
      intervalMs: 10_000, // long — we want to stop before it fires again
      runImmediately: true,
    });
    await Bun.sleep(30);
    s.stop();
    const snapshot = client.callCount;
    await Bun.sleep(50);
    expect(client.callCount).toBe(snapshot);
  });
});
