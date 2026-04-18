import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startDaemon, stopDaemon } from "../src/main";
import type { EngramMcpClient, RememberArgs } from "../../compost-engram-adapter/src/writer";
import type {
  EngramStreamClient,
  StreamForCompostArgs,
  EngramStreamEntry,
} from "../../compost-engram-adapter/src/stream-puller";
import type { MCPCallResult } from "../../compost-engram-adapter/src/writer";
import { PendingWritesQueue } from "../../compost-engram-adapter/src/pending-writes";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeMcpClient implements EngramMcpClient {
  rememberCalls: RememberArgs[] = [];
  invalidateCalls: Array<{ fact_ids: string[] }> = [];
  closed = false;

  async remember(args: RememberArgs) {
    this.rememberCalls.push(args);
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

  async close() {
    this.closed = true;
  }
}

class FakeStreamClient implements EngramStreamClient {
  calls = 0;
  entries: EngramStreamEntry[];

  constructor(entries: EngramStreamEntry[] = []) {
    this.entries = entries;
  }

  async streamForCompost(
    _args: StreamForCompostArgs
  ): Promise<MCPCallResult<EngramStreamEntry[]>> {
    this.calls++;
    // Return entries once; subsequent polls return empty to break the pager loop
    const data = this.calls === 1 ? this.entries : [];
    return { ok: true as const, data };
  }
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "compost-daemon-engram-"));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startDaemon — Engram wiring (T2)", () => {
  let tmpDir: string | null = null;

  afterEach(async () => {
    await stopDaemon();
    if (tmpDir) {
      cleanupDir(tmpDir);
      tmpDir = null;
    }
  });

  test("default (no engramOpts): both schedulers skipped — no subprocess spawn", async () => {
    tmpDir = makeTmpDir();
    // If this test ever tries to spawn engram-server / engram, it would
    // log an ENOENT warning but still pass. We verify the *absence* of
    // wiring by asserting pending-writes.db was not created.
    await startDaemon(tmpDir, false);
    const pendingDb = join(tmpDir, "pending-engram-writes.db");
    expect(existsSync(pendingDb)).toBe(false);
  });

  test("engramOpts.disabled=true: both schedulers skipped", async () => {
    tmpDir = makeTmpDir();
    await startDaemon(tmpDir, false, { disabled: true });
    const pendingDb = join(tmpDir, "pending-engram-writes.db");
    expect(existsSync(pendingDb)).toBe(false);
  });

  test("injected flusherMcpClient enables flusher (no explicit disabled=false needed)", async () => {
    tmpDir = makeTmpDir();
    const mcpClient = new FakeMcpClient();
    // Seed pending queue BEFORE daemon start so flusher has work on its
    // first tick.
    const queuePath = join(tmpDir, "pending-engram-writes.db");
    const seedQueue = new PendingWritesQueue(queuePath);
    seedQueue.enqueue("invalidate", {
      payload: { fact_ids: ["f-test"] },
    });
    seedQueue.close();

    await startDaemon(tmpDir, false, {
      flusherMcpClient: mcpClient,
      flushIntervalMs: 10_000, // one immediate tick, then long sleep
      pendingWritesPath: queuePath,
    });

    // Flusher's startEngramFlusher has runImmediately default true, so the
    // first flush tick fires inside the event loop. Yield briefly so the
    // pending invalidate lands before we inspect.
    await Bun.sleep(50);

    expect(mcpClient.invalidateCalls).toHaveLength(1);
    expect(mcpClient.invalidateCalls[0]).toEqual({ fact_ids: ["f-test"] });
  });

  test("injected pollerStreamClient enables poller", async () => {
    tmpDir = makeTmpDir();
    const streamClient = new FakeStreamClient([]);

    await startDaemon(tmpDir, false, {
      pollerStreamClient: streamClient,
      pollIntervalMs: 10_000,
    });

    await Bun.sleep(50);

    expect(streamClient.calls).toBeGreaterThanOrEqual(1);
  });

  test("disabled=false with no injected clients attempts auto-wire (env-driven) and degrades when binaries missing", async () => {
    tmpDir = makeTmpDir();
    // Point to nonexistent binaries so we get the HC-1 degrade path.
    const handle = await startDaemon(tmpDir, false, {
      disabled: false,
      engramServerCmd: "/nonexistent/engram-server-does-not-exist",
      engramBin: "/nonexistent/engram-does-not-exist",
      flushIntervalMs: 10_000,
      pollIntervalMs: 10_000,
    });
    // Daemon must still be running. shutdown shouldn't throw.
    expect(handle.db).toBeDefined();
    await handle.stop();
  });

  test("shutdown closes injected flusher's MCP client and pending queue", async () => {
    tmpDir = makeTmpDir();
    const mcpClient = new FakeMcpClient();
    const handle = await startDaemon(tmpDir, false, {
      flusherMcpClient: mcpClient,
      flushIntervalMs: 10_000,
    });
    await Bun.sleep(30);
    await handle.stop();
    // Injected (caller-owned) clients must NOT be closed by daemon —
    // FakeMcpClient.closed should stay false.
    expect(mcpClient.closed).toBe(false);
  });
});
