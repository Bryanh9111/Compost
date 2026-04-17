import { v5 as uuidv5 } from "uuid";
import {
  ADJACENT_CHUNK_SIMILARITY_CEILING,
  COMPOST_INSIGHT_UUID_NAMESPACE,
  MAX_CONTENT_CHARS,
} from "./constants";

export type SplitStrategy = "none" | "paragraph" | "sentence" | "hard-cut";

export interface SourceTrace {
  compost_fact_ids: string[];
  root_insight_id: string;
  chunk_index: number;
  total_chunks: number;
  split_strategy: SplitStrategy;
  synthesized_at: string;
  compost_wiki_path?: string;
  derivation_run_id?: string;
}

export interface ChunkedInsight {
  content: string;
  source_trace: SourceTrace;
}

export interface SplitOptions {
  project: string | null;
  compostFactIds: string[];
  content: string;
  synthesizedAt: string;
  compostWikiPath?: string;
  derivationRunId?: string;
}

/**
 * Deterministic root_insight_id from project + sorted fact_ids.
 * Re-running synthesis on the same fact set yields the same id → Engram
 * sees update, not duplicate write. See debate 020 R4.
 */
export function computeRootInsightId(
  project: string | null,
  compostFactIds: string[]
): string {
  const sorted = [...compostFactIds].sort();
  const key = (project ?? "") + "|" + sorted.join(",");
  return uuidv5(key, COMPOST_INSIGHT_UUID_NAMESPACE);
}

/**
 * Split a (possibly long) insight into <= MAX_CONTENT_CHARS chunks.
 * Prefers paragraph boundaries, falls back to sentence, then hard-cut.
 * All chunks share the same root_insight_id / fact_ids / synthesized_at.
 */
export function splitInsight(opts: SplitOptions): ChunkedInsight[] {
  const rootId = computeRootInsightId(opts.project, opts.compostFactIds);
  const sortedFactIds = [...opts.compostFactIds].sort();

  const baseTrace = (
    chunk_index: number,
    total_chunks: number,
    strategy: SplitStrategy
  ): SourceTrace => ({
    compost_fact_ids: sortedFactIds,
    root_insight_id: rootId,
    chunk_index,
    total_chunks,
    split_strategy: strategy,
    synthesized_at: opts.synthesizedAt,
    ...(opts.compostWikiPath
      ? { compost_wiki_path: opts.compostWikiPath }
      : {}),
    ...(opts.derivationRunId
      ? { derivation_run_id: opts.derivationRunId }
      : {}),
  });

  if (opts.content.length <= MAX_CONTENT_CHARS) {
    return [
      {
        content: opts.content,
        source_trace: baseTrace(0, 1, "none"),
      },
    ];
  }

  // Try paragraph split first. If any paragraph alone exceeds cap, retry
  // with sentence split. Finally fall back to hard-cut.
  let strategy: SplitStrategy = "paragraph";
  let chunks = greedyPack(
    opts.content.split(/\n\n+/).filter((p) => p.length > 0),
    MAX_CONTENT_CHARS,
    "\n\n"
  );

  if (chunks.some((c) => c.length > MAX_CONTENT_CHARS)) {
    strategy = "sentence";
    chunks = greedyPack(
      opts.content.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0),
      MAX_CONTENT_CHARS,
      " "
    );
  }

  if (chunks.some((c) => c.length > MAX_CONTENT_CHARS)) {
    strategy = "hard-cut";
    chunks = hardCut(opts.content, MAX_CONTENT_CHARS);
  }

  const total = chunks.length;
  return chunks.map((content, i) => ({
    content,
    source_trace: baseTrace(i, total, strategy),
  }));
}

function greedyPack(pieces: string[], max: number, sep: string): string[] {
  if (pieces.length === 0) return [];
  const result: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? current + sep + piece : piece;
    if (candidate.length <= max) {
      current = candidate;
    } else {
      if (current) result.push(current);
      current = piece;
    }
  }
  if (current) result.push(current);
  return result;
}

function hardCut(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) {
    out.push(s.slice(i, i + size));
  }
  return out;
}

/**
 * Jaccard similarity over lowercased whitespace tokens.
 * Used for the R6 smoke check: adjacent chunks crossing the ceiling would
 * collide with Engram's content-similarity dedupe (merge_threshold=0.75).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0)
    );
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface AdjacentSimilarityViolation {
  pair: [number, number];
  similarity: number;
}

/**
 * Returns pairs of adjacent chunk indices whose similarity meets or exceeds
 * the Engram dedupe ceiling. Empty array = safe. Debate 020 R6 mitigation.
 */
export function checkAdjacentSimilarity(
  chunks: ChunkedInsight[]
): AdjacentSimilarityViolation[] {
  const violations: AdjacentSimilarityViolation[] = [];
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1];
    const curr = chunks[i];
    if (!prev || !curr) continue;
    const sim = jaccardSimilarity(prev.content, curr.content);
    if (sim >= ADJACENT_CHUNK_SIMILARITY_CEILING) {
      violations.push({ pair: [i - 1, i], similarity: sim });
    }
  }
  return violations;
}
