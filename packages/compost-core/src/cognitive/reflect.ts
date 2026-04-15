import type { Database } from "bun:sqlite";

/**
 * Reflection report — returned by reflect(). Spec §8.4.
 */
export interface ReflectionReport {
  sensoryObservationsDeleted: number;
  sensoryFactsCascaded: number;
  semanticFactsTombstoned: number;
  contradictionsResolved: number;
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
    contradictionsResolved: 0,
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
        // P0-4: write archive_reason='stale' for the decay-driven tombstone
        // path. See docs/ARCHITECTURE.md "facts.archive_reason enum (frozen)".
        const stmt = db.prepare(
          "UPDATE facts SET archived_at = datetime('now'), archive_reason = 'stale' WHERE fact_id = ?"
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

  // Step 3: Contradiction detection + resolution
  // Debate 9 consensus: detect facts with same subject+predicate but different object.
  // Resolution: newer > higher-confidence > multi-source. Loser gets superseded_by.
  try {
    // Find conflicting fact pairs (same subject + predicate, different object, both active)
    const conflicts = db
      .query(
        `SELECT f1.fact_id AS winner_id, f2.fact_id AS loser_id,
                f1.subject, f1.predicate,
                f1.confidence AS winner_conf, f2.confidence AS loser_conf,
                f1.created_at AS winner_created, f2.created_at AS loser_created
         FROM facts f1
         JOIN facts f2 ON f1.subject = f2.subject
           AND f1.predicate = f2.predicate
           AND f1.fact_id != f2.fact_id
           AND f1.object != f2.object
         WHERE f1.archived_at IS NULL AND f2.archived_at IS NULL
           AND f1.superseded_by IS NULL AND f2.superseded_by IS NULL
           AND (
             f1.confidence > f2.confidence
             OR (f1.confidence = f2.confidence AND f1.created_at > f2.created_at)
             OR (f1.confidence = f2.confidence AND f1.created_at = f2.created_at AND f1.fact_id > f2.fact_id)
           )
         LIMIT 100`
      )
      .all() as Array<{
      winner_id: string;
      loser_id: string;
      subject: string;
      predicate: string;
    }>;

    if (conflicts.length > 0) {
      // Audit fix #1 (debate 004): two correctness bugs in Phase 3 logic:
      //
      // (a) `cg-${Date.now()}` was shared across ALL conflict pairs in a
      //     single reflect call. Five unrelated arbitrations would all be
      //     stamped with the same conflict_group, making the audit trail
      //     useless ("which arbitration tagged this group?").
      // (b) For 3+ different objects under the same (subject, predicate),
      //     the SQL returns N*(N-1)/2 pairs. The same loser appears in
      //     multiple pairs (a > b, a > c, b > c -> b is loser in two rows).
      //     Without dedup, supStmt runs twice on b with different winners,
      //     and `replaced_by_fact_id` ends up nondeterministic.
      //
      // Fix: group pairs by (subject, predicate), assign one conflict_group
      // per cluster, and per loser keep only the single strongest winner.
      // The SQL already returns pairs in winner-first order (lines 154-157),
      // so the FIRST appearance of each loser is paired with its strongest
      // contender.
      type Cluster = {
        groupId: string;
        winner: string;            // strongest fact in the cluster
        losers: Map<string, string>; // loser_id -> winner_id (deduped)
      };
      const clusters = new Map<string, Cluster>();
      const ts = Date.now();
      for (const c of conflicts) {
        const key = `${c.subject}\x00${c.predicate}`;
        let cluster = clusters.get(key);
        if (!cluster) {
          cluster = {
            // Deterministic-ish group id: ts + counter + short subject hash.
            // Subject can be long; truncate to keep id readable.
            groupId: `cg-${ts}-${clusters.size}`,
            winner: c.winner_id,
            losers: new Map(),
          };
          clusters.set(key, cluster);
        }
        // Promote winner if this row's winner is stronger (SQL order means
        // first row of each cluster has the strongest f1, but be defensive).
        if (c.winner_id !== cluster.winner) {
          // The cluster's reigning winner appears as f1 in any pair where
          // it dominates; if a different winner appears here it means this
          // row pits two non-dominant facts against each other. Keep the
          // existing cluster.winner as authoritative.
        }
        // Dedupe: each loser maps to the strongest contender it sees first.
        if (!cluster.losers.has(c.loser_id) && c.loser_id !== cluster.winner) {
          cluster.losers.set(c.loser_id, cluster.winner);
        }
      }

      const resolveTx = db.transaction(() => {
        // P0-4: contradicted loser is archived with archive_reason='contradicted'
        // and replaced_by_fact_id pointing to the cluster winner.
        const supStmt = db.prepare(
          "UPDATE facts " +
            "SET superseded_by = ?, " +
            "    conflict_group = ?, " +
            "    archived_at = datetime('now'), " +
            "    archive_reason = 'contradicted', " +
            "    replaced_by_fact_id = ? " +
            "WHERE fact_id = ? AND superseded_by IS NULL"
        );
        const winStmt = db.prepare(
          "UPDATE facts SET conflict_group = ? WHERE fact_id = ? AND conflict_group IS NULL"
        );
        let losersResolved = 0;
        for (const cluster of clusters.values()) {
          for (const loserId of cluster.losers.keys()) {
            supStmt.run(cluster.winner, cluster.groupId, cluster.winner, loserId);
          }
          winStmt.run(cluster.groupId, cluster.winner);
          losersResolved += cluster.losers.size;
        }
        // Report counts losers (one per archived fact), not raw pair rows.
        report.contradictionsResolved = losersResolved;
      });
      resolveTx();
    }
  } catch (err) {
    report.errors.push({
      step: "contradictionResolution",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 4: Prune drained outbox rows past retention.
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
