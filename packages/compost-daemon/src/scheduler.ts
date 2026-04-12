import type { Database } from "bun:sqlite";
import { drainOne } from "../../compost-core/src/ledger/outbox";
import { reflect } from "../../compost-core/src/cognitive/reflect";
import pino from "pino";

const log = pino({ name: "compost-scheduler" });

const REFLECT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DRAIN_EMPTY_SLEEP_MS = 1000; // 1s backoff when queue is empty

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
