import pino from "pino";
import {
  type EngramMcpClient,
  EngramWriter,
} from "../../compost-engram-adapter/src/writer";
import { PendingWritesQueue } from "../../compost-engram-adapter/src/pending-writes";

const log = pino({ name: "compost-engram-flusher" });

const DEFAULT_FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface Scheduler {
  stop(): void;
}

export interface EngramFlusherOpts {
  /** Concrete write-side MCP client (e.g. StdioEngramMcpClient). */
  mcpClient: EngramMcpClient;
  /**
   * Queue instance. Caller owns lifecycle — same queue is typically
   * shared with the EngramWriter used at synthesis sites so writer and
   * flusher operate on the same table.
   */
  queue: PendingWritesQueue;
  /** Flush cadence. Default 5 minutes. Tests may pass a small value. */
  intervalMs?: number;
  /** Run one immediate flush before the timer loop (default true). */
  runImmediately?: boolean;
}

export interface FlushStats {
  attempted: number;
  committed: number;
  failed: number;
}

/**
 * Periodically calls `EngramWriter.flushPending()` to drain the offline
 * queue into Engram. Mirrors the engram-poller shape: one-shot tick for
 * tests via `intervalMs=0`, `stop()` halts cleanly, errors are logged
 * but don't crash the loop.
 */
export function startEngramFlusher(opts: EngramFlusherOpts): Scheduler {
  let running = true;
  const writer = new EngramWriter(opts.mcpClient, opts.queue);

  async function loop() {
    const intervalMs = opts.intervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    let first = opts.runImmediately ?? true;

    while (running) {
      if (!first) await Bun.sleep(intervalMs);
      if (!running) break;
      first = false;

      try {
        const stats = await writer.flushPending();
        if (stats.attempted > 0 || stats.failed > 0) {
          log.info({ stats }, "engram flush complete");
        }
      } catch (err) {
        log.error({ err }, "engram flush error (continuing)");
      }

      if (intervalMs === 0) break;
    }
  }

  loop();

  return {
    stop() {
      running = false;
    },
  };
}

/** Single-shot flush for CLI `compost engram-push`. */
export async function runEngramFlushOnce(opts: {
  mcpClient: EngramMcpClient;
  queue: PendingWritesQueue;
}): Promise<FlushStats> {
  const writer = new EngramWriter(opts.mcpClient, opts.queue);
  return writer.flushPending();
}
