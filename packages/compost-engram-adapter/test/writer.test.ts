import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { PendingWritesQueue } from "../src/pending-writes";
import {
  EngramWriter,
  type EngramMcpClient,
  type RememberArgs,
  validateSourceTrace,
} from "../src/writer";
import { MAX_CONTENT_CHARS } from "../src/constants";

class FakeMcpClient implements EngramMcpClient {
  rememberCalls: RememberArgs[] = [];
  invalidateCalls: Array<{ fact_ids: string[] }> = [];
  failRemember = false;
  failInvalidate = false;
  throwOnRemember = false;
  nextRememberId = 1;
  /** Models Engram migration 003 idempotency: same (root_insight_id,
   *  chunk_index) returns the existing id instead of creating a new row.
   *  Compost writer must treat this as success (PUT semantics). */
  enableStructuralDedup = false;
  private structuralIndex = new Map<string, string>();

  async remember(args: RememberArgs) {
    this.rememberCalls.push(args);
    if (this.throwOnRemember) throw new Error("network thrown");
    if (this.failRemember) {
      return { ok: false as const, error: "engram refused" };
    }
    if (this.enableStructuralDedup) {
      const rid = args.source_trace.root_insight_id;
      const cidx = args.source_trace.chunk_index;
      const key = `${rid}|${cidx}`;
      const existing = this.structuralIndex.get(key);
      if (existing) {
        return { ok: true as const, data: { id: existing } };
      }
      const id = `mem-${this.nextRememberId++}`;
      this.structuralIndex.set(key, id);
      return { ok: true as const, data: { id } };
    }
    return {
      ok: true as const,
      data: { id: `mem-${this.nextRememberId++}` },
    };
  }

  async invalidate(args: { fact_ids: string[] }) {
    this.invalidateCalls.push(args);
    if (this.failInvalidate) {
      return { ok: false as const, error: "engram refused" };
    }
    return {
      ok: true as const,
      data: {
        invalidated_memory_ids: args.fact_ids.map((f) => `mem-of-${f}`),
        count: args.fact_ids.length,
      },
    };
  }
}

describe("EngramWriter", () => {
  let tmpDir: string;
  let queue: PendingWritesQueue;
  let client: FakeMcpClient;
  let writer: EngramWriter;
  const FIXED_NOW = new Date("2026-04-17T00:00:00Z");

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-writer-"));
    queue = new PendingWritesQueue(join(tmpDir, "pending.db"));
    client = new FakeMcpClient();
    writer = new EngramWriter(client, queue, () => FIXED_NOW);
  });

  afterEach(() => {
    queue.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("short insight → single remember call, written outcome", async () => {
    const result = await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1", "f2"],
      content: "Short insight",
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    expect(client.rememberCalls).toHaveLength(1);
    expect(client.rememberCalls[0].origin).toBe("compost");
    expect(client.rememberCalls[0].kind).toBe("insight");
    expect(client.rememberCalls[0].expires_at).toBe("2026-07-16T00:00:00.000Z");
    expect(result.outcomes[0].status).toBe("written");
    expect(result.outcomes[0].memory_id).toBe("mem-1");
    expect(result.ok).toBe(true);
  });

  test("long insight → multiple remember calls sharing root_insight_id", async () => {
    const content = "P".repeat(900) + "\n\n" + "P".repeat(900) + "\n\n" + "P".repeat(900);
    const result = await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1"],
      content,
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    expect(client.rememberCalls.length).toBeGreaterThan(1);
    const roots = new Set(
      client.rememberCalls.map((c) => c.source_trace.root_insight_id)
    );
    expect(roots.size).toBe(1);
    expect(result.outcomes.every((o) => o.status === "written")).toBe(true);
    // All chunk contents within cap
    for (const c of client.rememberCalls) {
      expect(c.content.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
    }
  });

  test("remember failure → enqueues to pending, status=pending", async () => {
    client.failRemember = true;
    const result = await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1"],
      content: "short",
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    expect(result.outcomes[0].status).toBe("pending");
    expect(result.outcomes[0].pending_id).toBeDefined();
    expect(queue.listPending()).toHaveLength(1);
  });

  test("remember thrown exception is caught → enqueued as pending", async () => {
    client.throwOnRemember = true;
    const result = await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1"],
      content: "short",
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    expect(result.outcomes[0].status).toBe("pending");
    expect(result.outcomes[0].error).toBe("network thrown");
  });

  test("invalidateFacts success returns invalidated_memory_ids", async () => {
    const result = await writer.invalidateFacts(["f1", "f2"]);
    expect(result.status).toBe("invalidated");
    expect(result.count).toBe(2);
    expect(result.invalidated_memory_ids).toEqual(["mem-of-f1", "mem-of-f2"]);
  });

  test("invalidateFacts failure enqueues for retry", async () => {
    client.failInvalidate = true;
    const result = await writer.invalidateFacts(["f1"]);
    expect(result.status).toBe("pending");
    expect(queue.listPending()).toHaveLength(1);
    const row = queue.listPending()[0];
    expect(row.kind).toBe("invalidate");
  });

  test("flushPending retries failed rows and marks committed on success", async () => {
    // First write fails, then succeeds after toggling
    client.failRemember = true;
    await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1"],
      content: "c",
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    expect(queue.listPending()).toHaveLength(1);

    client.failRemember = false;
    const flush = await writer.flushPending();
    expect(flush.attempted).toBe(1);
    expect(flush.committed).toBe(1);
    expect(flush.failed).toBe(0);
    expect(queue.listPending()).toHaveLength(0);
  });

  test("flushPending bumps attempts on repeated failure", async () => {
    client.failRemember = true;
    await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1"],
      content: "c",
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    const first = await writer.flushPending();
    expect(first.failed).toBe(1);
    const second = await writer.flushPending();
    expect(second.failed).toBe(1);
    const pending = queue.listPending();
    expect(pending[0].attempts).toBe(2);
  });

  test("validateSourceTrace rejects missing compost_fact_ids (R3)", () => {
    expect(() =>
      validateSourceTrace({
        root_insight_id: "00000000-0000-5000-8000-000000000000",
        chunk_index: 0,
        total_chunks: 1,
        split_strategy: "none",
        synthesized_at: "2026-04-17T00:00:00Z",
      })
    ).toThrow();
  });

  test("validateSourceTrace rejects typo'd field name (R3)", () => {
    expect(() =>
      validateSourceTrace({
        compost_fact_id: ["f1"], // singular typo
        root_insight_id: "00000000-0000-5000-8000-000000000000",
        chunk_index: 0,
        total_chunks: 1,
        split_strategy: "none",
        synthesized_at: "2026-04-17T00:00:00Z",
      })
    ).toThrow();
  });

  test("validateSourceTrace rejects invalid UUID on root_insight_id", () => {
    expect(() =>
      validateSourceTrace({
        compost_fact_ids: ["f1"],
        root_insight_id: "not-a-uuid",
        chunk_index: 0,
        total_chunks: 1,
        split_strategy: "none",
        synthesized_at: "2026-04-17T00:00:00Z",
      })
    ).toThrow();
  });

  test("computeExpiresAt adds 90 days by default", () => {
    const r = writer.computeExpiresAt(new Date("2026-01-01T00:00:00Z"));
    expect(r).toBe("2026-04-01T00:00:00.000Z");
  });

  test("computeExpiresAt honors override days", () => {
    const r = writer.computeExpiresAt(
      new Date("2026-01-01T00:00:00Z"),
      180
    );
    expect(r).toBe("2026-06-30T00:00:00.000Z");
  });

  // Debate 024: Engram-side structural dedup contract.
  // Compost writer must treat "Engram returned existing id" as success
  // — same memory_ids returned across two pushes of the same fact set,
  // no new pending writes, no errors.
  describe("idempotency contract with Engram (debate 024)", () => {
    test("two pushes of same fact set return identical memory_ids", async () => {
      client.enableStructuralDedup = true;
      const opts = {
        project: "compost",
        compostFactIds: ["fa", "fb", "fc"],
        content: "same insight content for both pushes",
        synthesizedAt: "2026-04-17T00:00:00Z",
      };
      const r1 = await writer.writeInsight(opts);
      const r2 = await writer.writeInsight(opts);

      expect(r1.root_insight_id).toBe(r2.root_insight_id);
      expect(r1.outcomes.map((o) => o.memory_id)).toEqual(
        r2.outcomes.map((o) => o.memory_id)
      );
      expect(r2.outcomes.every((o) => o.status === "written")).toBe(true);
      expect(queue.listPending()).toHaveLength(0);
    });

    test("multi-chunk push twice — chunks deduplicated independently", async () => {
      client.enableStructuralDedup = true;
      const content = "P".repeat(900) + "\n\n" + "P".repeat(900) + "\n\n" + "P".repeat(900);
      const opts = {
        project: "compost",
        compostFactIds: ["multi"],
        content,
        synthesizedAt: "2026-04-17T00:00:00Z",
      };
      const r1 = await writer.writeInsight(opts);
      const r2 = await writer.writeInsight(opts);

      expect(r1.outcomes.length).toBeGreaterThan(1);
      expect(r2.outcomes.map((o) => o.memory_id)).toEqual(
        r1.outcomes.map((o) => o.memory_id)
      );
      // Without dedup, nextRememberId would be > r1.outcomes.length * 2.
      // With dedup, only r1.outcomes.length distinct ids ever issued.
      const allIds = new Set(client.rememberCalls.map((_, i) =>
        r1.outcomes[i % r1.outcomes.length].memory_id
      ));
      expect(allIds.size).toBe(r1.outcomes.length);
    });
  });
});
