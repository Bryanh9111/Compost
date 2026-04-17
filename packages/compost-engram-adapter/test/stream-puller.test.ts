import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  type EngramStreamClient,
  type EngramStreamEntry,
  type StreamForCompostArgs,
  StreamPuller,
  engramStreamEntrySchema,
} from "../src/stream-puller";

function makeEntry(
  overrides: Partial<EngramStreamEntry> = {}
): EngramStreamEntry {
  return {
    memory_id: "mem-1",
    kind: "event",
    content: "hi",
    project: "compost",
    scope: "project",
    created_at: "2026-04-17T00:00:00Z",
    updated_at: "2026-04-17T00:00:00Z",
    tags: [],
    origin: "human",
    ...overrides,
  };
}

class FakeStreamClient implements EngramStreamClient {
  calls: StreamForCompostArgs[] = [];
  responses: EngramStreamEntry[][] = [];
  failNext = false;
  failError = "engram offline";

  async streamForCompost(args: StreamForCompostArgs) {
    this.calls.push(args);
    if (this.failNext) {
      this.failNext = false;
      return { ok: false as const, error: this.failError };
    }
    const next = this.responses.shift() ?? [];
    return { ok: true as const, data: next };
  }
}

describe("StreamPuller cursor", () => {
  let tmpDir: string;
  let cursorPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-puller-"));
    cursorPath = join(tmpDir, "engram-cursor.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loadCursor returns empty when file absent", () => {
    const client = new FakeStreamClient();
    const p = new StreamPuller(client, { cursorPath });
    const c = p.loadCursor();
    expect(c).toEqual({ since: null, last_memory_id: null });
  });

  test("loadCursor handles malformed json gracefully", () => {
    writeFileSync(cursorPath, "{{not json");
    const client = new FakeStreamClient();
    const p = new StreamPuller(client, { cursorPath });
    const c = p.loadCursor();
    expect(c).toEqual({ since: null, last_memory_id: null });
  });

  test("saveCursor + loadCursor round trip", () => {
    const client = new FakeStreamClient();
    const p = new StreamPuller(client, { cursorPath });
    p.saveCursor({ since: "2026-04-17T00:00:00Z", last_memory_id: "mem-42" });
    const c = p.loadCursor();
    expect(c).toEqual({
      since: "2026-04-17T00:00:00Z",
      last_memory_id: "mem-42",
    });
    expect(JSON.parse(readFileSync(cursorPath, "utf-8"))).toEqual(c);
  });
});

describe("StreamPuller pullBatch", () => {
  let tmpDir: string;
  let cursorPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-puller-"));
    cursorPath = join(tmpDir, "engram-cursor.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("empty response keeps prior cursor and marks reached_end", async () => {
    const client = new FakeStreamClient();
    client.responses.push([]);
    const p = new StreamPuller(client, { cursorPath });
    const r = await p.pullBatch();
    expect(r.entries).toHaveLength(0);
    expect(r.reached_end).toBe(true);
    expect(r.cursor).toEqual({ since: null, last_memory_id: null });
  });

  test("non-empty batch advances cursor to max updated_at", async () => {
    const client = new FakeStreamClient();
    client.responses.push([
      makeEntry({
        memory_id: "a",
        updated_at: "2026-04-17T00:00:00Z",
        created_at: "2026-04-17T00:00:00Z",
      }),
      makeEntry({
        memory_id: "b",
        updated_at: "2026-04-17T02:00:00Z",
        created_at: "2026-04-17T02:00:00Z",
      }),
      makeEntry({
        memory_id: "c",
        updated_at: "2026-04-17T01:00:00Z",
        created_at: "2026-04-17T01:00:00Z",
      }),
    ]);
    const p = new StreamPuller(client, { cursorPath });
    const r = await p.pullBatch();
    expect(r.entries).toHaveLength(3);
    expect(r.cursor).toEqual({
      since: "2026-04-17T02:00:00Z",
      last_memory_id: "b",
    });
  });

  test("always passes include_compost=false (feedback-loop guard §7.1)", async () => {
    const client = new FakeStreamClient();
    client.responses.push([]);
    const p = new StreamPuller(client, { cursorPath });
    await p.pullBatch();
    expect(client.calls[0]?.include_compost).toBe(false);
  });

  test("passes prior cursor.since as args.since", async () => {
    const client = new FakeStreamClient();
    client.responses.push([]);
    const p = new StreamPuller(client, { cursorPath });
    p.saveCursor({ since: "2026-04-10T00:00:00Z", last_memory_id: "mem-9" });
    await p.pullBatch();
    expect(client.calls[0]?.since).toBe("2026-04-10T00:00:00Z");
  });

  test("dedupes last_memory_id from prior cursor", async () => {
    const client = new FakeStreamClient();
    client.responses.push([
      makeEntry({ memory_id: "mem-boundary", updated_at: "2026-04-17T01:00:00Z" }),
      makeEntry({ memory_id: "mem-new", updated_at: "2026-04-17T02:00:00Z" }),
    ]);
    const p = new StreamPuller(client, { cursorPath });
    const r = await p.pullBatch({
      cursor: { since: "2026-04-17T01:00:00Z", last_memory_id: "mem-boundary" },
    });
    expect(r.entries.map((e) => e.memory_id)).toEqual(["mem-new"]);
  });

  test("throws on client failure with error detail", async () => {
    const client = new FakeStreamClient();
    client.failNext = true;
    client.failError = "engram unreachable";
    const p = new StreamPuller(client, { cursorPath });
    await expect(p.pullBatch()).rejects.toThrow(/engram unreachable/);
  });

  test("zod validation rejects malformed entry shape", async () => {
    const client = new FakeStreamClient();
    // Missing required `origin` field.
    client.responses.push([
      {
        memory_id: "x",
        kind: "event",
        content: "c",
        project: null,
        scope: "project",
        created_at: "t",
        updated_at: "t",
        tags: [],
      } as unknown as EngramStreamEntry,
    ]);
    const p = new StreamPuller(client, { cursorPath });
    await expect(p.pullBatch()).rejects.toThrow();
  });
});

describe("StreamPuller pullAll", () => {
  let tmpDir: string;
  let cursorPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-puller-"));
    cursorPath = join(tmpDir, "engram-cursor.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loops until empty batch, persisting cursor after each", async () => {
    const client = new FakeStreamClient();
    client.responses.push(
      [
        makeEntry({ memory_id: "a", updated_at: "2026-04-17T00:00:01Z" }),
        makeEntry({ memory_id: "b", updated_at: "2026-04-17T00:00:02Z" }),
      ],
      [makeEntry({ memory_id: "c", updated_at: "2026-04-17T00:00:03Z" })],
      []
    );
    const p = new StreamPuller(client, { cursorPath });
    const received: string[] = [];
    const stats = await p.pullAll(async (batch) => {
      for (const e of batch) received.push(e.memory_id);
    });
    expect(stats.batches).toBe(3);
    expect(stats.total_entries).toBe(3);
    expect(received).toEqual(["a", "b", "c"]);
    // Cursor persisted on disk
    const saved = JSON.parse(readFileSync(cursorPath, "utf-8"));
    expect(saved.since).toBe("2026-04-17T00:00:03Z");
    expect(saved.last_memory_id).toBe("c");
  });

  test("stops on error, does not lose prior cursor progress", async () => {
    const client = new FakeStreamClient();
    client.responses.push([
      makeEntry({ memory_id: "a", updated_at: "2026-04-17T00:00:01Z" }),
    ]);
    const p = new StreamPuller(client, { cursorPath });
    // First pull succeeds, persists cursor. Second pull will fail.
    let callCount = 0;
    const stats = await p.pullAll(async () => {
      callCount++;
      if (callCount === 1) client.failNext = true;
    });
    expect(stats.batches).toBe(1);
    expect(stats.errors.length).toBeGreaterThan(0);
    const saved = JSON.parse(readFileSync(cursorPath, "utf-8"));
    expect(saved.since).toBe("2026-04-17T00:00:01Z");
  });

  test("onBatch error short-circuits loop without losing progress", async () => {
    const client = new FakeStreamClient();
    client.responses.push([
      makeEntry({ memory_id: "a", updated_at: "2026-04-17T00:00:01Z" }),
    ]);
    const p = new StreamPuller(client, { cursorPath });
    const stats = await p.pullAll(async () => {
      throw new Error("ingest broken");
    });
    expect(stats.errors[0]).toContain("ingest broken");
    // Cursor NOT advanced because onBatch failed BEFORE saveCursor()
    expect(stats.batches).toBe(0);
  });
});

describe("engramStreamEntrySchema contract shape (9 keys)", () => {
  test("accepts canonical shape", () => {
    expect(() =>
      engramStreamEntrySchema.parse(makeEntry())
    ).not.toThrow();
  });

  test("rejects unknown origin value", () => {
    expect(() =>
      engramStreamEntrySchema.parse(makeEntry({ origin: "compiled" as "human" }))
    ).toThrow();
  });

  test("rejects unknown scope value", () => {
    expect(() =>
      engramStreamEntrySchema.parse(
        makeEntry({ scope: "session" as "project" })
      )
    ).toThrow();
  });
});
