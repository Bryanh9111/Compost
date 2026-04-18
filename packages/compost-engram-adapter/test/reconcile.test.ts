import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { PendingWritesQueue } from "../src/pending-writes";
import { reconcileEngramQueue } from "../src/reconcile";

describe("reconcileEngramQueue", () => {
  let tmpDir: string;
  let queue: PendingWritesQueue;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-reconcile-"));
    queue = new PendingWritesQueue(join(tmpDir, "pending.db"));
  });

  afterEach(() => {
    queue.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("empty queue is healthy", () => {
    const r = reconcileEngramQueue(queue);
    expect(r).toEqual({
      pending_total: 0,
      committed_total: 0,
      pair_fragments: [],
      stuck_rows: [],
      expired_but_not_pruned: 0,
      ok: true,
    });
  });

  test("counts pending vs committed rows", () => {
    queue.enqueue("remember", {
      payload: { origin: "compost", kind: "insight", content: "x" },
    });
    const id = queue.enqueue("invalidate", { payload: { fact_ids: ["f1"] } });
    queue.markCommitted(id);

    const r = reconcileEngramQueue(queue);
    expect(r.pending_total).toBe(1);
    expect(r.committed_total).toBe(1);
    // Recent pending + committed is normal state — not a reconcile signal.
    expect(r.ok).toBe(true);
  });

  test("pending-only queue with recent rows is still ok (not stuck)", () => {
    queue.enqueue("remember", { payload: {} });
    const r = reconcileEngramQueue(queue);
    // Pending rows under threshold are normal backpressure, not a signal.
    expect(r.stuck_rows).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  test("pair fragment: invalidate committed but remember still pending = R5 orphan", () => {
    const pair = queue.enqueuePair(
      { fact_ids: ["f1"] },
      { origin: "compost", kind: "insight", content: "new" }
    );
    queue.markCommitted(pair.invalidateId);
    // remember still pending

    const r = reconcileEngramQueue(queue);
    expect(r.pair_fragments).toHaveLength(1);
    expect(r.pair_fragments[0]!.pair_id).toBe(pair.pairId);
    expect(r.pair_fragments[0]!.committed_kinds).toEqual(["invalidate"]);
    expect(r.pair_fragments[0]!.pending_kinds).toEqual(["remember"]);
    expect(r.ok).toBe(false);
  });

  test("all-committed pair is healthy (not flagged as fragment)", () => {
    const pair = queue.enqueuePair(
      { fact_ids: ["f1"] },
      { origin: "compost", kind: "insight", content: "x" }
    );
    queue.markCommitted(pair.invalidateId);
    queue.markCommitted(pair.rememberId);

    const r = reconcileEngramQueue(queue);
    expect(r.pair_fragments).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  test("all-pending pair is NOT a fragment (just backpressure)", () => {
    queue.enqueuePair({ fact_ids: ["f1"] }, { content: "x" });
    const r = reconcileEngramQueue(queue);
    expect(r.pair_fragments).toHaveLength(0);
    // Recent enqueue -> not stuck -> ok
    expect(r.ok).toBe(true);
  });

  test("stuck rows: pending older than threshold flagged", () => {
    const id = queue.enqueue("remember", { payload: {} });
    // Reconcile with a fake `now` 10 days in the future to simulate age.
    const future = Date.now() + 10 * 86_400_000;
    const r = reconcileEngramQueue(queue, {
      stuckThresholdDays: 7,
      now: () => future,
    });
    expect(r.stuck_rows).toHaveLength(1);
    expect(r.stuck_rows[0]!.id).toBe(id);
    expect(r.stuck_rows[0]!.age_days).toBeGreaterThanOrEqual(10);
    expect(r.ok).toBe(false);
  });

  test("expired_but_not_pruned flagged when expires_at < now", () => {
    queue.enqueue("remember", {
      payload: {},
      expiresAt: Date.now() - 1000, // already expired
    });
    const r = reconcileEngramQueue(queue);
    expect(r.expired_but_not_pruned).toBe(1);
    expect(r.ok).toBe(false);
  });

  test("committed row whose pair partner is missing from queue is not a fragment (asymmetric coverage)", () => {
    // Simulate: invalidate committed, remember never enqueued at all
    // (could happen if splitInsight produced 0 chunks for some bug).
    // Pure single-sided pair bucket = committed_kinds has entry, pending_kinds empty.
    // Our definition requires BOTH sides non-empty to flag, so this edge
    // doesn't surface here — it's outside the fragment detector.
    const id = queue.enqueue("invalidate", {
      payload: { fact_ids: ["f1"] },
      pairId: "orphan-pair",
    });
    queue.markCommitted(id);
    const r = reconcileEngramQueue(queue);
    expect(r.pair_fragments).toHaveLength(0);
  });
});
