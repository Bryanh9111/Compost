import type { Database } from "bun:sqlite";
import { drainOne } from "../../compost-core/src/ledger/outbox";
import { reflect } from "../../compost-core/src/cognitive/reflect";
import { ingestUrl } from "../../compost-core/src/pipeline/web-ingest";
import { claimOne, complete, fail } from "../../compost-core/src/queue/lease";
import { getActivePolicy, validatePolicyExists } from "../../compost-core/src/policies/registry";
import { v7 as uuidv7 } from "uuid";
import { existsSync } from "fs";
import { resolve } from "path";
import type { EmbeddingService } from "../../compost-core/src/embedding/types";
import type { VectorStore } from "../../compost-core/src/storage/lancedb";
import pino from "pino";

const log = pino({ name: "compost-scheduler" });

const REFLECT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DRAIN_EMPTY_SLEEP_MS = 1000; // 1s backoff when queue is empty
const INGEST_EMPTY_SLEEP_MS = 2000; // 2s backoff when ingest queue is empty
const FRESHNESS_CHECK_INTERVAL_MS = 60_000; // 60s between freshness loop ticks

export interface Scheduler {
  stop(): void;
}

/**
 * Drain loop: processes one outbox row per iteration.
 * Backs off 1s when the queue is empty. Runs until stopped.
 */
export function startDrainLoop(db: Database): Scheduler {
  let running = true;

  async function loop() {
    while (running) {
      try {
        const result = drainOne(db);
        if (!result) {
          // queue empty — sleep before next poll
          await Bun.sleep(DRAIN_EMPTY_SLEEP_MS);
        } else {
          log.debug({ seq: result.seq, observe_id: result.observe_id }, "drained");
        }
      } catch (err) {
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
  };
}

/**
 * Reflect scheduler: runs reflect(db) every 6 hours.
 */
export function startReflectScheduler(db: Database): Scheduler {
  let running = true;

  async function loop() {
    while (running) {
      await Bun.sleep(REFLECT_INTERVAL_MS);
      if (!running) break;
      try {
        const report = reflect(db);
        log.info({ report }, "reflect complete");
      } catch (err) {
        log.error({ err }, "reflect error");
      }
    }
  }

  void loop();

  return {
    stop() {
      running = false;
    },
  };
}

/**
 * Freshness loop: checks web_fetch_state for due sources and re-ingests.
 * Polls every 60s. Uses conditional requests (ETag/Last-Modified).
 */
export function startFreshnessLoop(db: Database, dataDir: string): Scheduler {
  let running = true;

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

        if (dueSources.length === 0) continue;

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
            log.error({ err, url: src.uri }, "freshness: source error");
          }
        }
      } catch (err) {
        log.error({ err }, "freshness loop error");
      }
    }
  }

  void loop();

  return {
    stop() {
      running = false;
    },
  };
}

export interface IngestWorkerOpts {
  embeddingService: EmbeddingService;
  vectorStore: VectorStore;
  dataDir: string;
}

interface ExtractionOutput {
  observe_id: string;
  extractor_version: string;
  transform_policy: string;
  chunks: Array<{
    chunk_id: string;
    text: string;
    metadata?: { char_start?: number; char_end?: number; [k: string]: unknown };
  }>;
  facts: Array<{
    subject: string;
    predicate: string;
    object: string;
    confidence?: number;
    importance?: number;
    source_chunk_ids?: string[];
  }>;
  normalized_content: string;
  content_hash_raw: string;
  content_hash_normalized: string;
  warnings: string[];
}

function computeHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

/**
 * Ingest worker: claims from ingest_queue, runs Python extraction,
 * writes facts/chunks to SQLite, generates embeddings + writes to LanceDB.
 * Mirrors the logic in ingest.ts:138-309 but runs as a daemon loop.
 */
export function startIngestWorker(db: Database, opts: IngestWorkerOpts): Scheduler {
  let running = true;

  async function processOne(): Promise<boolean> {
    const workerId = `daemon:${process.pid}`;
    const claimed = claimOne(db, workerId);
    if (!claimed) return false;

    const derivationId = uuidv7();
    const policy = getActivePolicy();

    const obs = db
      .query(
        `SELECT observe_id, source_uri, mime_type, raw_bytes, metadata
         FROM observations WHERE observe_id = ?`
      )
      .get(claimed.observe_id) as {
      observe_id: string;
      source_uri: string;
      mime_type: string;
      raw_bytes: Buffer | null;
      metadata: string | null;
    } | null;

    if (!obs) {
      fail(db, claimed.id, claimed.lease_token, "observation not found");
      return true;
    }

    const content = obs.raw_bytes ? obs.raw_bytes.toString("utf-8") : "";

    db.run(
      `INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status)
       VALUES (?, ?, 'L2', ?, 'running')`,
      [derivationId, obs.observe_id, policy.id]
    );

    try {
      const extractionInput = JSON.stringify({
        observe_id: obs.observe_id,
        source_uri: obs.source_uri,
        mime_type: obs.mime_type,
        content_ref: "inline",
        content,
        transform_policy: policy.id,
      });

      const ingestPkgDir = resolve(import.meta.dir, "../..", "compost-ingest");
      const venvPython = resolve(ingestPkgDir, ".venv/bin/python");

      let cmd: string[];
      if (existsSync(venvPython)) {
        cmd = [venvPython, "-m", "compost_ingest", "extract"];
      } else {
        cmd = ["uv", "run", "--project", ingestPkgDir, "python", "-m", "compost_ingest", "extract"];
      }

      const proc = Bun.spawn(cmd, {
        stdin: new Blob([extractionInput]),
        stdout: "pipe",
        stderr: "pipe",
        cwd: ingestPkgDir,
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        throw new Error(`extraction failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }

      let output: ExtractionOutput;
      try {
        output = JSON.parse(stdout);
      } catch {
        throw new Error(`extraction output is not valid JSON: ${stdout.slice(0, 200)}`);
      }

      // Write facts + chunks to SQLite
      const insertFact = db.prepare(
        `INSERT OR IGNORE INTO facts (fact_id, subject, predicate, object, confidence, importance, observe_id, last_reinforced_at_unix_sec, half_life_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertChunk = db.prepare(
        `INSERT OR IGNORE INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const nowUnixSec = Math.floor(Date.now() / 1000);
      const defaultHalfLife = 2592000;

      db.exec("BEGIN IMMEDIATE");
      try {
        for (const fact of output.facts) {
          insertFact.run(
            uuidv7(), fact.subject, fact.predicate, fact.object,
            fact.confidence ?? 0.8, fact.importance ?? 0.5,
            obs.observe_id, nowUnixSec, defaultHalfLife
          );
        }
        for (let i = 0; i < output.chunks.length; i++) {
          const chunk = output.chunks[i];
          insertChunk.run(
            chunk.chunk_id, obs.observe_id, derivationId, i,
            chunk.text, computeHash(chunk.text),
            chunk.metadata?.char_start ?? 0,
            chunk.metadata?.char_end ?? chunk.text.length,
            policy.id
          );
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }

      // Generate embeddings + write to LanceDB
      let embeddedCount = 0;
      if (output.chunks.length > 0) {
        const chunkTexts = output.chunks.map((c) => c.text);
        const vectors = await opts.embeddingService.embed(chunkTexts);

        const chunkToFactId = new Map<string, string>();
        const factRows = db
          .query("SELECT fact_id FROM facts WHERE observe_id = ? ORDER BY created_at")
          .all(obs.observe_id) as { fact_id: string }[];

        for (let fi = 0; fi < output.facts.length; fi++) {
          const fact = output.facts[fi];
          const factId = factRows[fi]?.fact_id;
          if (factId && fact.source_chunk_ids) {
            for (const cid of fact.source_chunk_ids) {
              if (!chunkToFactId.has(cid)) {
                chunkToFactId.set(cid, factId);
              }
            }
          }
        }

        const chunkVectors = output.chunks.map((chunk, i) => ({
          chunk_id: chunk.chunk_id,
          fact_id: chunkToFactId.get(chunk.chunk_id)
            ?? (factRows.length > 0 ? factRows[0].fact_id : `orphan:${obs.observe_id}:${i}`),
          observe_id: obs.observe_id,
          vector: vectors[i],
        }));

        await opts.vectorStore.add(chunkVectors);

        const updateEmbedded = db.prepare(
          "UPDATE chunks SET embedded_at = datetime('now') WHERE chunk_id = ?"
        );
        for (const cv of chunkVectors) {
          updateEmbedded.run(cv.chunk_id);
        }
        embeddedCount = chunkVectors.length;
      }

      db.run(
        `UPDATE derivation_run
         SET status = 'succeeded', finished_at = datetime('now'), artifact_ref = ?
         WHERE derivation_id = ?`,
        [JSON.stringify({ chunks: output.chunks.length, facts: output.facts.length, embedded: embeddedCount }), derivationId]
      );

      complete(db, claimed.id, claimed.lease_token);
      log.info(
        { observe_id: obs.observe_id, facts: output.facts.length, chunks: output.chunks.length, embedded: embeddedCount },
        "ingest worker: processed"
      );
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      db.run(
        `UPDATE derivation_run SET status = 'failed', finished_at = datetime('now'), error = ? WHERE derivation_id = ?`,
        [errorMsg, derivationId]
      );
      fail(db, claimed.id, claimed.lease_token, errorMsg);
      log.error({ err, observe_id: obs.observe_id }, "ingest worker: failed");
      return true;
    }
  }

  async function loop() {
    while (running) {
      try {
        const processed = await processOne();
        if (!processed) {
          await Bun.sleep(INGEST_EMPTY_SLEEP_MS);
        }
      } catch (err) {
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

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_TIME_WINDOW_HOUR_UTC = 3;

export interface BackupSchedulerOpts {
  ledgerPath: string;
  backupDir: string;
  retentionCount?: number;
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
export function startBackupScheduler(
  db: Database,
  opts: BackupSchedulerOpts
): Scheduler {
  let running = true;
  const retention = opts.retentionCount ?? DEFAULT_BACKUP_RETENTION;

  function msUntilNextWindow(): number {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(BACKUP_TIME_WINDOW_HOUR_UTC, 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    return target.getTime() - now.getTime();
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
        const result = backup(db, opts.backupDir);
        const pruned = pruneOldBackups(opts.backupDir, retention);
        log.info(
          {
            path: result.path,
            sizeBytes: result.sizeBytes,
            durationMs: result.durationMs,
            prunedCount: pruned,
            retention,
          },
          "backup complete"
        );
        // Sleep most of the day to leave the 03:00 window before next check
        await Bun.sleep(BACKUP_INTERVAL_MS - 60_000);
      } catch (err) {
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
  };
}
