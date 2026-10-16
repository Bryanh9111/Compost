import type { Database } from "bun:sqlite";
import { drainOne } from "../../compost-core/src/ledger/outbox";
import { reflect, type ReflectionReport } from "../../compost-core/src/cognitive/reflect";
import { triage } from "../../compost-core/src/cognitive/triage";
import { synthesizeWiki } from "../../compost-core/src/cognitive/wiki";
import { runCycle } from "../../compost-core/src/cognitive/reason-scheduler";
import type { BreakerRegistry } from "../../compost-core/src/llm/breaker-registry";
import type { LLMService } from "../../compost-core/src/llm/types";
import { ingestUrl } from "../../compost-core/src/pipeline/web-ingest";
import { claimOne, complete, fail, heartbeat } from "../../compost-core/src/queue/lease";
import {
  beginDerivation,
  failDerivation,
  hasSucceededIngestDerivation,
  persistExtraction,
  type ExtractionOutput,
} from "../../compost-core/src/pipeline/persist-extraction";
import { embedPendingChunks, type PendingVectorStore } from "../../compost-core/src/pipeline/embed-pending";
import { extractionTimeoutMs, runExtractor, type ExtractFn } from "../../compost-core/src/pipeline/extractor";
import { getActivePolicy } from "../../compost-core/src/policies/registry";
import { reconcileActionPointers } from "../../compost-core/src/metacognitive/action-reconciler";
import { v7 as uuidv7 } from "uuid";
import { existsSync } from "fs";
import { join } from "path";
import type { EmbeddingService } from "../../compost-core/src/embedding/types";
import type { VectorStore } from "../../compost-core/src/storage/lancedb";
import pino from "pino";

const log = pino({ name: "compost-scheduler" });

const REFLECT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DRAIN_EMPTY_SLEEP_MS = 1000; // 1s backoff when queue is empty
const INGEST_EMPTY_SLEEP_MS = 2000; // 2s backoff when ingest queue is empty
const FRESHNESS_CHECK_INTERVAL_MS = 60_000; // 60s between freshness loop ticks
const REASONING_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours (debate 026 §Q2 (p))

export interface SchedulerHealth {
  name: string;
  last_tick_at: string | null;
  error_count: number;
  running: boolean;
}

export interface Scheduler {
  stop(): void | Promise<void>;
  getHealth(): SchedulerHealth;
}

/**
 * Drain loop: processes one outbox row per iteration.
 * Backs off 1s when the queue is empty. Runs until stopped.
 */
export function startDrainLoop(db: Database): Scheduler {
  let running = true;
  let lastTickAt: string | null = null;
  let errorCount = 0;

  async function loop() {
    while (running) {
      try {
        const result = drainOne(db);
        if (!result) {
          lastTickAt = new Date().toISOString();
          // queue empty — sleep before next poll
          await Bun.sleep(DRAIN_EMPTY_SLEEP_MS);
        } else {
          log.debug({ seq: result.seq, observe_id: result.observe_id }, "drained");

          // P0-5: post-drain correction scan. Runs per-observe_id (debate 006
          // Fix 3) so the cost scales with ingest rate rather than a separate
          // polling loop. Failures are swallowed — correction detection is a
          // best-effort signal, not a blocking step.
          try {
            const scan = scanObservationForCorrection(db, result.observe_id);
            if (scan.eventId !== null) {
              log.info(
                { observe_id: result.observe_id, correction_event_id: scan.eventId },
                "correction event recorded"
              );
            }
          } catch (scanErr) {
            log.error(
              { err: scanErr, observe_id: result.observe_id },
              "correction scan failed (continuing)"
            );
          }
          lastTickAt = new Date().toISOString();
        }
      } catch (err) {
        errorCount++;
        log.error({ err }, "drain loop error");
        await Bun.sleep(DRAIN_EMPTY_SLEEP_MS);
      }
    }
  }

  // Fire-and-forget; errors are caught inside the loop
  void loop();

  return {
    stop() {
      running = false;
    },
    getHealth() {
      return { name: "drain", last_tick_at: lastTickAt, error_count: errorCount, running };
    },
  };
}

export interface ReflectSchedulerOpts {
  /** Optional LLM/registry for post-reflect wiki synthesis (debate 009 Fix 2). */
  llm?: BreakerRegistry | LLMService;
  /** Required when `llm` is provided; wiki pages land under `<dataDir>/wiki`. */
  dataDir?: string;
  /**
   * Test-only override for the 6h reflect cadence. Production callers must
   * leave this unset; tests pass a small value (e.g. 5ms) to drive one or
   * two cycles in sub-second wall time (Week 4 Day 4 scheduler integration).
   */
  intervalMs?: number;
  /** Drops the vectors of observations the sensory GC removed. */
  vectorStore?: VectorGc;
}

export interface VectorGc {
  deleteByObserveIds(observeIds: string[]): Promise<void>;
}

/**
 * Reflect scheduler: runs reflect(db) every 6 hours.
 *
 * Debate 009 Fix 2: when `opts.llm` + `opts.dataDir` are supplied, also runs
 * `synthesizeWiki` after each successful reflect. Without this hook the
 * wiki_rebuild audit rows and `wiki_pages.stale_at` fallback never fire in
 * the daemon path. Wiki errors are logged and swallowed so one bad topic
 * cannot stall the reflect cadence.
 */
export function startReflectScheduler(
  db: Database,
  opts: ReflectSchedulerOpts = {}
): Scheduler {
  let running = true;
  let lastTickAt: string | null = null;
  let errorCount = 0;
  const intervalMs = opts.intervalMs ?? REFLECT_INTERVAL_MS;

  async function loop() {
    while (running) {
      await Bun.sleep(intervalMs);
      if (!running) break;
      let report: ReflectionReport;
      try {
        report = reflect(db);
        log.info({ report: { ...report, sensoryObserveIdsDeleted: report.sensoryObserveIdsDeleted.length } }, "reflect complete");
      } catch (err) {
        errorCount++;
        log.error({ err }, "reflect error");
        continue; // skip triage + wiki synth when reflect failed
      }

      if (opts.vectorStore && report.sensoryObserveIdsDeleted.length > 0) {
        try {
          await opts.vectorStore.deleteByObserveIds(report.sensoryObserveIdsDeleted);
        } catch (err) {
          errorCount++;
          log.error({ err, observations: report.sensoryObserveIdsDeleted.length }, "vector GC error (continuing)");
        }
      }

      // Debate 013 F2: run triage after reflect so the 5 scanners produce
      // signals autonomously (correction_candidate is already drain-hook
      // written). Without this, `stale_fact` / `stuck_outbox` / `stale_wiki`
      // / `orphan_delta` / `unresolved_contradiction` would only surface
      // when the user manually invoked `compost triage scan`.
      try {
        const triageReport = triage(db);
        log.info({ triageReport }, "triage complete");
      } catch (err) {
        errorCount++;
        log.error({ err }, "triage error (continuing)");
      }

      // FROZEN 2026-05-02 v4 metacognitive turn — wiki page background synthesis
      // halted; on-demand wiki retrieval+synthesis still available via `compost ask`.
      // See docs/metacognitive-direction.md for rationale.
      // Env-gated for revival: WIKI_SYNTHESIS_ENABLED=true reactivates without
      // code change. synthesizeWiki function preserved + import retained.
      if (process.env.WIKI_SYNTHESIS_ENABLED === "true" && opts.llm && opts.dataDir) {
        try {
          const wikiResult = await synthesizeWiki(db, opts.llm, opts.dataDir);
          log.info({ wikiResult }, "wiki synthesis complete");
        } catch (err) {
          errorCount++;
          log.error({ err }, "wiki synthesis error (continuing)");
        }
      }
      lastTickAt = new Date().toISOString();
    }
  }

  void loop();

  return {
    stop() {
      running = false;
    },
    getHealth() {
      return { name: "reflect", last_tick_at: lastTickAt, error_count: errorCount, running };
    },
  };
}

/**
 * Freshness loop: checks web_fetch_state for due sources and re-ingests.
 * Polls every 60s. Uses conditional requests (ETag/Last-Modified).
 */
export function startFreshnessLoop(db: Database, dataDir: string): Scheduler {
  let running = true;
  let lastTickAt: string | null = null;
  let errorCount = 0;

  async function loop() {
    while (running) {
      await Bun.sleep(FRESHNESS_CHECK_INTERVAL_MS);
      if (!running) break;

      try {
        const nowSec = Math.floor(Date.now() / 1000);

        const dueSources = db
          .query(
            `SELECT wfs.source_id, s.uri
             FROM web_fetch_state wfs
             JOIN source s ON s.id = wfs.source_id
             WHERE wfs.next_check_at_unix_sec <= ?
               AND (wfs.backoff_until_unix_sec IS NULL OR wfs.backoff_until_unix_sec <= ?)
             ORDER BY wfs.next_check_at_unix_sec ASC
             LIMIT 10`
          )
          .all(nowSec, nowSec) as Array<{ source_id: string; uri: string }>;

        if (dueSources.length === 0) {
          lastTickAt = new Date().toISOString();
          continue;
        }

        for (const src of dueSources) {
          if (!running) break;
          try {
            const result = await ingestUrl(db, src.uri, dataDir);
            if (result.skipped_304) {
              log.debug({ url: src.uri }, "freshness: 304 not modified");
            } else if (result.ok) {
              log.info(
                { url: src.uri, facts: result.facts_count, chunks: result.chunks_count },
                "freshness: re-ingested"
              );
            } else {
              log.warn({ url: src.uri, error: result.error }, "freshness: ingest failed");
            }
          } catch (err) {
            errorCount++;
            log.error({ err, url: src.uri }, "freshness: source error");
          }
        }
        lastTickAt = new Date().toISOString();
      } catch (err) {
        errorCount++;
        log.error({ err }, "freshness loop error");
      }
    }
  }

  void loop();

  return {
    stop() {
      running = false;
    },
    getHealth() {
      return { name: "freshness", last_tick_at: lastTickAt, error_count: errorCount, running };
    },
  };
}

export interface IngestWorkerOpts {
  embeddingService: EmbeddingService;
  vectorStore: PendingVectorStore;
  dataDir: string;
  /** Extraction runner; tests inject one instead of spawning Python. */
  extract?: ExtractFn;
  /** Lease heartbeat period while an extraction runs. */
  heartbeatMs?: number;
  /** Pause after a failed extraction, on top of the queue's own backoff. */
  failureSleepMs?: number;
}

const INGEST_HEARTBEAT_MS = 20_000;
const INGEST_FAILURE_SLEEP_MS = 1000;
const SWEEP_BACKOFF_BASE_MS = 2000;
const SWEEP_BACKOFF_CAP_MS = 5 * 60 * 1000;
const EMBED_BATCH = 64;

/**
 * Ingest worker: claims from ingest_queue, runs the extractor, persists
 * facts + chunks + derivation + queue completion in one transaction, then
 * embeds the observation's chunks. Embedding is best effort inline: the idle
 * sweep (embedPendingChunks with no observation filter) catches up after an
 * Ollama outage, so facts are never held back by vectors.
 */
export function startIngestWorker(db: Database, opts: IngestWorkerOpts): Scheduler {
  let running = true;
  let lastTickAt: string | null = null;
  let errorCount = 0;
  let sweepFailures = 0;
  let sweepBlockedUntil = 0;
  const extract = opts.extract ?? runExtractor;
  const heartbeatMs = opts.heartbeatMs ?? INGEST_HEARTBEAT_MS;
  const failureSleepMs = opts.failureSleepMs ?? INGEST_FAILURE_SLEEP_MS;
  const embedOpts = {
    embeddingService: opts.embeddingService,
    vectorStore: opts.vectorStore,
    limit: EMBED_BATCH,
  };

  async function embedObservation(observeId: string): Promise<number> {
    let embedded = 0;
    for (;;) {
      const result = await embedPendingChunks(db, { ...embedOpts, observeId });
      embedded += result.embedded;
      if (result.remaining === 0 || result.embedded === 0) return embedded;
    }
  }

  async function processOne(): Promise<boolean> {
    const policy = getActivePolicy();
    const maxRetries = policy.extraction.maxRetries;
    const claimed = claimOne(db, `daemon:${process.pid}`, { maxRetries });
    if (!claimed) return false;

    const obs = db
      .query(
        `SELECT observe_id, source_uri, mime_type, raw_bytes
         FROM observations WHERE observe_id = ?`
      )
      .get(claimed.observe_id) as {
      observe_id: string;
      source_uri: string;
      mime_type: string;
      raw_bytes: Buffer | null;
    } | null;

    if (!obs) {
      fail(db, claimed.id, claimed.lease_token, "observation not found", { maxRetries });
      return true;
    }

    if (hasSucceededIngestDerivation(db, obs.observe_id, policy.id)) {
      complete(db, claimed.id, claimed.lease_token);
      log.info({ observe_id: obs.observe_id }, "ingest worker: already processed");
      return true;
    }

    const derivationId = uuidv7();
    const abort = new AbortController();
    const pulse = setInterval(() => {
      if (!heartbeat(db, claimed.id, claimed.lease_token)) {
        abort.abort(new Error("lease stolen by another worker"));
      }
    }, heartbeatMs);

    let output: ExtractionOutput;
    try {
      beginDerivation(db, { derivationId, observeId: obs.observe_id, policyId: policy.id });
      output = await extract(
        {
          observe_id: obs.observe_id,
          source_uri: obs.source_uri,
          mime_type: obs.mime_type,
          content_ref: "inline",
          content: obs.raw_bytes ? obs.raw_bytes.toString("utf-8") : "",
          transform_policy: policy.id,
        },
        { timeoutMs: extractionTimeoutMs(policy.extraction.timeoutSec), signal: abort.signal }
      );
      abort.signal.throwIfAborted();
      persistExtraction(db, {
        observeId: obs.observe_id,
        derivationId,
        policyId: policy.id,
        output,
        queue: { id: claimed.id, leaseToken: claimed.lease_token },
      });
    } catch (err) {
      errorCount++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      failDerivation(db, derivationId, errorMsg);
      fail(db, claimed.id, claimed.lease_token, errorMsg, { maxRetries });
      log.error({ err, observe_id: obs.observe_id, attempts: claimed.attempts }, "ingest worker: failed");
      if (failureSleepMs > 0) await Bun.sleep(failureSleepMs);
      return true;
    } finally {
      clearInterval(pulse);
    }

    let embedded = 0;
    try {
      embedded = await embedObservation(obs.observe_id);
    } catch (err) {
      errorCount++;
      log.warn({ err, observe_id: obs.observe_id }, "ingest worker: embedding deferred to the pending sweep");
    }
    log.info(
      { observe_id: obs.observe_id, facts: output.facts.length, chunks: output.chunks.length, embedded },
      "ingest worker: processed"
    );
    return true;
  }

  /** Idle-time catch-up for chunks left unembedded; backs off while the service is down. */
  async function sweepPending(): Promise<number> {
    if (Date.now() < sweepBlockedUntil) return 0;
    try {
      const result = await embedPendingChunks(db, embedOpts);
      sweepFailures = 0;
      if (result.embedded > 0 || result.failed > 0) {
        log.info(result, "ingest worker: embedded pending chunks");
      }
      return result.embedded;
    } catch (err) {
      errorCount++;
      sweepFailures++;
      const backoff = Math.min(SWEEP_BACKOFF_BASE_MS * 2 ** (sweepFailures - 1), SWEEP_BACKOFF_CAP_MS);
      sweepBlockedUntil = Date.now() + backoff;
      log.warn({ err, sweep_failures: sweepFailures, backoff_ms: backoff }, "ingest worker: pending embedding sweep failed");
      return 0;
    }
  }

  async function loop() {
    while (running) {
      try {
        const processed = await processOne();
        lastTickAt = new Date().toISOString();
        if (!processed && (await sweepPending()) === 0) {
          await Bun.sleep(INGEST_EMPTY_SLEEP_MS);
        }
      } catch (err) {
        errorCount++;
        log.error({ err }, "ingest worker loop error");
        await Bun.sleep(INGEST_EMPTY_SLEEP_MS);
      }
    }
  }

  void loop();

  return {
    stop() {
      running = false;
    },
    getHealth() {
      return { name: "ingest", last_tick_at: lastTickAt, error_count: errorCount, running };
    },
  };
}

// =====================================================================
// Backup scheduler (P0-7, locked by debate 003 Pre-P0 fix #5)
// =====================================================================

import {
  backup,
  pruneOldBackups,
  DEFAULT_BACKUP_RETENTION,
} from "../../compost-core/src/persistence/backup";
import { rotateLog } from "../../compost-core/src/persistence/log-rotate";
import { takeSnapshot as takeGraphHealthSnapshot } from "../../compost-core/src/cognitive/graph-health";
import { scanObservationForCorrection } from "../../compost-core/src/cognitive/correction-detector";

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_TIME_WINDOW_HOUR_UTC = 3;
const BACKUP_GRACE_WINDOW_MS = 60 * 60 * 1000; // fire immediately if within 1h of 03:00 UTC and no backup today
const GRAPH_HEALTH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GRAPH_HEALTH_TIME_WINDOW_HOUR_UTC = 4; // one hour after backup; see ARCHITECTURE.md scheduler table
const ACTION_RECONCILE_TIME_WINDOW_HOUR_UTC = 5; // after backup + graph-health; read-only action pointer audit

export interface BackupSchedulerOpts {
  ledgerPath: string;
  backupDir: string;
  retentionCount?: number;
  /** Compacts LanceDB fragments after the backup; every write adds one. */
  vectorStore?: { optimize(): Promise<void> };
  /** launchd appends the daemon's stdout here; rotated copy-then-truncate. */
  logPath?: string;
}

export interface BackupTickResult {
  path: string;
  sizeBytes: number;
  durationMs: number;
  prunedCount: number;
  retention: number;
  optimized: boolean;
  optimize_error?: string;
  log_rotated: boolean;
}

/** One backup window: snapshot, prune, then best-effort index compaction. */
export async function runBackupTick(db: Database, opts: BackupSchedulerOpts): Promise<BackupTickResult> {
  const retention = opts.retentionCount ?? DEFAULT_BACKUP_RETENTION;
  const result = backup(db, opts.backupDir);
  const prunedCount = pruneOldBackups(opts.backupDir, retention);
  const tick: BackupTickResult = {
    path: result.path,
    sizeBytes: result.sizeBytes,
    durationMs: result.durationMs,
    prunedCount,
    retention,
    optimized: false,
    log_rotated: opts.logPath ? rotateLog(opts.logPath).rotated : false,
  };
  if (opts.vectorStore) {
    try {
      await opts.vectorStore.optimize();
      tick.optimized = true;
    } catch (err) {
      tick.optimize_error = err instanceof Error ? err.message : String(err);
    }
  }
  return tick;
}

/**
 * P0-7 backup scheduler: runs SQLite VACUUM INTO once per day at 03:00 UTC.
 *
 * Time window locked at 03:00 UTC to avoid SQLite writer-lock contention with
 * startReflectScheduler (aligned to 00/06/12/18 UTC). See ARCHITECTURE.md
 * §"Scheduler hook points" for the full discipline.
 *
 * Records each successful run via a structured log line and prunes old
 * snapshots beyond `retentionCount` (default 30).
 */
/**
 * Compute milliseconds until the next 03:00 UTC backup window, with the
 * audit-fix #5 grace handling: if we are within 1h after 03:00 UTC AND no
 * backup exists for today, fire immediately. Without this, a daemon
 * restart at 03:01 UTC would wait ~24h before its next attempt.
 *
 * Exported pure helper so tests can pass an explicit `now`.
 */
export function msUntilNextBackupWindow(
  backupDir: string,
  now: Date = new Date()
): number {
  const target = new Date(now);
  target.setUTCHours(BACKUP_TIME_WINDOW_HOUR_UTC, 0, 0, 0);

  const elapsedSinceTarget = now.getTime() - target.getTime();
  if (elapsedSinceTarget >= 0 && elapsedSinceTarget < BACKUP_GRACE_WINDOW_MS) {
    const dateStr = now.toISOString().slice(0, 10);
    const todayPath = join(backupDir, `${dateStr}.db`);
    if (!existsSync(todayPath)) {
      return 0;
    }
  }

  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

export function startBackupScheduler(
  db: Database,
  opts: BackupSchedulerOpts
): Scheduler {
  let running = true;
  let lastTickAt: string | null = null;
  let errorCount = 0;

  function msUntilNextWindow(): number {
    return msUntilNextBackupWindow(opts.backupDir);
  }

  async function loop() {
    while (running) {
      const wait = msUntilNextWindow();
      log.debug(
        { waitMs: wait, ledger: opts.ledgerPath, backupDir: opts.backupDir },
        "backup scheduler: waiting for 03:00 UTC window"
      );
      await Bun.sleep(wait);
      if (!running) break;
      try {
        const tick = await runBackupTick(db, opts);
        if (tick.optimize_error) errorCount++;
        log.info(tick, "backup complete");
        lastTickAt = new Date().toISOString();
        // Sleep most of the day to leave the 03:00 window before next check
        await Bun.sleep(BACKUP_INTERVAL_MS - 60_000);
      } catch (err) {
        errorCount++;
        log.error({ err, backupDir: opts.backupDir }, "backup scheduler error");
        await Bun.sleep(BACKUP_INTERVAL_MS);
      }
    }
  }

  void loop();

  return {
    stop() {
      running = false;
    },
    getHealth() {
      return { name: "backup", last_tick_at: lastTickAt, error_count: errorCount, running };
    },
  };
}

// =====================================================================
// Graph-health scheduler (P0-3 Week 2, debate 006 Fix 6)
// =====================================================================

/**
 * Compute milliseconds until the next 04:00 UTC graph-health window.
 * Exported pure helper so tests can pass an explicit `now`.
 *
 * Time window: 04:00 UTC, one hour after `startBackupScheduler`'s 03:00
 * window. Avoids both the backup VACUUM lock (which can exceed 30min on
 * large DBs) and the reflect 6h aligned slots (00/06/12/18 UTC).
 */
export function msUntilNextGraphHealthWindow(now: Date = new Date()): number {
  const target = new Date(now);
  target.setUTCHours(GRAPH_HEALTH_TIME_WINDOW_HOUR_UTC, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/**
 * P0-3 graph-health scheduler: runs `takeSnapshot` once per day at 04:00 UTC.
 *
 * Same-day idempotency is enforced by `takeSnapshot` itself (DELETE-same-date
 * + INSERT in one transaction), so daemon restarts within the same UTC day
 * produce at most one row, always reflecting the latest call.
 */
export function startGraphHealthScheduler(db: Database): Scheduler {
  let running = true;
  let lastTickAt: string | null = null;
  let errorCount = 0;

  async function loop() {
    while (running) {
      const wait = msUntilNextGraphHealthWindow();
      log.debug(
        { waitMs: wait },
        "graph-health scheduler: waiting for 04:00 UTC window"
      );
      await Bun.sleep(wait);
      if (!running) break;
      try {
        const snap = takeGraphHealthSnapshot(db);
        log.info(
          {
            totalFacts: snap.totalFacts,
            orphanFacts: snap.orphanFacts,
            clusterCount: snap.clusterCount,
            staleClusterCount: snap.staleClusterCount,
            density: snap.density,
          },
          "graph-health snapshot taken"
        );
        lastTickAt = new Date().toISOString();
        // Sleep most of the day before re-checking the next window
        await Bun.sleep(GRAPH_HEALTH_INTERVAL_MS - 60_000);
      } catch (err) {
        errorCount++;
        log.error({ err }, "graph-health scheduler error");
        await Bun.sleep(GRAPH_HEALTH_INTERVAL_MS);
      }
    }
  }

  void loop();

  return {
    stop() {
      running = false;
    },
    getHealth() {
      return { name: "graph-health", last_tick_at: lastTickAt, error_count: errorCount, running };
    },
  };
}

// =====================================================================
// Action pointer reconciler scheduler (v4 metacognitive D2-7)
// =====================================================================

export interface ActionReconcileSchedulerOpts {
  /**
   * Test-only override. Production leaves unset so the scheduler runs once
   * daily at 05:00 UTC, after backup and graph-health windows.
   */
  intervalMs?: number;
  expression?: string;
  limit?: number;
  issueLimit?: number;
}

export function msUntilNextActionReconcileWindow(
  now: Date = new Date()
): number {
  const target = new Date(now);
  target.setUTCHours(ACTION_RECONCILE_TIME_WINDOW_HOUR_UTC, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

export function startActionReconcileScheduler(
  db: Database,
  opts: ActionReconcileSchedulerOpts = {}
): Scheduler {
  let running = true;
  let lastTickAt: string | null = null;
  let errorCount = 0;

  async function loop() {
    while (running) {
      const wait = opts.intervalMs ?? msUntilNextActionReconcileWindow();
      log.debug(
        { waitMs: wait },
        "action-reconcile scheduler: waiting for 05:00 UTC window"
      );
      await Bun.sleep(wait);
      if (!running) break;

      try {
        const report = reconcileActionPointers(
          db,
          opts.expression ?? "yesterday",
          {
            limit: opts.limit ?? 5000,
            issueLimit: opts.issueLimit ?? 200,
          }
        );
        log.info(
          {
            expression: report.expression,
            ok: report.ok,
            scanned: report.scanned_actions,
            issues: report.issue_count,
            by_kind: report.by_kind,
            by_source: report.by_source,
          },
          "action reconcile complete"
        );
        lastTickAt = new Date().toISOString();
      } catch (err) {
        errorCount++;
        log.error({ err }, "action reconcile scheduler error");
      }
    }
  }

  void loop();

  return {
    stop() {
      running = false;
    },
    getHealth() {
      return {
        name: "action-reconcile",
        last_tick_at: lastTickAt,
        error_count: errorCount,
        running,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Reasoning scheduler — Phase 7 L5 (r) hybrid (debate 026)
// ---------------------------------------------------------------------------

/**
 * Reasoning scheduler: every 6h, runs one L5 cycle (selectSeeds → runReasoning
 * over budget seeds → write back derived_from edges + verdict-feedback gates).
 *
 * INDEPENDENT timer (Codex argument: coupling to reflect would mean reflect
 * failure stalls reasoning per the swallow-and-continue pattern at
 * scheduler.ts:104-153).
 *
 * Cycle errors are logged and swallowed so one bad cycle does not stall the
 * cadence. Per-seed failures are absorbed inside runCycle (failure_reason
 * persists at the chain row level for inspection via `compost reason list`).
 */
export function startReasoningScheduler(
  db: Database,
  llm: BreakerRegistry | LLMService,
  vectorStore?: VectorStore,
  intervalMs: number = REASONING_INTERVAL_MS
): Scheduler {
  let running = true;
  let lastTickAt: string | null = null;
  let errorCount = 0;

  async function loop() {
    while (running) {
      await Bun.sleep(intervalMs);
      if (!running) break;
      try {
        const stats = await runCycle(db, llm, vectorStore);
        log.info(
          {
            gate: stats.gate_decision,
            attempted: stats.chains_attempted,
            succeeded: stats.chains_succeeded,
            idempotent: stats.chains_skipped_idempotent,
          },
          "reasoning cycle complete"
        );
        lastTickAt = new Date().toISOString();
      } catch (err) {
        errorCount++;
        log.error({ err }, "reasoning cycle error (continuing)");
      }
    }
  }

  void loop();

  return {
    stop() {
      running = false;
    },
    getHealth() {
      return { name: "reasoning", last_tick_at: lastTickAt, error_count: errorCount, running };
    },
  };
}
