import type { Database } from "bun:sqlite";

/**
 * Patterns for explicit self-correction. Conservative on purpose:
 * we want low recall + high precision (LLM hallucination noise > correction noise).
 *
 * Detector runs in daemon post-drain (NOT in hook hot path; preserves <20ms cold start).
 */
export const CORRECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Chinese
  { name: "zh.previous_was_wrong", re: /我(之前|上次|刚才)(说|以为|提到)的.*?(错|不对|有误|不准)/u },
  { name: "zh.actually_should_be", re: /(实际上|其实)(应该|是)/u },
  { name: "zh.scratch_that", re: /(忽略|算了)(我|刚才)(说的|的话)/u },
  // English
  { name: "en.i_was_wrong", re: /\bI was wrong about\b/i },
  { name: "en.correction_label", re: /\bcorrection:\s/i },
  { name: "en.scratch_that", re: /\bscratch that\b/i },
  { name: "en.actually", re: /\bactually,?\s+(I|it|that)\b/i },
];

export interface CorrectionEvent {
  id: number;
  sessionId: string | null;
  retractedText: string;
  correctedText: string | null;
  relatedFactIds: string[];
  patternMatched: string | null;
  createdAt: string;
  processedAt: string | null;
}

/**
 * Scan a text turn for correction patterns. Returns the matched pattern +
 * the truncated full-turn context, or null if no match.
 *
 * IMPORTANT (debate 006 Pre-Week-2 Fix 3): the caller is responsible for
 * passing the FULL turn text -- typically reconstructed by reading
 * `observations.raw_bytes` for a `source.kind = 'claude-code'` row and
 * parsing the hook payload JSON to extract `turnText`. `match[0]` is an
 * idiomatic phrase ("I was wrong about"), NOT a subject keyword, so we
 * store the broader context in `retractedText` to give `findRelatedFacts`
 * meaningful tokens to work with.
 *
 * Capped at 500 chars to prevent a paste of a 10KB log (that happens to
 * contain "actually, I..." deep inside) from flooding `correction_events`.
 */
export const MAX_RETRACTED_TEXT_CHARS = 500;

export function detectCorrection(turnText: string): {
  patternName: string;
  retractedText: string;
  correctedText: string | null;
} | null {
  for (const { name, re } of CORRECTION_PATTERNS) {
    const match = turnText.match(re);
    if (match) {
      // P0-5 stores the turn text (truncated) rather than match[0], so
      // downstream findRelatedFacts has real content to tokenize against.
      const retracted = turnText.length > MAX_RETRACTED_TEXT_CHARS
        ? turnText.slice(0, MAX_RETRACTED_TEXT_CHARS)
        : turnText;
      return {
        patternName: name,
        retractedText: retracted,
        correctedText: null, // TODO(P0-5 Week 2 or later): extract corrected span via context window
      };
    }
  }
  return null;
}

/**
 * Insert a `correction_events` row plus a linked `health_signals` row in a
 * single transaction.
 *
 * Transactional contract (locked in debate 006 Pre-Week-2 Fix 5):
 *   1. INSERT correction_events (processed_at = NULL)
 *   2. INSERT health_signals (kind='correction_candidate',
 *                             target_ref='correction_event:<id>',
 *                             severity='info')
 *   3. UPDATE correction_events SET processed_at = datetime('now') for the id
 *   4. COMMIT
 * Failure anywhere rolls the whole thing back. This guarantees
 * "one correction_event <=> at most one health_signal" and makes the
 * `idx_correction_events_unprocessed` index meaningful (rows with
 * processed_at IS NULL represent scanner-in-flight or scanner-crashed work).
 *
 * Called by `scanObservationForCorrection` in the post-drain path (NOT by
 * reflect). The old JSDoc line "called by daemon scheduler after drain"
 * meant post-drain, not a separate scheduler -- clarified here.
 */
export function recordCorrection(
  db: Database,
  args: {
    sessionId: string | null;
    retractedText: string;
    correctedText: string | null;
    patternName: string;
    relatedFactIds?: string[];
  }
): { id: number } {
  // TODO(P0-5 Week 2): implement per the 4-step transactional contract above.
  void db;
  void args;
  throw new Error("correction-detector.recordCorrection not implemented (P0-5 stub)");
}

/**
 * Heuristic-only search for facts that may have been corrected. Returns up
 * to `opts.limit` fact_ids, deduped.
 *
 * Signature lock (debate 006 Pre-Week-2 Fix 4):
 *   - `sessionId`: restrict the search to facts created in the same session
 *     (subquery joining `source.kind = 'claude-code'` + matching session_id
 *     in observation metadata). Self-corrections almost always reference
 *     recent same-session facts, so this kills the biggest false-positive
 *     surface.
 *   - `limit`: default 5. Keeps the health_signal message readable.
 *   - `minTokenOverlap`: default 2. After tokenizing `retractedText` and
 *     stop-wording it, a candidate fact must share at least this many
 *     non-stop tokens in its subject OR object to count as related.
 *
 * IMPORTANT (debate 002 §Gemini 1.5 ruling): correction events are SIGNALS,
 * not direct mutations. The returned fact_ids feed into `health_signals`
 * (kind='correction_candidate') for user/agent review. NEVER auto-decrement
 * `facts.confidence` from a regex hit.
 *
 * Week 2 implementation choice (locked in debate 006 Fix 4):
 *   Option A: implement tokenize + stopword + session-filter + overlap scoring
 *   Option B: return `[]` with a TODO and defer the real impl to Week 4 P0-1
 * The implementer MUST pick one at Week 2 start time and document the choice.
 * "Looks-like-it-works" half-implementations (match[0] LIKE %...%) are
 * explicitly disallowed.
 */
export function findRelatedFacts(
  db: Database,
  retractedText: string,
  opts?: {
    sessionId?: string;
    limit?: number;
    minTokenOverlap?: number;
  }
): string[] {
  // TODO(P0-5 Week 2): pick Option A or Option B and implement.
  void db;
  void retractedText;
  void opts;
  return [];
}
