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

export interface TriageOptions {
  staleFactDays?: number;        // default 90
  contradictionAgeDays?: number; // default 7
  stuckOutboxHours?: number;     // default 24
  orphanDeltaThreshold?: number; // default 5
  staleWikiDays?: number;        // default 30
}

/**
 * Read-only triage: scans DB for the 5 signal kinds, inserts new health_signals
 * rows for findings, returns aggregated report.
 *
 * Hard rule: NEVER auto-executes any remediation. Surface only.
 * (See debates/001-myco-integration/synthesis_v2.md P0-1.)
 */
export function triage(db: Database, opts: TriageOptions = {}): TriageReport {
  // TODO(phase4-batch-d): implement signal scans. Stub returns empty report.
  void db;
  void opts;
  return {
    signals: [],
    byKind: {
      stale_fact: 0,
      unresolved_contradiction: 0,
      stuck_outbox: 0,
      orphan_delta: 0,
      stale_wiki: 0,
      correction_candidate: 0,
    },
    unresolvedTotal: 0,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Mark a signal resolved (user or agent action acknowledged it).
 */
export function resolveSignal(
  db: Database,
  signalId: number,
  resolvedBy: "user" | "agent" | "auto-cleared"
): void {
  // TODO(phase4-batch-d): implement.
  void db;
  void signalId;
  void resolvedBy;
}
