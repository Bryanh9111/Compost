import type { Database } from "bun:sqlite";
import { tokenizeQuestion } from "./curiosity";

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
        correctedText: null, // Deferred to Week 5+ per debate 012 (zero consumers today; P0-5 surface-only contract permits null; see docs/ROADMAP.md Week 5+ backlog).
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
  const relatedJson = JSON.stringify(args.relatedFactIds ?? []);
  let insertedId = 0;
  const tx = db.transaction(() => {
    // Step 1: INSERT correction_events (processed_at = NULL)
    const res = db.run(
      "INSERT INTO correction_events " +
        "(session_id, retracted_text, corrected_text, related_fact_ids_json, pattern_matched) " +
        "VALUES (?, ?, ?, ?, ?)",
      [
        args.sessionId,
        args.retractedText,
        args.correctedText,
        relatedJson,
        args.patternName,
      ]
    );
    insertedId = Number(res.lastInsertRowid);

    // Step 2: INSERT health_signals linked to the correction_event
    const relatedSummary = args.relatedFactIds && args.relatedFactIds.length > 0
      ? `${args.relatedFactIds.length} related fact(s): ${args.relatedFactIds.slice(0, 3).join(", ")}`
      : "related facts TBD (see P0-1 triage)";
    const preview = args.retractedText.length > 120
      ? args.retractedText.slice(0, 120) + "…"
      : args.retractedText;
    db.run(
      "INSERT INTO health_signals (kind, severity, message, target_ref) VALUES (?, ?, ?, ?)",
      [
        "correction_candidate",
        "info",
        `User may have corrected a prior claim — ${relatedSummary}. Context: ${preview}`,
        `correction_event:${insertedId}`,
      ]
    );

    // Step 3: UPDATE correction_events.processed_at = now
    db.run(
      "UPDATE correction_events SET processed_at = datetime('now') WHERE id = ?",
      [insertedId]
    );
  });
  tx();
  return { id: insertedId };
}

/**
 * Heuristic-only search for facts that may have been corrected. Returns up
 * to `opts.limit` fact_ids, deduped, sorted by overlap desc.
 *
 * Signature lock (debate 006 Pre-Week-2 Fix 4):
 *   - `sessionId`: restrict the search to facts created in the same
 *     claude-code session (source_id LIKE 'claude-code:<sid>:%').
 *     Self-corrections almost always reference recent same-session facts,
 *     so this kills the biggest false-positive surface.
 *   - `limit`: default 5. Keeps the health_signal message readable.
 *   - `minTokenOverlap`: default 2. After tokenizing `retractedText` and
 *     stop-wording it, a candidate fact must share at least this many
 *     non-stop tokens across its subject + object text to count.
 *
 * IMPORTANT (debate 002 §Gemini 1.5 ruling): correction events are SIGNALS,
 * not direct mutations. The returned fact_ids feed into `health_signals`
 * (kind='correction_candidate') for user/agent review. NEVER auto-decrement
 * `facts.confidence` from a regex hit.
 *
 * Implementation (Option A — retired the debate 006 stub once P0-1 triage
 * landed and did NOT absorb the related-fact inference it was meant to).
 * Reuses `tokenizeQuestion` from curiosity.ts for the same lowercase +
 * stopword + ≤2-char drop + dedup semantics.
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
  const limit = opts?.limit ?? 5;
  const minOverlap = opts?.minTokenOverlap ?? 2;

  const retractedTokens = new Set(tokenizeQuestion(retractedText));
  if (retractedTokens.size === 0) return [];

  // Candidate pool: same-session claude-code facts if sessionId provided
  // (source_id format "claude-code:<session_id>:<cwd>", see
  // scanObservationForCorrection); otherwise fall back to recent facts
  // across all sources. Pool cap 200 keeps scoring bounded — live
  // sessions typically stay well under.
  const rows = opts?.sessionId
    ? (db
        .query(
          `SELECT f.fact_id, f.subject, f.object
             FROM facts f
             JOIN observations o ON o.observe_id = f.observe_id
             JOIN source s ON s.id = o.source_id
            WHERE s.kind = 'claude-code'
              AND s.id LIKE ?
              AND f.archived_at IS NULL
              AND f.superseded_by IS NULL
            ORDER BY f.created_at DESC
            LIMIT 200`
        )
        .all(`claude-code:${opts.sessionId}:%`) as Array<{
        fact_id: string;
        subject: string;
        object: string;
      }>)
    : (db
        .query(
          `SELECT fact_id, subject, object
             FROM facts
            WHERE archived_at IS NULL
              AND superseded_by IS NULL
              AND created_at >= datetime('now', '-7 days')
            ORDER BY created_at DESC
            LIMIT 200`
        )
        .all() as Array<{
        fact_id: string;
        subject: string;
        object: string;
      }>);

  const scored: Array<{ fact_id: string; overlap: number }> = [];
  for (const row of rows) {
    const candidateTokens = new Set(
      tokenizeQuestion(`${row.subject} ${row.object}`)
    );
    let overlap = 0;
    for (const t of candidateTokens) if (retractedTokens.has(t)) overlap++;
    if (overlap >= minOverlap) {
      scored.push({ fact_id: row.fact_id, overlap });
    }
  }

  scored.sort((a, b) => b.overlap - a.overlap);
  return scored.slice(0, limit).map((s) => s.fact_id);
}

/**
 * Scan a single observation's raw bytes for a self-correction pattern and,
 * if one is found, call `recordCorrection` to persist the event + linked
 * health_signal.
 *
 * Only runs for `source.kind = 'claude-code'` observations; other sources
 * don't carry turn-structured hook payloads and would produce false matches.
 *
 * Called by the daemon's post-drain hook (see scheduler.ts startDrainLoop).
 * Idempotency: if the observation was already scanned (a correction_event
 * exists with matching session_id + pattern + retracted_text prefix),
 * re-scans are no-ops thanks to the UNIQUE INDEX introduced below at
 * the first live implementation's schema migration (not yet required --
 * today the only source of re-scanning would be manual operator action).
 */
export function scanObservationForCorrection(
  db: Database,
  observeId: string
): { eventId: number | null } {
  // Pull observation row + the source.kind (only claude-code carries hooks)
  const row = db
    .query(
      "SELECT o.raw_bytes, o.source_id, s.kind " +
        "FROM observations o JOIN source s ON s.id = o.source_id " +
        "WHERE o.observe_id = ?"
    )
    .get(observeId) as
    | { raw_bytes: Uint8Array | Buffer | null; source_id: string; kind: string }
    | null;

  if (!row) return { eventId: null };
  if (row.kind !== "claude-code") return { eventId: null };
  if (!row.raw_bytes) return { eventId: null };

  // source_id format: "claude-code:<session_id>:<cwd>"
  const sessionId =
    row.source_id.startsWith("claude-code:")
      ? row.source_id.split(":", 3)[1] ?? null
      : null;

  // raw_bytes is the full hook envelope JSON. bun:sqlite returns BLOB as
  // Uint8Array, not Buffer, so `toString("utf-8")` would silently return the
  // comma-joined byte list instead of decoded text. Use TextDecoder to be
  // safe across runtimes.
  let envelope: unknown;
  try {
    const text = new TextDecoder("utf-8").decode(row.raw_bytes);
    envelope = JSON.parse(text);
  } catch {
    return { eventId: null };
  }
  // Extract just the payload field -- avoid matching on hook metadata keys
  // like "hook_event_name": "UserPromptSubmit" which would never be a user
  // correction.
  const payload =
    envelope && typeof envelope === "object" && "payload" in envelope
      ? (envelope as { payload: unknown }).payload
      : envelope;
  const payloadText = JSON.stringify(payload ?? "");

  const hit = detectCorrection(payloadText);
  if (!hit) return { eventId: null };

  const { id } = recordCorrection(db, {
    sessionId,
    retractedText: hit.retractedText,
    correctedText: hit.correctedText,
    patternName: hit.patternName,
    relatedFactIds: findRelatedFacts(db, hit.retractedText, {
      sessionId: sessionId ?? undefined,
    }),
  });
  return { eventId: id };
}
