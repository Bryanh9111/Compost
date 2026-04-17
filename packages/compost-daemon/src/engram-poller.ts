import type { Database } from "bun:sqlite";
import pino from "pino";
import {
  type EngramStreamClient,
  StreamPuller,
} from "../../compost-engram-adapter/src/stream-puller";
import {
  ensureEngramSource,
  ingestEngramEntry,
} from "../../compost-engram-adapter/src/ingest-adapter";

const log = pino({ name: "compost-engram-poller" });

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface Scheduler {
  stop(): void;
}

export interface EngramPollerOpts {
  client: EngramStreamClient;
  /** Polling cadence. Default 5 minutes. Tests pass small values. */
  intervalMs?: number;
  /** Override cursor file path for tests / multi-user installs. */
  cursorPath?: string;
  /** Restrict stream to these Engram kinds. Default: all. */
  kinds?: string[];
  /** Restrict stream to a single project. Default: all. */
  project?: string | null;
  /** Run one immediate poll before entering the timer loop (default true). */
  runImmediately?: boolean;
}

interface PollStats {
  batches: number;
  entries_seen: number;
  entries_new: number;
  entries_duplicate: number;
  errors: string[];
}

/**
 * Periodically pulls Engram entries via `client` and ingests each into
 * Compost's ledger via `ingestEngramEntry`. Cursor is persisted by the
 * StreamPuller only after a successful ingest batch, so a crashed daemon
 * resumes from the last fully-processed entry.
 *
 * Session 6 slice 1 — concrete read-path transport for Phase 5.
 */
export function startEngramPoller(
  db: Database,
  opts: EngramPollerOpts
): Scheduler {
  let running = true;

  // One-time source row seed. Safe to call on every startup — idempotent.
  ensureEngramSource(db);

  const pullerOpts: {
    kinds?: string[];
    project?: string | null;
    cursorPath?: string;
  } = {};
  if (opts.kinds !== undefined) pullerOpts.kinds = opts.kinds;
  if (opts.project !== undefined) pullerOpts.project = opts.project;
  if (opts.cursorPath !== undefined) pullerOpts.cursorPath = opts.cursorPath;

  const puller = new StreamPuller(opts.client, pullerOpts);

  async function pollOnce(): Promise<PollStats> {
    const stats: PollStats = {
      batches: 0,
      entries_seen: 0,
      entries_new: 0,
      entries_duplicate: 0,
      errors: [],
    };

    const pullStats = await puller.pullAll(async (batch) => {
      stats.entries_seen += batch.length;
      for (const entry of batch) {
        try {
          const r = ingestEngramEntry(db, entry);
          if (r.inserted === "new") stats.entries_new++;
          else stats.entries_duplicate++;
        } catch (e) {
          stats.errors.push(
            `ingest ${entry.memory_id}: ${
              e instanceof Error ? e.message : String(e)
            }`
          );
        }
      }
    });

    stats.batches = pullStats.batches;
    stats.errors.push(...pullStats.errors);
    return stats;
  }

  async function loop() {
    const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    let first = opts.runImmediately ?? true;

    while (running) {
      if (!first) await Bun.sleep(intervalMs);
      if (!running) break;
      first = false;

      try {
        const stats = await pollOnce();
        log.info({ stats }, "engram poll complete");
      } catch (err) {
        log.error({ err }, "engram poll error (continuing)");
      }

      // If intervalMs is 0, the loop is expected to tick once — used by
      // tests driving one-shot ingestion. Break after first cycle.
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

// Exposed for direct invocation (CLI `compost engram-pull`).
export async function runEngramPullOnce(
  db: Database,
  opts: {
    client: EngramStreamClient;
    cursorPath?: string;
    kinds?: string[];
    project?: string | null;
  }
): Promise<PollStats> {
  ensureEngramSource(db);

  const pullerOpts: {
    kinds?: string[];
    project?: string | null;
    cursorPath?: string;
  } = {};
  if (opts.kinds !== undefined) pullerOpts.kinds = opts.kinds;
  if (opts.project !== undefined) pullerOpts.project = opts.project;
  if (opts.cursorPath !== undefined) pullerOpts.cursorPath = opts.cursorPath;

  const puller = new StreamPuller(opts.client, pullerOpts);

  const stats: PollStats = {
    batches: 0,
    entries_seen: 0,
    entries_new: 0,
    entries_duplicate: 0,
    errors: [],
  };

  const pullStats = await puller.pullAll(async (batch) => {
    stats.entries_seen += batch.length;
    for (const entry of batch) {
      try {
        const r = ingestEngramEntry(db, entry);
        if (r.inserted === "new") stats.entries_new++;
        else stats.entries_duplicate++;
      } catch (e) {
        stats.errors.push(
          `ingest ${entry.memory_id}: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }
  });
  stats.batches = pullStats.batches;
  stats.errors.push(...pullStats.errors);
  return stats;
}
