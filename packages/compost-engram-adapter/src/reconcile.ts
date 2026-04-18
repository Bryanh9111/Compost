import type { PendingWriteKind, PendingWriteRow, PendingWritesQueue } from "./pending-writes";

/**
 * T1 — `compost doctor --reconcile-engram` report.
 *
 * Pure local scan over ~/.compost/pending-engram-writes.db. Surfaces the
 * R5 blind-write mitigation: cases where an invalidate+remember pair
 * fragmented (one half landed in Engram, the other stuck pending), plus
 * generic queue-health signals (stuck rows, expired-but-not-pruned).
 *
 * No Engram MCP calls — keeping this read-only local keeps failure-mode
 * attribution clean. A future mitigation step (re-enqueue or surface via
 * `compost engram-push`) stays out of this first cut.
 */

export interface PairFragment {
  pair_id: string;
  committed_kinds: PendingWriteKind[];
  pending_kinds: PendingWriteKind[];
}

export interface StuckRow {
  id: number;
  kind: PendingWriteKind;
  age_days: number;
  attempts: number;
  last_error: string | null;
}

export interface ReconcileReport {
  pending_total: number;
  committed_total: number;
  pair_fragments: PairFragment[];
  stuck_rows: StuckRow[];
  expired_but_not_pruned: number;
  /** True when no category flagged anything actionable. */
  ok: boolean;
}

export interface ReconcileOptions {
  /** Rows older than this (in days) are surfaced as stuck. Default 7. */
  stuckThresholdDays?: number;
  /** Injection for deterministic tests. Default `Date.now()`. */
  now?: () => number;
}

const DEFAULT_STUCK_THRESHOLD_DAYS = 7;

export function reconcileEngramQueue(
  queue: PendingWritesQueue,
  opts: ReconcileOptions = {}
): ReconcileReport {
  const now = opts.now ? opts.now() : Date.now();
  const stuckThresholdMs =
    (opts.stuckThresholdDays ?? DEFAULT_STUCK_THRESHOLD_DAYS) * 86_400_000;

  const all = queue.listAll();

  let pending_total = 0;
  let committed_total = 0;
  let expired_but_not_pruned = 0;
  const stuck_rows: StuckRow[] = [];

  const pairBuckets = new Map<
    string,
    { committed_kinds: PendingWriteKind[]; pending_kinds: PendingWriteKind[] }
  >();

  for (const row of all) {
    const isPending = row.committed_at === null;
    if (isPending) {
      pending_total++;
      if (now - row.enqueued_at >= stuckThresholdMs) {
        stuck_rows.push({
          id: row.id,
          kind: row.kind,
          age_days: Math.round(((now - row.enqueued_at) / 86_400_000) * 10) / 10,
          attempts: row.attempts,
          last_error: row.last_error,
        });
      }
      if (row.expires_at !== null && row.expires_at < now) {
        expired_but_not_pruned++;
      }
    } else {
      committed_total++;
    }

    if (row.pair_id !== null) {
      const bucket = pairBuckets.get(row.pair_id) ?? {
        committed_kinds: [],
        pending_kinds: [],
      };
      if (isPending) bucket.pending_kinds.push(row.kind);
      else bucket.committed_kinds.push(row.kind);
      pairBuckets.set(row.pair_id, bucket);
    }
  }

  const pair_fragments: PairFragment[] = [];
  for (const [pair_id, b] of pairBuckets.entries()) {
    // A pair is fragmented iff at least one committed AND one pending. Pure
    // all-pending (stuck pairs) surfaces via stuck_rows; pure all-committed
    // is a healthy outcome.
    if (b.committed_kinds.length > 0 && b.pending_kinds.length > 0) {
      pair_fragments.push({
        pair_id,
        committed_kinds: b.committed_kinds,
        pending_kinds: b.pending_kinds,
      });
    }
  }

  const ok =
    pair_fragments.length === 0 &&
    stuck_rows.length === 0 &&
    expired_but_not_pruned === 0;

  return {
    pending_total,
    committed_total,
    pair_fragments,
    stuck_rows,
    expired_but_not_pruned,
    ok,
  };
}
