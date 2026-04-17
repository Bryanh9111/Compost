import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { v4 as uuidv4 } from "uuid";
import { DEFAULT_PENDING_DB_PATH } from "./constants";

export type PendingWriteKind = "remember" | "invalidate";

export interface PendingWriteRow {
  id: number;
  pair_id: string | null;
  kind: PendingWriteKind;
  payload: string;
  enqueued_at: number;
  committed_at: number | null;
  attempts: number;
  last_error: string | null;
  expires_at: number | null;
}

export interface EnqueueOptions {
  payload: Record<string, unknown>;
  expiresAt?: number;
  pairId?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pending_writes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('remember','invalidate')),
  payload TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL,
  committed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pending_pending
  ON pending_writes(id) WHERE committed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_pair
  ON pending_writes(pair_id) WHERE pair_id IS NOT NULL;
`;

/**
 * ~/.compost/pending-engram-writes.db — offline queue for Compost→Engram
 * writes that failed or couldn't reach Engram. Supports two-phase
 * invalidate+rewrite via `pair_id` (R1 mitigation) and TTL drift guard
 * via `expires_at` + `pruneExpired` (R2 mitigation).
 *
 * Not thread-safe; assumes single process (compost daemon or CLI).
 */
export class PendingWritesQueue {
  private db: Database;

  constructor(dbPath: string = DEFAULT_PENDING_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  enqueue(kind: PendingWriteKind, opts: EnqueueOptions): number {
    const result = this.db
      .query(
        `INSERT INTO pending_writes
         (pair_id, kind, payload, enqueued_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         RETURNING id`
      )
      .get(
        opts.pairId ?? null,
        kind,
        JSON.stringify(opts.payload),
        Date.now(),
        opts.expiresAt ?? null
      ) as { id: number };
    return result.id;
  }

  /**
   * Enqueue an invalidate+remember pair. On flush, invalidate must commit
   * before remember is attempted. If remember fails, the pair_id lets
   * recovery retry only the remember half — R1 mitigation.
   */
  enqueuePair(
    invalidatePayload: Record<string, unknown>,
    rememberPayload: Record<string, unknown>,
    rememberExpiresAt?: number
  ): { pairId: string; invalidateId: number; rememberId: number } {
    const pairId = uuidv4();
    const invalidateId = this.enqueue("invalidate", {
      payload: invalidatePayload,
      pairId,
    });
    const rememberId = this.enqueue("remember", {
      payload: rememberPayload,
      pairId,
      expiresAt: rememberExpiresAt,
    });
    return { pairId, invalidateId, rememberId };
  }

  markCommitted(id: number): void {
    this.db.run(
      `UPDATE pending_writes SET committed_at = ?, last_error = NULL WHERE id = ?`,
      [Date.now(), id]
    );
  }

  markFailed(id: number, error: string): void {
    this.db.run(
      `UPDATE pending_writes
       SET attempts = attempts + 1, last_error = ?
       WHERE id = ?`,
      [error, id]
    );
  }

  listPending(): PendingWriteRow[] {
    return this.db
      .query(
        `SELECT id, pair_id, kind, payload, enqueued_at, committed_at,
                attempts, last_error, expires_at
         FROM pending_writes
         WHERE committed_at IS NULL
         ORDER BY id`
      )
      .all() as PendingWriteRow[];
  }

  /**
   * TTL drift guard — drop rows whose expires_at would leave less than
   * `graceMs` of validity if flushed now. Debate 020 R2 mitigation: an
   * entry sitting in the queue through a long outage should not land in
   * Engram with near-zero TTL, only to be GC'd immediately.
   * Returns number of rows dropped.
   */
  pruneExpired(graceMs: number): number {
    const now = Date.now();
    const { changes } = this.db.run(
      `DELETE FROM pending_writes
       WHERE committed_at IS NULL
         AND expires_at IS NOT NULL
         AND (expires_at - ?) < ?`,
      [now, graceMs]
    );
    return Number(changes);
  }

  getById(id: number): PendingWriteRow | null {
    const row = this.db
      .query(
        `SELECT id, pair_id, kind, payload, enqueued_at, committed_at,
                attempts, last_error, expires_at
         FROM pending_writes WHERE id = ?`
      )
      .get(id) as PendingWriteRow | null;
    return row ?? null;
  }

  close(): void {
    this.db.close();
  }
}
