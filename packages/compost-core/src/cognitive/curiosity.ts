import type { Database } from "bun:sqlite";
import {
  listGaps,
  type OpenProblem,
  type OpenProblemStatus,
} from "./gap-tracker";

/**
 * Phase 6 P0 — Curiosity agent (pattern detection over gap tracker).
 *
 * Takes the stream of open_problems the ask() path already accumulates
 * (via `logGap` when recall confidence is weak) and clusters them by
 * token-level Jaccard overlap. The representative + total_asks of each
 * cluster surface "what does the user keep asking about" without LLM,
 * which feeds two downstream consumers:
 *
 *   1. Interactive review — `compost curiosity` CLI. User sees hotspots
 *      and decides: resolve, dismiss, or queue for external ingest
 *      (Phase 6's user-approved crawl queue).
 *   2. Digest push — future slice may add a "top curiosity clusters"
 *      section so Engram learns the user's current obsessions.
 *
 * Algorithm:
 *   - Normalize each question to lowercase tokens, drop stopwords and
 *     tokens ≤ 2 chars (filters out "is" / "a" / punctuation residue).
 *   - Greedy pass: each gap joins the first existing cluster whose
 *     representative Jaccard-overlaps ≥ minJaccard; else starts a new
 *     cluster.
 *   - shared_tokens = intersection across all cluster members.
 *   - representative = cluster member with the highest ask_count.
 *   - Clusters sorted by total_asks desc; singletons dropped into
 *     `unclustered` so they don't pollute the hotspot list.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "must", "can", "shall",
  "what", "why", "how", "when", "where", "who", "which", "this", "that",
  "these", "those", "it", "its", "of", "in", "on", "at", "to", "from",
  "for", "with", "by", "about", "into", "onto", "as", "so", "than",
  "then", "there", "here", "also", "just", "only", "any", "some",
  "all", "no", "not", "yes", "if", "else", "really",
]);

export function tokenizeQuestion(raw: string): string[] {
  const tokens = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return [...new Set(tokens)];
}

export function jaccardOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface CuriosityCluster {
  representative: string;
  gap_ids: string[];
  total_asks: number;
  shared_tokens: string[];
}

export interface CuriosityReport {
  clusters: CuriosityCluster[];
  unclustered: OpenProblem[];
  window_days: number;
}

export interface CuriosityOptions {
  /** Filter by status. Default `open`. */
  status?: OpenProblemStatus;
  /** Include gaps last asked within this many days. Default 30. */
  windowDays?: number;
  /** Min Jaccard overlap to join a cluster. Default 0.3. */
  minJaccard?: number;
  /** Cap on clusters returned (sorted by total_asks desc). Default 10. */
  maxClusters?: number;
  /** Injection for deterministic test windows. */
  now?: Date;
}

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_MIN_JACCARD = 0.3;
const DEFAULT_MAX_CLUSTERS = 10;

interface WorkingCluster {
  gaps: OpenProblem[];
  tokens: Map<string, Set<string>>; // gap_id -> token set
}

export function detectCuriosityClusters(
  db: Database,
  opts: CuriosityOptions = {}
): CuriosityReport {
  const status = opts.status ?? "open";
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const minJaccard = opts.minJaccard ?? DEFAULT_MIN_JACCARD;
  const maxClusters = opts.maxClusters ?? DEFAULT_MAX_CLUSTERS;
  const now = opts.now ?? new Date();

  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - windowDays);
  // listGaps `since` filter compares last_asked_at >= since; SQLite stores
  // "YYYY-MM-DD HH:MM:SS" text so strip ISO 'T' + ms for lex compare.
  const sinceSqlite = since.toISOString().replace("T", " ").slice(0, 19);

  const gaps = listGaps(db, { status, since: sinceSqlite, limit: 500 });
  if (gaps.length === 0) {
    return { clusters: [], unclustered: [], window_days: windowDays };
  }

  const tokenized = new Map<string, string[]>();
  for (const g of gaps) tokenized.set(g.problem_id, tokenizeQuestion(g.question));

  // Greedy clustering: each gap joins the first existing cluster where the
  // cluster's representative (highest ask_count so far) overlaps ≥ minJaccard.
  // Order: sort by ask_count desc so high-reinforcement gaps anchor clusters.
  const sorted = [...gaps].sort((a, b) => {
    if (b.ask_count !== a.ask_count) return b.ask_count - a.ask_count;
    return b.last_asked_at.localeCompare(a.last_asked_at);
  });

  const working: WorkingCluster[] = [];
  for (const g of sorted) {
    const tokensG = tokenized.get(g.problem_id) ?? [];
    let joined = false;
    for (const wc of working) {
      const anchorId = wc.gaps[0]!.problem_id;
      const tokensAnchor = wc.tokens.get(anchorId) ?? [];
      if (jaccardOverlap(tokensAnchor, tokensG) >= minJaccard) {
        wc.gaps.push(g);
        wc.tokens.set(g.problem_id, new Set(tokensG));
        joined = true;
        break;
      }
    }
    if (!joined) {
      const wc: WorkingCluster = {
        gaps: [g],
        tokens: new Map([[g.problem_id, new Set(tokensG)]]),
      };
      working.push(wc);
    }
  }

  // Singletons -> unclustered; multi-member -> real clusters.
  const unclustered: OpenProblem[] = [];
  const real: CuriosityCluster[] = [];
  for (const wc of working) {
    if (wc.gaps.length < 2) {
      unclustered.push(wc.gaps[0]!);
      continue;
    }
    const ids = wc.gaps.map((g) => g.problem_id);
    const total_asks = wc.gaps.reduce((acc, g) => acc + g.ask_count, 0);
    // Representative: highest ask_count (tiebreak: most recent last_asked_at).
    const rep = [...wc.gaps].sort((a, b) => {
      if (b.ask_count !== a.ask_count) return b.ask_count - a.ask_count;
      return b.last_asked_at.localeCompare(a.last_asked_at);
    })[0]!;
    // Shared tokens = intersection across all members.
    const tokenSets = wc.gaps.map(
      (g) => wc.tokens.get(g.problem_id) ?? new Set<string>()
    );
    const shared = [...tokenSets[0]!].filter((t) =>
      tokenSets.every((s) => s.has(t))
    );
    real.push({
      representative: rep.question,
      gap_ids: ids,
      total_asks,
      shared_tokens: shared,
    });
  }

  real.sort((a, b) => b.total_asks - a.total_asks);
  const clusters = real.slice(0, maxClusters);

  return { clusters, unclustered, window_days: windowDays };
}
