/**
 * Backfill origin_hash + method for observations written before Migration 0014.
 *
 * Recomputes from fields already present on every row (adapter, source_uri,
 * idempotency_key) — see ledger/origin.ts for the hash definition. Safe to
 * re-run: the WHERE clause only touches rows still missing origin_hash.
 *
 * Usage:
 *   import { backfillOriginHash } from "compost-core/pipeline/backfill-origin";
 *   const res = backfillOriginHash(db);
 *   const dryRun = backfillOriginHash(db, { dryRun: true });
 */
import type { Database } from "bun:sqlite";
import { computeOriginHash } from "../ledger/origin";

export interface BackfillOptions {
  dryRun?: boolean;
  batchSize?: number;
}

export interface BackfillResult {
  scanned: number;
  updated: number;
  dryRun: boolean;
}

interface ObsRow {
  observe_id: string;
  adapter: string;
  source_uri: string;
  idempotency_key: string;
}

export function backfillOriginHash(
  db: Database,
  opts: BackfillOptions = {}
): BackfillResult {
  const dryRun = opts.dryRun ?? false;
  const batchSize = opts.batchSize ?? 500;

  let scanned = 0;
  let updated = 0;

  const selectStmt = db.prepare(
    `SELECT observe_id, adapter, source_uri, idempotency_key
     FROM observations
     WHERE origin_hash IS NULL
     ORDER BY observe_id
     LIMIT ?`
  );
  const updateStmt = db.prepare(
    `UPDATE observations
     SET origin_hash = ?, method = COALESCE(method, ?)
     WHERE observe_id = ? AND origin_hash IS NULL`
  );

  while (true) {
    const rows = selectStmt.all(batchSize) as ObsRow[];
    if (rows.length === 0) break;
    scanned += rows.length;

    if (dryRun) {
      // Break here so dry-run reports a single batch of scanned rows without
      // looping forever (the WHERE clause is unchanged in dry-run mode).
      break;
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const hash = computeOriginHash(
          row.adapter,
          row.source_uri,
          row.idempotency_key
        );
        const info = updateStmt.run(hash, row.adapter, row.observe_id);
        if (info.changes > 0) updated += 1;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    if (rows.length < batchSize) break;
  }

  if (dryRun) {
    // Count the true remaining set for an accurate pending-row number.
    const row = db
      .query(
        "SELECT COUNT(*) AS n FROM observations WHERE origin_hash IS NULL"
      )
      .get() as { n: number };
    return { scanned: row.n, updated: 0, dryRun: true };
  }

  return { scanned, updated, dryRun };
}
