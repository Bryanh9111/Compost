/**
 * Reciprocal Rank Fusion — Debate 8 consensus retrieval merge.
 *
 * Originally inlined in `search.ts`; extracted as a reusable helper for
 * Phase 7 L5 reasoning (debate 025) which also fuses ranked candidate
 * lists from heterogeneous retrievers (ANN + FTS + graph traversal).
 *
 * RRF = Σ_lists 1 / (k + rank_in_list). Constant `k` damps high-rank
 * dominance so a strong consensus across lists outweighs being #1 in
 * one list. Standard tuning: k=60.
 */

const RRF_K = 60;

export interface RrfRankedItem {
  id: string;
  /**
   * Optional opaque score from the source retriever. RRF itself only
   * uses the rank order — score is preserved verbatim so callers can
   * read back per-source signals (e.g. ANN cosine for downstream
   * boost weighting).
   */
  score?: number;
}

export interface RrfMergedItem {
  id: string;
  rrf_score: number;
  /** Per-source max(score) where the item appeared. */
  source_scores: Record<string, number>;
}

export interface RrfList {
  /** Stable label for this source ("ann" / "fts" / "graph"). */
  source: string;
  ranked: RrfRankedItem[];
}

/**
 * Merge N ranked lists by RRF. Returns items sorted by descending
 * `rrf_score`. Items are deduplicated by `id`; if the same id appears
 * in multiple lists, RRF contributions sum and source_scores keep the
 * max per-source.
 */
export function rrfMerge(lists: RrfList[]): RrfMergedItem[] {
  const merged = new Map<
    string,
    { rrf: number; sources: Record<string, number> }
  >();

  for (const { source, ranked } of lists) {
    for (let i = 0; i < ranked.length; i++) {
      const item = ranked[i];
      if (!item) continue;
      const entry = merged.get(item.id) ?? { rrf: 0, sources: {} };
      entry.rrf += 1 / (RRF_K + i + 1);
      const incoming = item.score ?? 0;
      const prev = entry.sources[source] ?? 0;
      if (incoming > prev) entry.sources[source] = incoming;
      merged.set(item.id, entry);
    }
  }

  return Array.from(merged.entries())
    .map(([id, e]) => ({
      id,
      rrf_score: e.rrf,
      source_scores: e.sources,
    }))
    .sort((a, b) => b.rrf_score - a.rrf_score);
}

/**
 * Backward-compat shape for `query/search.ts` (Phase 2). The original
 * RRFCandidate carried just (fact_id, rrf_score, semantic_score). This
 * adapter keeps that contract while routing through the new generic
 * `rrfMerge` so search.ts and reasoning.ts share one implementation.
 */
export interface LegacyRrfCandidate {
  fact_id: string;
  rrf_score: number;
  semantic_score: number;
}

export function rrfMergeAnnBm25(
  annRanked: Array<{ fact_id: string; score: number }>,
  bm25Ranked: Array<{ fact_id: string }>
): LegacyRrfCandidate[] {
  const merged = rrfMerge([
    {
      source: "ann",
      ranked: annRanked.map((h) => ({ id: h.fact_id, score: h.score })),
    },
    {
      source: "bm25",
      ranked: bm25Ranked.map((h) => ({ id: h.fact_id })),
    },
  ]);
  return merged.map((m) => ({
    fact_id: m.id,
    rrf_score: m.rrf_score,
    semantic_score: m.source_scores["ann"] ?? 0,
  }));
}

export const RRF_K_CONSTANT = RRF_K;
