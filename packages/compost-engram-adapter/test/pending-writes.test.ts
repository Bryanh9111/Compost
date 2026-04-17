import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { PendingWritesQueue } from "../src/pending-writes";

describe("PendingWritesQueue", () => {
  let tmpDir: string;
  let queue: PendingWritesQueue;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-pending-"));
    queue = new PendingWritesQueue(join(tmpDir, "pending.db"));
  });

  afterEach(() => {
    queue.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("enqueue + listPending surfaces the row", () => {
    const id = queue.enqueue("remember", {
      payload: { content: "c", kind: "insight" },
    });
    const pending = queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id);
    expect(pending[0].kind).toBe("remember");
    expect(JSON.parse(pending[0].payload)).toEqual({
      content: "c",
      kind: "insight",
    });
    expect(pending[0].committed_at).toBeNull();
    expect(pending[0].attempts).toBe(0);
  });

  test("markCommitted removes row from listPending", () => {
    const id = queue.enqueue("remember", { payload: { a: 1 } });
    queue.markCommitted(id);
    expect(queue.listPending()).toHaveLength(0);
    const row = queue.getById(id);
    expect(row?.committed_at).not.toBeNull();
  });

  test("markFailed increments attempts + records error", () => {
    const id = queue.enqueue("remember", { payload: { a: 1 } });
    queue.markFailed(id, "connection refused");
    queue.markFailed(id, "timeout");
    const row = queue.getById(id);
    expect(row?.attempts).toBe(2);
    expect(row?.last_error).toBe("timeout");
  });

  test("enqueuePair creates linked invalidate + remember rows sharing pair_id (R1)", () => {
    const { pairId, invalidateId, rememberId } = queue.enqueuePair(
      { fact_ids: ["f1", "f2"] },
      { content: "new insight", source_trace: { compost_fact_ids: ["f1", "f2"] } }
    );
    const inv = queue.getById(invalidateId);
    const rem = queue.getById(rememberId);
    expect(inv?.kind).toBe("invalidate");
    expect(rem?.kind).toBe("remember");
    expect(inv?.pair_id).toBe(pairId);
    expect(rem?.pair_id).toBe(pairId);
  });

  test("two-phase: invalidate committed, remember can still be retried independently", () => {
    const { invalidateId, rememberId } = queue.enqueuePair(
      { fact_ids: ["f1"] },
      { content: "c" }
    );
    queue.markCommitted(invalidateId);
    queue.markFailed(rememberId, "engram down");

    const pending = queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(rememberId);
    expect(pending[0].kind).toBe("remember");
  });

  test("pruneExpired drops near-expiry entries (R2)", () => {
    const now = Date.now();
    const graceMs = 60 * 60 * 1000; // 1h grace

    const safeId = queue.enqueue("remember", {
      payload: { a: 1 },
      expiresAt: now + 10 * graceMs,
    });
    const nearExpiryId = queue.enqueue("remember", {
      payload: { b: 2 },
      expiresAt: now + graceMs / 2, // less than grace → should prune
    });
    const noTTLId = queue.enqueue("remember", { payload: { c: 3 } });

    const pruned = queue.pruneExpired(graceMs);
    expect(pruned).toBe(1);
    expect(queue.getById(nearExpiryId)).toBeNull();
    expect(queue.getById(safeId)).not.toBeNull();
    expect(queue.getById(noTTLId)).not.toBeNull();
  });

  test("CHECK constraint rejects unknown kind", () => {
    expect(() =>
      // Cast through to bypass TS guard
      (queue as unknown as {
        enqueue: (kind: string, opts: { payload: unknown }) => number;
      }).enqueue("delete", { payload: {} })
    ).toThrow();
  });

  test("persistence across reconnect", () => {
    const dbPath = join(tmpDir, "persist.db");
    const q1 = new PendingWritesQueue(dbPath);
    q1.enqueue("remember", { payload: { x: 1 } });
    q1.close();

    const q2 = new PendingWritesQueue(dbPath);
    expect(q2.listPending()).toHaveLength(1);
    q2.close();
  });
});
