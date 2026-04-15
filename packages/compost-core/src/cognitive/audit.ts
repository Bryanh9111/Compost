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

/**
 * Structured evidence payload stored as JSON in `decision_audit.evidence_refs_json`.
 *
 * Locked in debate 007 Pre-Week-3 Lock 1: each audit kind has a fixed
 * payload shape. Callers MUST pass the variant matching their `kind` so
 * `compost audit list` (and future triage consumers) can parse without
 * guessing. JSON.stringify()'d at write time, callers cast on read.
 *
 * NOTE: `profile_switch` is reserved but has no Week 3 caller (debate 007
 * synthesis §Defer). The shape is locked here for Week 5+ when
 * `compost profile switch` CLI lands.
 */
export type EvidenceRefs =
  | {
      kind: "contradiction_arbitration";
      winner_id: string;
      loser_ids: string[];
      subject: string;
      predicate: string;
    }
  | {
      kind: "wiki_rebuild";
      page_path: string;
      input_observe_ids: string[];
      input_fact_count: number;
    }
  | {
      kind: "fact_excretion";
      fact_ids: string[];
      reason: "duplicate" | "low_access" | "manual";
      count: number;
    }
  | {
      kind: "profile_switch";
      from_profile_id: string;
      to_profile_id: string;
      changed_fields: string[];
    };

/**
 * Kind -> confidence tier mapping (debate 007 Pre-Week-3 Lock 3).
 * Mirror of the docs/ARCHITECTURE.md "decision_audit confidence tier" table.
 * Callers should use `TIER_FOR_KIND[kind]` rather than picking a tier per call.
 *
 * Exception: `fact_excretion` covers both heuristic (duplicate/low_access) and
 * user-driven (manual) excretions. Callers pass the tier explicitly for
 * fact_excretion based on `evidenceRefs.reason`.
 */
export const TIER_FOR_KIND: Record<Exclude<AuditKind, "fact_excretion">, ConfidenceTier> = {
  contradiction_arbitration: "instance",
  wiki_rebuild: "instance",
  profile_switch: "kernel",
};

export interface AuditEntry {
  kind: AuditKind;
  targetId: string;
  confidenceTier: ConfidenceTier;
  confidenceActual: number;
  rationale?: string;
  evidenceRefs?: EvidenceRefs;
  decidedBy: AuditActor;
}

export interface AuditRecord extends AuditEntry {
  id: number;
  decidedAt: string;
}

/**
 * Reflect step 2 exception (debate 007 Pre-Week-3 Lock 2): the `stale` archive
 * reason is a bulk decay-tombstone operation and per docs/ARCHITECTURE.md's
 * frozen enum, its Audit kind is explicitly `(none)`. The tombstone count is
 * carried in `ReflectionReport.semanticFactsTombstoned`, not in decision_audit.
 * Do NOT add a recordDecision call to reflect step 2.
 *
 * Week 3 audit writers: reflect step 3 (contradiction_arbitration, per
 * cluster) and wiki.ts rebuild success (wiki_rebuild, per page). That's it.
 */

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
