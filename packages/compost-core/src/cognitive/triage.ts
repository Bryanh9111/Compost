import type { Database } from "bun:sqlite";
import {
  GENERIC_CONTRADICTION_SUBJECTS,
  SINGLE_VALUE_CONTRADICTION_PREDICATES,
  isContradictionCandidate,
} from "./contradiction-policy";

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
  /** Access-log window (days) used by `scanOrphanDelta`. Default 30. */
  orphanAccessDays?: number;
  /**
   * Reserved for the Week 5+ delta-vs-baseline semantic (vs current
   * snapshot). See `debates/013-week4-audit/synthesis.md`.
   */
  orphanDeltaThreshold?: number; // default 5 (unused today)
  staleWikiDays?: number;        // default 30
  maxPerKind?: number;           // default 100 (contract cap)
}

const DEFAULT_MAX_PER_KIND = 100;

export function isUnresolvedContradictionCandidate(
  subject: string,
  predicate: string
): boolean {
  return isContradictionCandidate(subject, predicate);
}

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
 * `stale_fact`: active, unpinned facts that have not been reinforced within
 * `days`. `last_reinforced_at_unix_sec` is set on every reinforce hit
 * (query + feedback paths); facts that stop being reinforced slide toward
 * decay tombstone via reflect step 2. Surface them here BEFORE reflect
 * archives them so the user can pin if needed.
 */
export function scanStaleFact(
  db: Database,
  days: number,
  maxPerKind: number
): number {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86_400;
  const rows = db
    .query(
      `SELECT fact_id, subject, predicate, last_reinforced_at_unix_sec
       FROM facts
       WHERE archived_at IS NULL
         AND importance_pinned = FALSE
         AND last_reinforced_at_unix_sec < ?
       ORDER BY last_reinforced_at_unix_sec ASC
       LIMIT ?`
    )
    .all(cutoff, maxPerKind) as Array<{
    fact_id: string;
    subject: string;
    predicate: string;
    last_reinforced_at_unix_sec: number;
  }>;

  let inserted = 0;
  for (const row of rows) {
    const targetRef = `fact:${row.fact_id}`;
    const msg = `fact (${row.subject}, ${row.predicate}) has not been reinforced since unix_sec=${row.last_reinforced_at_unix_sec} (> ${days}d)`;
    if (upsertSignal(db, "stale_fact", "info", msg, targetRef)) {
      inserted++;
    }
  }
  return inserted;
}

/**
 * `unresolved_contradiction`: two or more active facts share the same
 * `(subject, predicate)` pair but disagree on `object`, and reflect has not
 * yet resolved them (age > `days`). Grouping by `conflict_group` would miss
 * the real signal because reflect.ts sets `conflict_group` + `archived_at`
 * on the loser in the same transaction -- so by the time a scan fires,
 * contradictions processed by reflect show only the winner as active and
 * trip no detection. The value this scanner provides is catching
 * contradictions **before** reflect cycles (or when reflect is stuck).
 *
 * This scanner only surfaces plausible single-valued claims. The LLM/Markdown
 * extraction predicates such as `describes`, `has_architecture`, and
 * `exposes_api` are intentionally multi-valued, so multiple objects there are
 * normal evidence fan-out rather than contradictions.
 *
 * Surface rule: one signal per `(subject, predicate)` pair. `target_ref` is
 * `contradiction:<subject>/<predicate>` so repeated scans dedupe via upsert.
 */
export function scanUnresolvedContradiction(
  db: Database,
  days: number,
  maxPerKind: number
): number {
  if (SINGLE_VALUE_CONTRADICTION_PREDICATES.length === 0) return 0;

  const predicatePlaceholders = SINGLE_VALUE_CONTRADICTION_PREDICATES.map(
    () => "?"
  ).join(", ");
  const genericSubjectPlaceholders = GENERIC_CONTRADICTION_SUBJECTS.map(
    () => "?"
  ).join(", ");

  const rows = db
    .query(
      `SELECT subject, predicate,
              COUNT(DISTINCT object) AS active_objects,
              MIN(created_at) AS oldest_created_at
       FROM facts
       WHERE archived_at IS NULL
         AND superseded_by IS NULL
         AND created_at < datetime('now', '-' || ? || ' days')
         AND lower(trim(predicate)) IN (${predicatePlaceholders})
         AND lower(trim(subject)) NOT IN (${genericSubjectPlaceholders})
         AND lower(trim(subject)) NOT GLOB 'image [0-9]*'
       GROUP BY subject, predicate
       HAVING active_objects >= 2
       ORDER BY oldest_created_at ASC
       LIMIT ?`
    )
    .all(
      days,
      ...SINGLE_VALUE_CONTRADICTION_PREDICATES,
      ...GENERIC_CONTRADICTION_SUBJECTS,
      maxPerKind
    ) as Array<{
    subject: string;
    predicate: string;
    active_objects: number;
    oldest_created_at: string;
  }>;

  let inserted = 0;
  for (const row of rows) {
    if (!isUnresolvedContradictionCandidate(row.subject, row.predicate)) {
      continue;
    }
    const targetRef = `contradiction:${row.subject}/${row.predicate}`;
    const msg = `${row.active_objects} active objects for (${row.subject}, ${row.predicate}); unresolved since ${row.oldest_created_at}`;
    if (upsertSignal(db, "unresolved_contradiction", "warn", msg, targetRef)) {
      inserted++;
    }
  }
  return inserted;
}

/**
 * `orphan_delta`: active facts with no incoming/outgoing `fact_links` edges
 * AND no access_log hit in the last `days` window. Contract (0010 comment):
 * "new orphan facts vs baseline > 5". Day 3 ships the per-fact surfacing;
 * true delta-vs-baseline aggregation requires `graph_health_snapshot`
 * comparison and is scheduled for Week 5+ once baseline stability is
 * observable.
 */
export function scanOrphanDelta(
  db: Database,
  days: number,
  maxPerKind: number
): number {
  const accessCutoff = Math.floor(Date.now() / 1000) - days * 86_400;
  const rows = db
    .query(
      `SELECT f.fact_id, f.subject, f.predicate
       FROM facts f
       WHERE f.archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM fact_links l
           WHERE l.from_fact_id = f.fact_id OR l.to_fact_id = f.fact_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM access_log a
           WHERE a.fact_id = f.fact_id AND a.accessed_at_unix_sec >= ?
         )
         AND f.created_at < datetime('now', '-' || ? || ' days')
       ORDER BY f.created_at ASC
       LIMIT ?`
    )
    .all(accessCutoff, days, maxPerKind) as Array<{
    fact_id: string;
    subject: string;
    predicate: string;
  }>;

  let inserted = 0;
  for (const row of rows) {
    const targetRef = `fact:${row.fact_id}`;
    const msg = `orphan fact (${row.subject}, ${row.predicate}): no links, no access in ${days}d`;
    if (upsertSignal(db, "orphan_delta", "info", msg, targetRef)) {
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
          OR last_synthesis_at IS NULL
          OR last_synthesis_at < datetime('now', '-' || ? || ' days')
       ORDER BY COALESCE(stale_at, last_synthesis_at, '0000-00-00') ASC
       LIMIT ?`
    )
    .all(days, maxPerKind) as Array<{
    path: string;
    title: string;
    stale_at: string | null;
    last_synthesis_at: string | null;
  }>;

  let inserted = 0;
  for (const row of rows) {
    const targetRef = `wiki:${row.path}`;
    const reason = row.stale_at
      ? `last rebuild failed at ${row.stale_at}`
      : row.last_synthesis_at
        ? `last synthesis at ${row.last_synthesis_at} is older than ${days}d`
        : `never synthesized`;
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
 * Coverage: 5 scanners run here + 1 drain-hook producer = 6 SignalKind total.
 * `correction_candidate` is NOT scanned here -- `correction-detector.
 * scanObservationForCorrection` writes those rows directly during the drain
 * hook (debate 006 Pre-Week-2 Fix 5); `triage()` aggregates them into the
 * report below alongside whatever the 5 scanners wrote this cycle.
 */
export function triage(db: Database, opts: TriageOptions = {}): TriageReport {
  const staleFactDays = opts.staleFactDays ?? 90;
  const contradictionAgeDays = opts.contradictionAgeDays ?? 7;
  const stuckOutboxHours = opts.stuckOutboxHours ?? 24;
  const staleWikiDays = opts.staleWikiDays ?? 30;
  const orphanAccessDays = opts.orphanAccessDays ?? 30;
  const maxPerKind = opts.maxPerKind ?? DEFAULT_MAX_PER_KIND;

  scanStaleFact(db, staleFactDays, maxPerKind);
  scanUnresolvedContradiction(db, contradictionAgeDays, maxPerKind);
  scanStuckOutbox(db, stuckOutboxHours, maxPerKind);
  scanOrphanDelta(db, orphanAccessDays, maxPerKind);
  scanStaleWiki(db, staleWikiDays, maxPerKind);
  // correction_candidate: no scanner -- written by correction-detector directly.

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

export interface ListSignalsFilter {
  kind?: SignalKind;
  sinceIso?: string;
  includeResolved?: boolean; // default false (show unresolved only)
  limit?: number; // default 100; CLI caps at 10_000
}

/**
 * Read-only signal listing for CLI (`compost triage list`). Never scans or
 * writes -- pairs with `triage()` which does the write-side work.
 *
 * Normalizes `sinceIso` by dropping fractional seconds + Z since SQLite
 * stores `datetime('now')` at 1s resolution without TZ suffix.
 */
export function listSignals(
  db: Database,
  filter: ListSignalsFilter = {}
): HealthSignal[] {
  const limit = filter.limit ?? 100;
  const since = filter.sinceIso
    ? filter.sinceIso.replace("T", " ").slice(0, 19)
    : null;
  const includeResolved = filter.includeResolved ?? false;

  const rows = db
    .query(
      `SELECT id, kind, severity, message, target_ref, created_at,
              resolved_at, resolved_by
       FROM health_signals
       WHERE (?1 IS NULL OR kind = ?1)
         AND (?2 IS NULL OR created_at >= ?2)
         AND (?3 = 1 OR resolved_at IS NULL)
       ORDER BY created_at DESC
       LIMIT ?4`
    )
    .all(
      filter.kind ?? null,
      since,
      includeResolved ? 1 : 0,
      limit
    ) as HealthSignal[];
  return rows;
}

/**
 * Mark a signal resolved (user or agent action acknowledged it).
 * Returns `true` if a row actually moved from unresolved -> resolved, `false`
 * if the id was missing or already resolved. CLI callers should exit non-0
 * on `false` to avoid reporting fake success (debate 013 F4).
 */
export function resolveSignal(
  db: Database,
  signalId: number,
  resolvedBy: "user" | "agent" | "auto-cleared"
): boolean {
  const result = db.run(
    "UPDATE health_signals " +
      "SET resolved_at = datetime('now'), resolved_by = ? " +
      "WHERE id = ? AND resolved_at IS NULL",
    [resolvedBy, signalId]
  );
  return result.changes > 0;
}
