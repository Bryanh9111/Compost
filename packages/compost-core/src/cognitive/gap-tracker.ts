import type { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { v7 as uuidv7 } from "uuid";

/**
 * Gap tracker — records user questions Compost could not answer with
 * high confidence, for Phase 6 Curiosity policies and user review.
 * Schema: packages/compost-core/src/schema/0016_open_problems.sql
 */

export type OpenProblemStatus = "open" | "resolved" | "dismissed";

export interface OpenProblem {
  problem_id: string;
  question: string;
  question_hash: string;
  status: OpenProblemStatus;
  ask_count: number;
  first_asked_at: string;
  last_asked_at: string;
  last_answer_confidence: number | null;
  last_observation_ids: string | null;
  resolved_at: string | null;
  resolved_by_observation_id: string | null;
  resolved_by_fact_id: string | null;
  tags: string | null;
}

export interface LogGapOptions {
  confidence?: number;
  observationIds?: string[];
  tags?: string[];
}

export interface ListGapsOptions {
  status?: OpenProblemStatus;
  since?: string;
  limit?: number;
}

/**
 * Normalize a question for hash-based dedupe: lowercase, collapse
 * whitespace, strip trailing punctuation. Does NOT strip stopwords or
 * stem — "what is X?" and "what was X?" must remain distinct (tense is
 * a real signal) while "What  is X??" and "what is x" collapse.
 */
export function normalizeQuestion(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?!.,;:]+$/g, "")
    .trim();
}

export function questionHash(raw: string): string {
  return createHash("sha256").update(normalizeQuestion(raw)).digest("hex");
}

/**
 * Upsert semantics: if a row with the same question_hash exists, bump
 * ask_count + update last_asked_at + last_answer_confidence +
 * last_observation_ids. Otherwise insert a fresh 'open' row.
 *
 * Does NOT resurrect a 'dismissed' / 'resolved' row — re-asking a
 * dismissed question updates ask_count on the dismissed row so we know
 * the user is still curious, but does not flip status back to 'open'.
 * Callers that want to re-open a dismissed gap must do so explicitly.
 */
export function logGap(
  db: Database,
  question: string,
  opts: LogGapOptions = {}
): OpenProblem {
  const hash = questionHash(question);
  const existing = db
    .query("SELECT * FROM open_problems WHERE question_hash = ?")
    .get(hash) as OpenProblem | undefined;

  const observationIdsJson = opts.observationIds
    ? JSON.stringify(opts.observationIds)
    : null;
  const tagsJson = opts.tags ? JSON.stringify(opts.tags) : null;

  if (existing) {
    db.run(
      `UPDATE open_problems
         SET ask_count = ask_count + 1,
             last_asked_at = datetime('now'),
             last_answer_confidence = ?,
             last_observation_ids = ?,
             tags = COALESCE(?, tags)
       WHERE problem_id = ?`,
      [
        opts.confidence ?? null,
        observationIdsJson,
        tagsJson,
        existing.problem_id,
      ]
    );
    return getById(db, existing.problem_id)!;
  }

  const id = uuidv7();
  db.run(
    `INSERT INTO open_problems
       (problem_id, question, question_hash, status, ask_count,
        last_answer_confidence, last_observation_ids, tags)
     VALUES (?, ?, ?, 'open', 1, ?, ?, ?)`,
    [id, question, hash, opts.confidence ?? null, observationIdsJson, tagsJson]
  );
  return getById(db, id)!;
}

export function listGaps(
  db: Database,
  opts: ListGapsOptions = {}
): OpenProblem[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    where.push("status = ?");
    params.push(opts.status);
  }
  if (opts.since) {
    where.push("last_asked_at >= ?");
    params.push(opts.since);
  }
  const whereSql = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
  const limitSql = opts.limit ? ` LIMIT ${opts.limit | 0}` : "";
  return db
    .query(
      `SELECT * FROM open_problems${whereSql}
       ORDER BY
         CASE status WHEN 'open' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
         ask_count DESC,
         last_asked_at DESC${limitSql}`
    )
    .all(...(params as [])) as OpenProblem[];
}

export function getById(db: Database, id: string): OpenProblem | null {
  return (
    (db
      .query("SELECT * FROM open_problems WHERE problem_id = ?")
      .get(id) as OpenProblem | undefined) ?? null
  );
}

export function getByQuestion(
  db: Database,
  question: string
): OpenProblem | null {
  return (
    (db
      .query("SELECT * FROM open_problems WHERE question_hash = ?")
      .get(questionHash(question)) as OpenProblem | undefined) ?? null
  );
}

/** Hard delete. User explicitly doesn't want to see this again. */
export function forgetGap(db: Database, id: string): boolean {
  const { changes } = db.run("DELETE FROM open_problems WHERE problem_id = ?", [
    id,
  ]);
  return Number(changes) > 0;
}

/**
 * Mark as dismissed without deletion — preserves ask history so later
 * analytics can distinguish "gap user didn't care about" from "gap
 * forgotten entirely". Phase 6 Curiosity policies should ignore
 * dismissed gaps.
 */
export function dismissGap(db: Database, id: string): boolean {
  const { changes } = db.run(
    `UPDATE open_problems
       SET status = 'dismissed'
     WHERE problem_id = ? AND status = 'open'`,
    [id]
  );
  return Number(changes) > 0;
}

export interface ResolveGapOptions {
  observationId?: string;
  factId?: string;
}

export function resolveGap(
  db: Database,
  id: string,
  opts: ResolveGapOptions = {}
): boolean {
  const { changes } = db.run(
    `UPDATE open_problems
       SET status = 'resolved',
           resolved_at = datetime('now'),
           resolved_by_observation_id = ?,
           resolved_by_fact_id = ?
     WHERE problem_id = ? AND status = 'open'`,
    [opts.observationId ?? null, opts.factId ?? null, id]
  );
  return Number(changes) > 0;
}

export interface GapStats {
  open: number;
  resolved: number;
  dismissed: number;
  total_asks: number;
}

export function gapStats(db: Database): GapStats {
  const row = db
    .query(
      `SELECT
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
         SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed,
         COALESCE(SUM(ask_count), 0) AS total_asks
       FROM open_problems`
    )
    .get() as {
    open: number | null;
    resolved: number | null;
    dismissed: number | null;
    total_asks: number;
  };
  return {
    open: row.open ?? 0,
    resolved: row.resolved ?? 0,
    dismissed: row.dismissed ?? 0,
    total_asks: row.total_asks,
  };
}
