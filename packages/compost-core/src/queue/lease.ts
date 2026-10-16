import type { Database } from "bun:sqlite";
import { v7 as uuidv7 } from "uuid";

export interface ClaimResult {
  id: number;
  observe_id: string;
  source_kind: string;
  attempts: number;
  lease_token: string;
}

export interface ClaimOptions {
  /** Only claim the queue row for this observation (one-shot CLI ingest). */
  observeId?: string;
  /** Rows whose attempts reach this count are quarantined. Spec §4 default. */
  maxRetries?: number;
}

export interface FailOptions {
  maxRetries?: number;
}

/** Spec §4 extraction default; policies carry their own value in registry.ts. */
export const DEFAULT_MAX_RETRIES = 3;
const BACKOFF_BASE_SEC = 60;
const BACKOFF_CAP_SEC = 900;

const CLAIMABLE = `completed_at IS NULL
           AND quarantined_at IS NULL
           AND (lease_expires_at IS NULL OR lease_expires_at < datetime('now'))`;

/**
 * Claim one pending queue row. Spec §10.2.
 *
 * - Skips rows with active (non-expired) leases, completed rows, quarantined
 *   rows and rows whose backoff (`next_attempt_at`) has not elapsed
 * - Quarantines rows that exhausted their attempts without a terminal state
 *   (a worker that died never calls fail), so one predicate owns the rule
 * - Increments attempts on each claim
 * - Sets lease_owner, lease_token, lease_expires_at (+60s)
 *
 * Returns null if no claimable rows exist.
 */
export function claimOne(
  db: Database,
  workerId: string,
  opts: ClaimOptions = {}
): ClaimResult | null {
  const leaseToken = uuidv7();
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const observeId = opts.observeId ?? null;

  const tx = db.transaction(() => {
    db.run(
      `UPDATE ingest_queue
       SET quarantined_at = datetime('now'),
           last_error = coalesce(last_error, 'attempts exhausted'),
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL
       WHERE ${CLAIMABLE}
         AND attempts >= ?`,
      [maxRetries]
    );

    const candidate = db
      .query(
        `SELECT id FROM ingest_queue
         WHERE ${CLAIMABLE}
           AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
           AND (? IS NULL OR observe_id = ?)
         ORDER BY priority ASC, enqueued_at ASC
         LIMIT 1`
      )
      .get(observeId, observeId) as { id: number } | null;

    if (!candidate) return null;

    db.run(
      `UPDATE ingest_queue
       SET lease_owner = ?,
           lease_token = ?,
           lease_expires_at = datetime('now', '+60 seconds'),
           attempts = attempts + 1
       WHERE id = ?`,
      [workerId, leaseToken, candidate.id]
    );

    return db
      .query(
        `SELECT id, observe_id, source_kind, attempts
         FROM ingest_queue WHERE id = ?`
      )
      .get(candidate.id) as {
      id: number;
      observe_id: string;
      source_kind: string;
      attempts: number;
    };
  });

  const row = tx.immediate();
  if (!row) return null;

  return { ...row, lease_token: leaseToken };
}

/**
 * Extend the lease by another 60 seconds. Spec §10.2 heartbeat.
 * Returns false if the lease was stolen (lease_token mismatch).
 */
export function heartbeat(
  db: Database,
  id: number,
  leaseToken: string
): boolean {
  const result = db.run(
    `UPDATE ingest_queue
     SET lease_expires_at = datetime('now', '+60 seconds')
     WHERE id = ? AND lease_token = ?`,
    [id, leaseToken]
  );
  return result.changes > 0;
}

/**
 * Mark a queue row as successfully completed. Clears lease fields.
 * Spec §10.2 completion.
 */
export function complete(
  db: Database,
  id: number,
  leaseToken: string
): boolean {
  const result = db.run(
    `UPDATE ingest_queue
     SET completed_at = datetime('now'),
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL
     WHERE id = ? AND lease_token = ?`,
    [id, leaseToken]
  );
  return result.changes > 0;
}

/**
 * Record a processing failure. Clears the lease and schedules the next
 * attempt with exponential backoff (60s, 120s, ... capped at 15 minutes);
 * once attempts reach maxRetries the row is quarantined instead. Does NOT
 * set completed_at. Spec §10.2 failure.
 */
export function fail(
  db: Database,
  id: number,
  leaseToken: string,
  error: string,
  opts: FailOptions = {}
): boolean {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const result = db.run(
    `UPDATE ingest_queue
     SET last_error = ?,
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         next_attempt_at = CASE
           WHEN attempts >= ? THEN NULL
           ELSE datetime('now', '+' || min(? * (1 << max(attempts - 1, 0)), ?) || ' seconds')
         END,
         quarantined_at = CASE
           WHEN attempts >= ? THEN datetime('now')
           ELSE quarantined_at
         END
     WHERE id = ? AND lease_token = ?`,
    [error, maxRetries, BACKOFF_BASE_SEC, BACKOFF_CAP_SEC, maxRetries, id, leaseToken]
  );
  return result.changes > 0;
}

/**
 * Operator reset behind `compost doctor --ingest-retry`: clears quarantine,
 * backoff and the attempt counter so the row gets a fresh set of retries.
 * Returns the number of rows requeued.
 */
export function requeueQuarantined(db: Database, id?: number): number {
  const result = db.run(
    `UPDATE ingest_queue
     SET quarantined_at = NULL,
         next_attempt_at = NULL,
         attempts = 0,
         last_error = NULL
     WHERE quarantined_at IS NOT NULL
       AND completed_at IS NULL
       AND (? IS NULL OR id = ?)`,
    [id ?? null, id ?? null]
  );
  return result.changes;
}

export interface IngestQueueCounts {
  pending: number;
  quarantined: number;
}

/** Queue counters for daemon status and doctor. Pending excludes quarantine. */
export function ingestQueueCounts(db: Database): IngestQueueCounts {
  const row = db
    .query(
      `SELECT
         SUM(CASE WHEN completed_at IS NULL AND quarantined_at IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN completed_at IS NULL AND quarantined_at IS NOT NULL THEN 1 ELSE 0 END) AS quarantined
       FROM ingest_queue`
    )
    .get() as { pending: number | null; quarantined: number | null };
  return { pending: Number(row.pending ?? 0), quarantined: Number(row.quarantined ?? 0) };
}
