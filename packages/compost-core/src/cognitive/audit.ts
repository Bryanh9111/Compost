import type { Database } from "bun:sqlite";

/**
 * Confidence floor convention from synthesis_v2 §P0-2.
 * Mirrored in migration 0010 CHECK constraint.
 */
export const CONFIDENCE_FLOORS = {
  kernel: 0.9,
  instance: 0.85,
  exploration: 0.75,
} as const;

export type ConfidenceTier = keyof typeof CONFIDENCE_FLOORS;

export type AuditKind =
  | "contradiction_arbitration"
  | "wiki_rebuild"
  | "fact_excretion"
  | "profile_switch";

export type AuditActor = "reflect" | "wiki" | "user" | "agent";

export interface AuditEntry {
  kind: AuditKind;
  targetId: string;
  confidenceTier: ConfidenceTier;
  confidenceActual: number;
  rationale?: string;
  evidenceRefs?: string[];
  decidedBy: AuditActor;
}

export interface AuditRecord extends AuditEntry {
  id: number;
  decidedAt: string;
}

/**
 * Record a high-cost decision. Throws if confidence_actual < confidence_floor for the tier.
 * Callers MUST decide tier explicitly — no implicit defaulting.
 */
export function recordDecision(db: Database, entry: AuditEntry): AuditRecord {
  // TODO(phase4-batch-d): implement.
  // Validation: entry.confidenceActual >= CONFIDENCE_FLOORS[entry.confidenceTier]
  void db;
  void entry;
  throw new Error("audit.recordDecision not implemented (P0-2 stub)");
}

/**
 * Read recent audit entries for a kind (or all kinds).
 */
export function listDecisions(
  db: Database,
  filter?: { kind?: AuditKind; sinceIso?: string; limit?: number }
): AuditRecord[] {
  // TODO(phase4-batch-d): implement.
  void db;
  void filter;
  return [];
}
