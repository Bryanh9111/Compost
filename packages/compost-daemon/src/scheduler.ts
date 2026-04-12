import type { Database } from "bun:sqlite";
import { drainOne } from "../../compost-core/src/ledger/outbox";
import { reflect } from "../../compost-core/src/cognitive/reflect";
import { ingestUrl } from "../../compost-core/src/pipeline/web-ingest";
import pino from "pino";

const log = pino({ name: "compost-scheduler" });

const REFLECT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DRAIN_EMPTY_SLEEP_MS = 1000; // 1s backoff when queue is empty
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
