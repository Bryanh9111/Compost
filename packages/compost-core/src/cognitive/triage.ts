import type { Database } from "bun:sqlite";

/**
 * Triage signal kinds — must mirror the CHECK constraint in migration 0010
 * (original 5) + 0012 (correction_candidate). Adding a new kind requires
 * updating both this union and the SQL CHECK clause.
 *
 * Debate 005 fix #3: `correction_candidate` was added to the SQL CHECK in
 * migration 0012 but the TS union lagged behind, causing a silent drop
 * in the `byKind` histogram and type-unsafe writes from correction-detector.
 */
export type SignalKind =
  | "stale_fact"
  | "unresolved_contradiction"
  | "stuck_outbox"
  | "orphan_delta"
  | "stale_wiki"
  | "correction_candidate";

export type SignalSeverity = "info" | "warn" | "error";

export interface HealthSignal {
  id: number;
  kind: SignalKind;
  severity: SignalSeverity;
  message: string;
  target_ref: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface TriageReport {
  signals: HealthSignal[];
  byKind: Record<SignalKind, number>;
  unresolvedTotal: number;
  computedAt: string;
}

/**
 * Default thresholds -- Week 4 contract (debates/011-week4-plan/contract.md):
 * every scanner hard-caps at `maxPerKind` rows so a single triage pass cannot
 * write more than 6 * maxPerKind rows. Values are tunable via TriageOptions
 * but the cap itself is not — "surface only" is cheap by design.
 */
export interface TriageOptions {
  staleFactDays?: number;        // default 90
  contradictionAgeDays?: number; // default 7
  stuckOutboxHours?: number;     // default 24
  orphanDeltaThreshold?: number; // default 5
  staleWikiDays?: number;        // default 30
  maxPerKind?: number;           // default 100 (contract cap)
}

const DEFAULT_MAX_PER_KIND = 100;

/**
 * Upsert-style signal insert: skips if an **unresolved** signal with the same
 * (kind, target_ref) already exists. Idempotent across repeated triage runs
 * so a long-running stuck_outbox row does not spawn one signal per scan.
 *
 * Returns `true` if a new row was inserted, `false` if an existing unresolved
 * signal covered the target.
 */
function upsertSignal(
  db: Database,
  kind: SignalKind,
  severity: SignalSeverity,
  message: string,
  targetRef: string
): boolean {
  const existing = db
    .query(
      "SELECT id FROM health_signals " +
        "WHERE kind = ? AND target_ref = ? AND resolved_at IS NULL"
    )
    .get(kind, targetRef) as { id: number } | null;
  if (existing) return false;

  db.run(
    "INSERT INTO health_signals (kind, severity, message, target_ref) " +
      "VALUES (?, ?, ?, ?)",
    [kind, severity, message, targetRef]
  );
  return true;
}

/**
 * `stuck_outbox`: outbox rows still un-drained past the hour threshold.
 * Quarantined rows are explicitly excluded — operator already knows.
 *
 * Contract (surface-only): signals are read-only; remediation is `compost
 * doctor` or manual outbox surgery. Never touches the outbox itself.
 */
export function scanStuckOutbox(
  db: Database,
  hours: number,
  maxPerKind: number
): number {
  const rows = db
    .query(
      `SELECT seq, adapter, source_id, appended_at
       FROM observe_outbox
       WHERE drained_at IS NULL
         AND drain_quarantined_at IS NULL
         AND appended_at < datetime('now', '-' || ? || ' hours')
       ORDER BY appended_at ASC
       LIMIT ?`
    )
    .all(hours, maxPerKind) as Array<{
    seq: number;
    adapter: string;
    source_id: string;
    appended_at: string;
  }>;

  let inserted = 0;
  for (const row of rows) {
    const targetRef = `outbox:${row.seq}`;
    const msg = `outbox row seq=${row.seq} (adapter=${row.adapter}) has been un-drained since ${row.appended_at}`;
    if (upsertSignal(db, "stuck_outbox", "warn", msg, targetRef)) {
      inserted++;
    }
  }
  return inserted;
}

/**
 * `stale_wiki`: pages whose last synthesis failed (`stale_at` set by wiki.ts
 * P0-6 fallback) OR whose last synthesis is older than `days`. Both paths
 * emit a single signal per page (upsert dedupes).
 */
export function scanStaleWiki(
  db: Database,
  days: number,
  maxPerKind: number
): number {
  const rows = db
    .query(
      `SELECT path, title, stale_at, last_synthesis_at
       FROM wiki_pages
       WHERE stale_at IS NOT NULL
          OR last_synthesis_at < datetime('now', '-' || ? || ' days')
       ORDER BY COALESCE(stale_at, last_synthesis_at) ASC
       LIMIT ?`
    )
    .all(days, maxPerKind) as Array<{
    path: string;
    title: string;
    stale_at: string | null;
    last_synthesis_at: string;
  }>;

  let inserted = 0;
  for (const row of rows) {
    const targetRef = `wiki:${row.path}`;
    const reason = row.stale_at
      ? `last rebuild failed at ${row.stale_at}`
      : `last synthesis at ${row.last_synthesis_at} is older than ${days}d`;
    const msg = `wiki page "${row.title}" is stale: ${reason}`;
    if (upsertSignal(db, "stale_wiki", "info", msg, targetRef)) {
      inserted++;
    }
  }
  return inserted;
}

/**
 * Read-only triage: scans DB for the 6 signal kinds (debates/011-week4-plan/
 * contract.md), inserts new health_signals rows for findings, returns
 * aggregated report.
 *
 * Hard rule: NEVER auto-executes any remediation. Surface only.
 *
 * Day 2 scope: stuck_outbox + stale_wiki scanners land. Remaining 4
 * (stale_fact / unresolved_contradiction / orphan_delta / correction_candidate)
 * are scheduled for Day 3 alongside the CLI.
 */
export function triage(db: Database, opts: TriageOptions = {}): TriageReport {
  const stuckOutboxHours = opts.stuckOutboxHours ?? 24;
  const staleWikiDays = opts.staleWikiDays ?? 30;
  const maxPerKind = opts.maxPerKind ?? DEFAULT_MAX_PER_KIND;

  scanStuckOutbox(db, stuckOutboxHours, maxPerKind);
  scanStaleWiki(db, staleWikiDays, maxPerKind);
  // Day 3: scanStaleFact, scanUnresolvedContradiction, scanOrphanDelta,
  // scanCorrectionCandidate land here.

  // Aggregate: read ALL unresolved signals (including ones written by
  // correction-detector outside triage()) so the report reflects the full
  // surface, not just what this run inserted.
  const signals = db
    .query(
      `SELECT id, kind, severity, message, target_ref, created_at,
              resolved_at, resolved_by
       FROM health_signals
       WHERE resolved_at IS NULL
       ORDER BY created_at DESC`
    )
    .all() as HealthSignal[];

  const byKind: Record<SignalKind, number> = {
    stale_fact: 0,
    unresolved_contradiction: 0,
    stuck_outbox: 0,
    orphan_delta: 0,
    stale_wiki: 0,
    correction_candidate: 0,
  };
  for (const s of signals) {
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  }

  return {
    signals,
    byKind,
    unresolvedTotal: signals.length,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Mark a signal resolved (user or agent action acknowledged it).
 * Idempotent: re-resolving a resolved signal is a no-op (keeps first
 * resolved_at / resolved_by).
 */
export function resolveSignal(
  db: Database,
  signalId: number,
  resolvedBy: "user" | "agent" | "auto-cleared"
): void {
  db.run(
    "UPDATE health_signals " +
      "SET resolved_at = datetime('now'), resolved_by = ? " +
      "WHERE id = ? AND resolved_at IS NULL",
    [resolvedBy, signalId]
  );
}
