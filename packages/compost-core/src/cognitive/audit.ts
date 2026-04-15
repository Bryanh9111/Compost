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
      // 2026-04-15 debate 008 Q5 (3/4 vote): changed from input_observe_ids
      // to input_fact_ids. Wiki rebuild synthesizes from L2 facts; observe
      // provenance is one FK JOIN away (facts.observe_id) and duplicating it
      // here adds 1.5x storage without audit value.
      input_fact_ids: string[];
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
 * Record a high-cost decision. Throws if `confidenceActual` is below the floor
 * for the declared `confidenceTier`. Callers MUST pass a tier from the
 * `TIER_FOR_KIND` table (or pick explicitly for `fact_excretion` based on
 * reason, per docs/ARCHITECTURE.md confidence_floor table).
 *
 * `evidenceRefs` is stringified via JSON.stringify. The caller's union type
 * guarantees the payload shape matches the kind.
 */
export function recordDecision(db: Database, entry: AuditEntry): AuditRecord {
  const floor = CONFIDENCE_FLOORS[entry.confidenceTier];
  if (entry.confidenceActual < floor) {
    throw new Error(
      `audit.recordDecision: confidenceActual ${entry.confidenceActual} below ` +
      `${entry.confidenceTier} floor ${floor} for kind ${entry.kind}`
    );
  }
  // Defensive: evidence.kind should match entry.kind when provided.
  if (entry.evidenceRefs && entry.evidenceRefs.kind !== entry.kind) {
    throw new Error(
      `audit.recordDecision: evidenceRefs.kind '${entry.evidenceRefs.kind}' ` +
      `does not match entry.kind '${entry.kind}'`
    );
  }

  const evidenceJson = entry.evidenceRefs
    ? JSON.stringify(entry.evidenceRefs)
    : null;

  const result = db.run(
    "INSERT INTO decision_audit " +
      "(kind, target_id, confidence_floor, confidence_actual, rationale, evidence_refs_json, decided_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      entry.kind,
      entry.targetId,
      floor,
      entry.confidenceActual,
      entry.rationale ?? null,
      evidenceJson,
      entry.decidedBy,
    ]
  );
  const id = Number(result.lastInsertRowid);
  const row = db
    .query("SELECT decided_at FROM decision_audit WHERE id = ?")
    .get(id) as { decided_at: string };

  return { ...entry, id, decidedAt: row.decided_at };
}

/**
 * Query recent audit entries. All filters are optional; omitting them returns
 * the most recent `limit` rows (default 100). `sinceIso` is compared against
 * `decided_at` (SQLite datetime text), `targetId` is an exact match.
 */
export function listDecisions(
  db: Database,
  filter?: {
    kind?: AuditKind;
    sinceIso?: string;
    targetId?: string;
    decidedBy?: AuditActor;
    limit?: number;
  }
): AuditRecord[] {
  const kind = filter?.kind;
  const since = filter?.sinceIso;
  const targetId = filter?.targetId;
  const decidedBy = filter?.decidedBy;
  const limit = filter?.limit ?? 100;

  // Normalize `sinceIso` ("2026-04-15T12:00:00.000Z") to SQLite datetime text
  // ("2026-04-15 12:00:00") so lex comparison lines up with stored values.
  const sinceSqlite = since
    ? since.replace("T", " ").slice(0, 19)
    : null;

  const rows = db
    .query(
      "SELECT id, kind, target_id, confidence_floor, confidence_actual, rationale, " +
        "evidence_refs_json, decided_at, decided_by FROM decision_audit " +
        "WHERE (?1 IS NULL OR kind = ?1) " +
        "  AND (?2 IS NULL OR decided_at >= ?2) " +
        "  AND (?3 IS NULL OR target_id = ?3) " +
        "  AND (?4 IS NULL OR decided_by = ?4) " +
        "ORDER BY decided_at DESC, id DESC LIMIT ?5"
    )
    .all(kind ?? null, sinceSqlite, targetId ?? null, decidedBy ?? null, limit) as Array<{
    id: number;
    kind: AuditKind;
    target_id: string;
    confidence_floor: number;
    confidence_actual: number;
    rationale: string | null;
    evidence_refs_json: string | null;
    decided_at: string;
    decided_by: AuditActor;
  }>;

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    targetId: r.target_id,
    confidenceTier:
      r.confidence_floor === 0.9
        ? "kernel"
        : r.confidence_floor === 0.85
          ? "instance"
          : "exploration",
    confidenceActual: r.confidence_actual,
    rationale: r.rationale ?? undefined,
    evidenceRefs: r.evidence_refs_json
      ? (JSON.parse(r.evidence_refs_json) as EvidenceRefs)
      : undefined,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
  }));
}
