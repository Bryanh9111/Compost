import type { Database } from "bun:sqlite";
import { v7 as uuidv7 } from "uuid";
import type { VectorStore } from "../storage/lancedb";
import { loadRankingProfile } from "../ranking/profile";

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
 * NOT a fixed tuple.
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

// ---------------------------------------------------------------------------
// RRF (Reciprocal Rank Fusion) — Debate 8 consensus
// ---------------------------------------------------------------------------

const RRF_K = 60; // standard constant; benchmark to tune

interface RRFCandidate {
  fact_id: string;
  rrf_score: number;
  semantic_score: number; // best ANN cosine, 0 if BM25-only
}

function rrfMerge(
  annRanked: Array<{ fact_id: string; score: number }>,
  bm25Ranked: Array<{ fact_id: string }>,
): RRFCandidate[] {
  const scores = new Map<string, { rrf: number; semantic: number }>();

  // ANN contributions
  for (let i = 0; i < annRanked.length; i++) {
    const { fact_id, score } = annRanked[i];
    const entry = scores.get(fact_id) ?? { rrf: 0, semantic: 0 };
    entry.rrf += 1 / (RRF_K + i + 1);
    if (score > entry.semantic) entry.semantic = score;
    scores.set(fact_id, entry);
  }

  // BM25 contributions
  for (let i = 0; i < bm25Ranked.length; i++) {
    const { fact_id } = bm25Ranked[i];
    const entry = scores.get(fact_id) ?? { rrf: 0, semantic: 0 };
    entry.rrf += 1 / (RRF_K + i + 1);
    scores.set(fact_id, entry);
  }

  return Array.from(scores.entries())
    .map(([fact_id, s]) => ({
      fact_id,
      rrf_score: s.rrf,
      semantic_score: s.semantic,
    }))
    .sort((a, b) => b.rrf_score - a.rrf_score);
}

// ---------------------------------------------------------------------------
// BM25 via FTS5
// ---------------------------------------------------------------------------

function bm25Search(db: Database, q: string, topK: number = 200): Array<{ fact_id: string }> {
  try {
    // FTS5 rank() returns negative values; ORDER BY rank ASC = best first
    const rows = db
      .prepare(
        `SELECT f.fact_id
         FROM facts_fts fts
         JOIN facts f ON f.rowid = fts.rowid
         WHERE facts_fts MATCH $q AND f.archived_at IS NULL
         ORDER BY rank
         LIMIT $limit`
      )
      .all({ $q: q, $limit: topK }) as Array<{ fact_id: string }>;
    return rows;
  } catch {
    // FTS5 MATCH can throw on malformed queries (e.g. special chars)
    return [];
  }
}

/**
 * Phase 2 query implementation — hybrid retrieval.
 * Stage-0a: BM25 via FTS5 (always available, no external deps)
 * Stage-0b: LanceDB ANN (optional — degrades to BM25-only if absent)
 * RRF merge → unified candidate set
 * Stage-2: SQLite rerank with ranking formula
 * Spec §5.1 + Debate 8 consensus.
 */
export async function query(
  db: Database,
  q: string,
  opts: QueryOptions = {},
  vectorStore?: VectorStore
): Promise<QueryResult> {
  const queryId = uuidv7();
  const profileId = opts.ranking_profile_id ?? "rp-phase1-default";
  const budget = opts.budget ?? 20;
  const asOf = opts.as_of_unix_sec ?? Math.floor(Date.now() / 1000);

  if (!q.trim()) {
    return { query_id: queryId, hits: [], ranking_profile_id: profileId, budget };
  }

  const profile = loadRankingProfile(db, profileId);

  // Stage-0a: BM25 candidates (always available)
  const bm25Hits = bm25Search(db, q, 200);

  // Stage-0b: ANN candidates (optional)
  let annHits: Array<{ fact_id: string; score: number }> = [];
  if (vectorStore) {
    const rawHits = await vectorStore.search(q, 200);
    // Deduplicate chunks to fact_id level (take max score per fact)
    const factScores = new Map<string, number>();
    for (const h of rawHits) {
      const existing = factScores.get(h.fact_id);
      if (!existing || h.score > existing) {
        factScores.set(h.fact_id, h.score);
      }
    }
    annHits = Array.from(factScores.entries())
      .map(([fact_id, score]) => ({ fact_id, score }))
      .sort((a, b) => b.score - a.score);
  }

  // No candidates from either source = empty
  if (bm25Hits.length === 0 && annHits.length === 0) {
    return { query_id: queryId, hits: [], ranking_profile_id: profileId, budget };
  }

  // RRF merge
  const merged = rrfMerge(annHits, bm25Hits);

  // Stage-2: SQLite rerank via temp table bridge
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS query_candidates (
      fact_id TEXT PRIMARY KEY,
      semantic_score REAL NOT NULL
    );
    DELETE FROM query_candidates;
  `);

  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS query_context_filter (
      context_id TEXT PRIMARY KEY
    );
    DELETE FROM query_context_filter;
  `);

  const insertCandidate = db.prepare(
    "INSERT OR IGNORE INTO query_candidates (fact_id, semantic_score) VALUES (?, ?)"
  );
  for (const c of merged) {
    insertCandidate.run(c.fact_id, c.semantic_score);
  }

  // Context filter
  const hasContextFilter = opts.contexts && opts.contexts.length > 0;
  if (hasContextFilter) {
    const insertCtx = db.prepare(
      "INSERT INTO query_context_filter (context_id) VALUES (?)"
    );
    for (const ctxId of opts.contexts!) {
      insertCtx.run(ctxId);
    }
  }

  // Main rerank query
  const reranked = db
    .prepare(
      `SELECT
        f.fact_id, f.subject, f.predicate, f.object, f.confidence,
        f.importance, f.half_life_seconds, f.last_reinforced_at_unix_sec,
        o.source_uri, o.captured_at, o.adapter, o.transform_policy,
        qc.semantic_score,
        COALESCE(al.cnt, 0) AS access_count,
        ($w1_semantic * COALESCE(qc.semantic_score, 0.0)) AS w1_val,
        ($w2_temporal * CASE
          WHEN f.half_life_seconds > 0
          THEN POW(0.5, ($as_of - f.last_reinforced_at_unix_sec) * 1.0 / f.half_life_seconds)
          ELSE 1.0
        END) AS w2_val,
        ($w3_access * MIN(1.0, LN(1 + COALESCE(al.cnt, 0)) * 1.0 / LN(1 + $access_sat))) AS w3_val,
        ($w4_importance * COALESCE(f.importance, 0.0)) AS w4_val,
        (SELECT json_group_array(fc2.context_id) FROM fact_context fc2 WHERE fc2.fact_id = f.fact_id) AS contexts_json,
        (
          ($w1_semantic * COALESCE(qc.semantic_score, 0.0))
          + ($w2_temporal * CASE
              WHEN f.half_life_seconds > 0
              THEN POW(0.5, ($as_of - f.last_reinforced_at_unix_sec) * 1.0 / f.half_life_seconds)
              ELSE 1.0
            END)
          + ($w3_access * MIN(1.0, LN(1 + COALESCE(al.cnt, 0)) * 1.0 / LN(1 + $access_sat)))
          + ($w4_importance * COALESCE(f.importance, 0.0))
        ) AS final_score
      FROM facts f
      JOIN query_candidates qc ON qc.fact_id = f.fact_id
      JOIN observations o ON o.observe_id = f.observe_id
      LEFT JOIN (
        SELECT al_inner.fact_id, COUNT(*) AS cnt
        FROM access_log al_inner
        WHERE al_inner.fact_id IN (SELECT fact_id FROM query_candidates)
        GROUP BY al_inner.fact_id
      ) al USING (fact_id)
      WHERE f.archived_at IS NULL
        AND (
          $has_context_filter = 0
          OR EXISTS (
            SELECT 1 FROM fact_context fc
            JOIN query_context_filter qcf ON qcf.context_id = fc.context_id
            WHERE fc.fact_id = f.fact_id
          )
        )
      ORDER BY final_score DESC
      LIMIT $budget`
    )
    .all({
      $w1_semantic: profile.w1_semantic,
      $w2_temporal: profile.w2_temporal,
      $w3_access: profile.w3_access,
      $w4_importance: profile.w4_importance,
      $as_of: asOf,
      $access_sat: profile.access_saturation,
      $budget: budget,
      $has_context_filter: hasContextFilter ? 1 : 0,
    }) as Array<Record<string, unknown>>;

  // Build QueryHit results
  const hits: QueryHit[] = reranked.map((r) => ({
    fact: {
      subject: r.subject as string,
      predicate: r.predicate as string,
      object: r.object as string,
    },
    fact_id: r.fact_id as string,
    confidence: r.confidence as number,
    provenance: {
      source_uri: r.source_uri as string,
      captured_at: r.captured_at as string,
      adapter: r.adapter as string,
      transform_policy: r.transform_policy as string,
    },
    contexts: (() => {
      try {
        const parsed = JSON.parse(r.contexts_json as string);
        return Array.isArray(parsed) ? parsed.filter((x: unknown) => x !== null) : [];
      } catch {
        return [];
      }
    })(),
    ranking_components: {
      w1_semantic: r.w1_val as number,
      w2_temporal: r.w2_val as number,
      w3_access: r.w3_val as number,
      w4_importance: r.w4_val as number,
    },
    final_score: r.final_score as number,
  }));

  // Telemetry: append access_log
  if (hits.length > 0) {
    const insertAccess = db.prepare(
      "INSERT INTO access_log (fact_id, accessed_at_unix_sec, query_id, ranking_profile_id) VALUES (?, ?, ?, ?)"
    );
    for (const hit of hits) {
      insertAccess.run(hit.fact_id, asOf, queryId, profileId);
    }
  }

  // Telemetry: ranking_audit_log (if debug or sampled)
  const sampleRate = parseFloat(process.env.COMPOST_RANKING_SAMPLE_RATE ?? "0");
  const shouldAudit = opts.debug_ranking || Math.random() < sampleRate;
  if (shouldAudit && hits.length > 0) {
    const insertAudit = db.prepare(
      `INSERT INTO ranking_audit_log
       (query_id, profile_id, fact_id, queried_at_unix_sec, rank_position,
        w1_semantic, w2_temporal, w3_access, w4_importance, final_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      insertAudit.run(
        queryId,
        profileId,
        h.fact_id,
        asOf,
        i + 1,
        h.ranking_components.w1_semantic,
        h.ranking_components.w2_temporal,
        h.ranking_components.w3_access,
        h.ranking_components.w4_importance,
        h.final_score
      );
    }
  }

  return { query_id: queryId, hits, ranking_profile_id: profileId, budget };
}
