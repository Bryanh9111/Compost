import type { Database } from "bun:sqlite";
import { v7 as uuidv7 } from "uuid";

export interface ClaimResult {
  id: number;
  observe_id: string;
  source_kind: string;
  attempts: number;
  lease_token: string;
}

/**
 * Claim one pending queue row. Spec §10.2.
 *
 * - Skips rows with active (non-expired) leases
 * - Skips completed rows
 * - Increments attempts on each claim
 * - Sets lease_owner, lease_token, lease_expires_at (+60s)
 *
 * Returns null if no claimable rows exist.
 */
export function claimOne(
  db: Database,
  workerId: string
): ClaimResult | null {
  const leaseToken = uuidv7();

  // Bun's SQLite doesn't support RETURNING on UPDATE well in all versions,
  // so we do a two-step: find + update in a transaction.
  const tx = db.transaction(() => {
    // Find the next claimable row
    const candidate = db
      .query(
        `SELECT id FROM ingest_queue
         WHERE completed_at IS NULL
           AND (lease_expires_at IS NULL OR lease_expires_at < datetime('now'))
         ORDER BY priority ASC, enqueued_at ASC
         LIMIT 1`
      )
      .get() as { id: number } | null;

    if (!candidate) return null;

    // Claim it
    db.run(
      `UPDATE ingest_queue
       SET lease_owner = ?,
           lease_token = ?,
           lease_expires_at = datetime('now', '+60 seconds'),
           attempts = attempts + 1
       WHERE id = ?`,
      [workerId, leaseToken, candidate.id]
    );

    // Read back the claimed row
    const row = db
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

    return row;
  });

  const row = tx();
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
 * Record a processing failure. Clears lease so another worker can retry.
 * Does NOT set completed_at. Spec §10.2 failure.
 */
export function fail(
  db: Database,
  id: number,
  leaseToken: string,
  error: string
): boolean {
  const result = db.run(
    `UPDATE ingest_queue
     SET last_error = ?,
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL
     WHERE id = ? AND lease_token = ?`,
    [error, id, leaseToken]
  );
  return result.changes > 0;
}
