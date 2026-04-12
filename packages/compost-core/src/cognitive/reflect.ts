import type { Database } from "bun:sqlite";

/**
 * Reflection report — returned by reflect(). Spec §8.4.
 */
export interface ReflectionReport {
  sensoryObservationsDeleted: number;
  sensoryFactsCascaded: number;
  semanticFactsTombstoned: number;
  outboxRowsPruned: number;
  skippedDueToFkViolation: number;
  reflectionDurationMs: number;
  errors: Array<{ step: string; message: string }>;
}

const SENSORY_TTL_DAYS = 7;
const OUTBOX_RETENTION_DAYS = 7;
const DECAY_THRESHOLD = 0.001;

/**
 * Active forgetting and consolidation. Spec §8.4 Phase 0 scope:
 * 1. Sensory hard-GC (FK CASCADE handles dependents)
 * 2. Semantic soft-tombstone (archived_at for decayed facts)
 * 3. Outbox prune (drained rows past retention, never quarantined)
 *
 * File lock omitted from this function — caller is responsible
 * for acquiring reflect.lock via proper-lockfile before calling.
 */
export function reflect(db: Database): ReflectionReport {
  const startedAt = Date.now();
  const report: ReflectionReport = {
    sensoryObservationsDeleted: 0,
    sensoryFactsCascaded: 0,
    semanticFactsTombstoned: 0,
    outboxRowsPruned: 0,
    skippedDueToFkViolation: 0,
    reflectionDurationMs: 0,
    errors: [],
  };

  // Step 1: Sensory hard-GC
  try {
    const gcTx = db.transaction(() => {
      // Count observations and facts BEFORE the delete.
      // bun:sqlite's changes includes CASCADE-deleted rows, so we count explicitly.
      const obsCount = db
        .query(
          `SELECT COUNT(*) AS c FROM observations
           WHERE captured_at < datetime('now', '-${SENSORY_TTL_DAYS} days')
             AND source_id IN (SELECT id FROM source WHERE kind = 'sensory')`
        )
        .get() as { c: number };

      const factsCount = db
        .query(
          `SELECT COUNT(*) AS c FROM facts f
           JOIN observations o ON o.observe_id = f.observe_id
           WHERE o.captured_at < datetime('now', '-${SENSORY_TTL_DAYS} days')
             AND o.source_id IN (SELECT id FROM source WHERE kind = 'sensory')`
        )
        .get() as { c: number };

      report.sensoryFactsCascaded = factsCount.c;

      // Delete old sensory observations - FK CASCADE drops facts, ingest_queue,
      // captured_item, derivation_run, wiki_page_observe
      db.run(
        `DELETE FROM observations
         WHERE captured_at < datetime('now', '-${SENSORY_TTL_DAYS} days')
           AND source_id IN (SELECT id FROM source WHERE kind = 'sensory')`
      );

      report.sensoryObservationsDeleted = obsCount.c;
    });
    gcTx();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report.errors.push({ step: "sensoryGC", message: msg });
    if (msg.includes("FOREIGN KEY")) report.skippedDueToFkViolation++;
  }

  // Step 2: Semantic soft-tombstone
  // Decay formula: importance * 0.5^((now - last_reinforced) / half_life) < threshold
  // SQLite lacks POW, so we select candidates in TS and batch-update.
  try {
    const candidates = db
      .query(
        `SELECT fact_id, importance, last_reinforced_at_unix_sec, half_life_seconds
         FROM facts
         WHERE archived_at IS NULL
           AND importance_pinned = FALSE`
      )
      .all() as Array<{
      fact_id: string;
      importance: number;
      last_reinforced_at_unix_sec: number;
      half_life_seconds: number;
    }>;

    const now = Math.floor(Date.now() / 1000);
    const toTombstone: string[] = [];

    for (const fact of candidates) {
      const elapsed = now - fact.last_reinforced_at_unix_sec;
      const decayedScore =
        fact.importance *
        Math.pow(0.5, elapsed / fact.half_life_seconds);
      if (decayedScore < DECAY_THRESHOLD) {
        toTombstone.push(fact.fact_id);
      }
    }

    if (toTombstone.length > 0) {
      const tombstoneTx = db.transaction(() => {
        const stmt = db.prepare(
          "UPDATE facts SET archived_at = datetime('now') WHERE fact_id = ?"
        );
        for (const factId of toTombstone) {
          stmt.run(factId);
        }
      });
      tombstoneTx();
      report.semanticFactsTombstoned = toTombstone.length;
    }
  } catch (err) {
    report.errors.push({
      step: "semanticTombstone",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 3: Prune drained outbox rows past retention.
  // Quarantined rows are NEVER pruned — operator must resolve via compost doctor.
  try {
    const pruned = db.run(
      `DELETE FROM observe_outbox
       WHERE drained_at IS NOT NULL
         AND drained_at < datetime('now', '-${OUTBOX_RETENTION_DAYS} days')
         AND drain_quarantined_at IS NULL`
    );
    report.outboxRowsPruned = pruned.changes;
  } catch (err) {
    report.errors.push({
      step: "pruneOutbox",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  report.reflectionDurationMs = Date.now() - startedAt;
  return report;
}
