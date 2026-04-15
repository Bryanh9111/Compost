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
 * Scan a text turn for correction patterns. Returns matched pattern + extracted
 * spans (retracted_text + corrected_text), or null if no match.
 */
export function detectCorrection(turnText: string): {
  patternName: string;
  retractedText: string;
  correctedText: string | null;
} | null {
  for (const { name, re } of CORRECTION_PATTERNS) {
    const match = turnText.match(re);
    if (match) {
      return {
        patternName: name,
        retractedText: match[0],
        correctedText: null, // TODO(phase4-batch-d): extract corrected span via context window
      };
    }
  }
  return null;
}

/**
 * Insert correction event row. Called by daemon scheduler after drain.
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
  // TODO(phase4-batch-d): implement INSERT.
  void db;
  void args;
  throw new Error("correction-detector.recordCorrection not implemented (P0-5 stub)");
}

/**
 * Find facts whose subject/object overlap with the retracted text — candidates
 * for review. Heuristic only, no LLM.
 *
 * IMPORTANT (debate 002 §Gemini 1.5 ruling): correction events are SIGNALS,
 * not direct mutations. The detected facts must be surfaced via `health_signals`
 * (kind='correction_candidate') for user/agent review. Never auto-decrement
 * `facts.confidence` from a regex hit — Gemini's "No, I meant…" false-positive
 * scenario would silently corrode high-quality facts.
 */
export function findRelatedFacts(
  db: Database,
  retractedText: string,
  limit: number = 5
): string[] {
  // TODO(phase4-batch-d): implement subject/object overlap heuristic.
  // Output flows to triage as health_signal, not directly to facts table.
  void db;
  void retractedText;
  void limit;
  return [];
}
