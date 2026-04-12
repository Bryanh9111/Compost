import type { Database } from "bun:sqlite";
import { v7 as uuidv7 } from "uuid";

/**
 * QueryOptions — spec §5 API contract.
 */
export interface QueryOptions {
  budget?: number; // max results, default 20
  ranking_profile_id?: string; // default 'rp-phase1-default'
  contexts?: string[]; // context filter
  as_of_unix_sec?: number; // decay reference time
  debug_ranking?: boolean; // writes to ranking_audit_log if true
}

/**
 * QueryHit — spec §5 return shape. ranking_components is Record<string, number>,
 * NOT a fixed tuple. Phase 0 returns {} (no active factors).
 */
export interface QueryHit {
  fact: { subject: string; predicate: string; object: string };
  fact_id: string;
  confidence: number;
  provenance: {
    source_uri: string;
    captured_at: string;
    adapter: string;
    transform_policy: string;
  };
  contexts: string[];
  ranking_components: Record<string, number>;
  final_score: number;
}

export interface QueryResult {
  query_id: string;
  hits: QueryHit[];
  ranking_profile_id: string;
  budget: number;
}

/**
 * Phase 0 query stub. Returns empty hits with correct shape.
 * Phase 1 wires LanceDB Stage-1 -> SQLite Stage-2 rerank (spec §5.1).
 */
export function query(
  _db: Database,
  _q: string,
  opts: QueryOptions = {}
): QueryResult {
  return {
    query_id: uuidv7(),
    hits: [],
    ranking_profile_id: opts.ranking_profile_id ?? "rp-phase1-default",
    budget: opts.budget ?? 20,
  };
}
