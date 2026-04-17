import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  type EngramMcpClient,
  PendingWritesQueue,
  type RememberArgs,
} from "../../compost-engram-adapter/src";
import {
  runEngramFlushOnce,
  startEngramFlusher,
} from "../src/engram-flusher";

class FakeMcpClient implements EngramMcpClient {
  rememberCalls: RememberArgs[] = [];
  invalidateCalls: Array<{ fact_ids: string[] }> = [];
  failRemember = false;

  async remember(args: RememberArgs) {
    this.rememberCalls.push(args);
    if (this.failRemember) {
      return { ok: false as const, error: "mcp refused" };
    }
    return {
      ok: true as const,
      data: { id: `mem-${this.rememberCalls.length}` },
    };
  }

  async invalidate(args: { fact_ids: string[] }) {
    this.invalidateCalls.push(args);
    return {
      ok: true as const,
      data: {
        invalidated_memory_ids: args.fact_ids.map((f) => `mem-of-${f}`),
        count: args.fact_ids.length,
      },
    };
  }
}

function seedQueue(queue: PendingWritesQueue, mode: "remember" | "invalidate"): number {
  if (mode === "remember") {
    return queue.enqueue("remember", {
      payload: {
        origin: "compost",
        kind: "insight",
        content: "c",
        project: "compost",
        scope: "project",
        source_trace: { compost_fact_ids: ["f1"] },
        expires_at: "2026-07-16T00:00:00Z",
      },
    });
  }
  return queue.enqueue("invalidate", { payload: { fact_ids: ["f1"] } });
}

describe("runEngramFlushOnce", () => {
  let tmpDir: string;
  let queue: PendingWritesQueue;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-flusher-"));
    queue = new PendingWritesQueue(join(tmpDir, "pending.db"));
  });

  afterEach(() => {
    queue.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("empty queue is a no-op", async () => {
    const mcpClient = new FakeMcpClient();
    const stats = await runEngramFlushOnce({ mcpClient, queue });
    expect(stats.attempted).toBe(0);
    expect(stats.committed).toBe(0);
    expect(stats.failed).toBe(0);
  });

  test("commits remember + invalidate pair", async () => {
    seedQueue(queue, "remember");
    seedQueue(queue, "invalidate");
    const mcpClient = new FakeMcpClient();
    const stats = await runEngramFlushOnce({ mcpClient, queue });
    expect(stats.attempted).toBe(2);
    expect(stats.committed).toBe(2);
    expect(stats.failed).toBe(0);
    expect(mcpClient.rememberCalls).toHaveLength(1);
    expect(mcpClient.invalidateCalls).toHaveLength(1);
    expect(queue.listPending()).toHaveLength(0);
  });

  test("failures bump attempts, stay pending", async () => {
    seedQueue(queue, "remember");
    const mcpClient = new FakeMcpClient();
    mcpClient.failRemember = true;
    const stats = await runEngramFlushOnce({ mcpClient, queue });
    expect(stats.failed).toBe(1);
    expect(stats.committed).toBe(0);
    const pending = queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.attempts).toBe(1);
  });
});

describe("startEngramFlusher", () => {
  let tmpDir: string;
  let queue: PendingWritesQueue;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-flusher-"));
    queue = new PendingWritesQueue(join(tmpDir, "pending.db"));
  });

  afterEach(() => {
    queue.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("one-shot intervalMs=0 runs once then exits", async () => {
    seedQueue(queue, "remember");
    const mcpClient = new FakeMcpClient();
    const s = startEngramFlusher({
      mcpClient,
      queue,
      intervalMs: 0,
      runImmediately: true,
    });
    await Bun.sleep(50);
    s.stop();

    expect(queue.listPending()).toHaveLength(0);
    expect(mcpClient.rememberCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("stop halts before next interval", async () => {
    const mcpClient = new FakeMcpClient();
    const s = startEngramFlusher({
      mcpClient,
      queue,
      intervalMs: 10_000,
      runImmediately: true,
    });
    await Bun.sleep(30);
    s.stop();
    const snapshot = mcpClient.rememberCalls.length;
    await Bun.sleep(50);
    expect(mcpClient.rememberCalls.length).toBe(snapshot);
  });
});
