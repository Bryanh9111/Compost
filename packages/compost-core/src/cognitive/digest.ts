import type { Database } from "bun:sqlite";
import { CONFIDENCE_FLOORS } from "./audit";

/**
 * Phase 6 P0 slice 2 — Proactive push digest (Round A: selector + renderer).
 *
 * Deterministic selector over the current ledger that surfaces "noteworthy"
 * state changes in the last N days:
 *   1. new confident facts (unarchived + not superseded, >= confidence floor)
 *   2. resolved gaps (open_problems transitioned to `resolved`)
 *   3. wiki pages (re)synthesized
 *
 * Dry-run only in this slice — no Engram push. `digestInsightInput()` shapes
 * the report into SplitOptions-compatible input so Round B can wire it to
 * `EngramWriter.writeInsight()` without reshaping here.
 */

export type DigestKind = "new_fact" | "resolved_gap" | "wiki_rebuild";

export interface DigestItem {
  kind: DigestKind;
  id: string;
  headline: string;
  at: string;
  refs: {
    fact_id?: string;
    problem_id?: string;
    wiki_path?: string;
  };
}

export interface DigestWindow {
  sinceIso: string;
  untilIso: string;
}

export interface DigestReport {
  window: DigestWindow;
  generated_at: string;
  items: DigestItem[];
  new_facts: DigestItem[];
  resolved_gaps: DigestItem[];
  wiki_rebuilds: DigestItem[];
}

export interface SelectDigestOptions {
  sinceDays?: number;
  now?: Date;
  confidenceFloor?: number;
  maxItems?: number;
}

const DEFAULT_SINCE_DAYS = 7;
const DEFAULT_MAX_ITEMS = 25;

// SQLite datetime('now') stores "YYYY-MM-DD HH:MM:SS" text. Convert the ISO
// boundary we use in JS-land so lexicographic >= compares correctly.
function toSqliteDatetime(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

export function buildDigest(
  db: Database,
  opts: SelectDigestOptions = {}
): DigestReport {
  const now = opts.now ?? new Date();
  const sinceDays = opts.sinceDays ?? DEFAULT_SINCE_DAYS;
  const confidenceFloor = opts.confidenceFloor ?? CONFIDENCE_FLOORS.exploration;
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS;

  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - sinceDays);
  const sinceIso = since.toISOString();
  const untilIso = now.toISOString();
  const sinceSqlite = toSqliteDatetime(sinceIso);

  const new_facts = selectNewFacts(db, sinceSqlite, confidenceFloor, maxItems);
  const resolved_gaps = selectResolvedGaps(db, sinceSqlite, maxItems);
  const wiki_rebuilds = selectWikiRebuilds(db, sinceSqlite, maxItems);

  const items = [...new_facts, ...resolved_gaps, ...wiki_rebuilds];

  return {
    window: { sinceIso, untilIso },
    generated_at: untilIso,
    items,
    new_facts,
    resolved_gaps,
    wiki_rebuilds,
  };
}

function selectNewFacts(
  db: Database,
  sinceSqlite: string,
  confidenceFloor: number,
  limit: number
): DigestItem[] {
  const rows = db
    .query(
      `SELECT fact_id, subject, predicate, object, confidence, importance, created_at
         FROM facts
        WHERE archived_at IS NULL
          AND superseded_by IS NULL
          AND confidence >= ?
          AND created_at >= ?
        ORDER BY importance DESC, created_at DESC
        LIMIT ?`
    )
    .all(confidenceFloor, sinceSqlite, limit) as Array<{
    fact_id: string;
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
    importance: number;
    created_at: string;
  }>;

  return rows.map((r) => ({
    kind: "new_fact" as const,
    id: r.fact_id,
    headline: `${r.subject} ${r.predicate} ${r.object} (conf=${r.confidence.toFixed(2)})`,
    at: r.created_at,
    refs: { fact_id: r.fact_id },
  }));
}

function selectResolvedGaps(
  db: Database,
  sinceSqlite: string,
  limit: number
): DigestItem[] {
  const rows = db
    .query(
      `SELECT problem_id, question, ask_count, resolved_at,
              resolved_by_fact_id
         FROM open_problems
        WHERE status = 'resolved'
          AND resolved_at IS NOT NULL
          AND resolved_at >= ?
        ORDER BY ask_count DESC, resolved_at DESC
        LIMIT ?`
    )
    .all(sinceSqlite, limit) as Array<{
    problem_id: string;
    question: string;
    ask_count: number;
    resolved_at: string;
    resolved_by_fact_id: string | null;
  }>;

  return rows.map((r) => ({
    kind: "resolved_gap" as const,
    id: r.problem_id,
    headline: `asked ${r.ask_count}x "${r.question}" (resolved)`,
    at: r.resolved_at,
    refs: {
      problem_id: r.problem_id,
      ...(r.resolved_by_fact_id ? { fact_id: r.resolved_by_fact_id } : {}),
    },
  }));
}

function selectWikiRebuilds(
  db: Database,
  sinceSqlite: string,
  limit: number
): DigestItem[] {
  const rows = db
    .query(
      `SELECT path, title, last_synthesis_at
         FROM wiki_pages
        WHERE last_synthesis_at >= ?
        ORDER BY last_synthesis_at DESC
        LIMIT ?`
    )
    .all(sinceSqlite, limit) as Array<{
    path: string;
    title: string;
    last_synthesis_at: string;
  }>;

  return rows.map((r) => ({
    kind: "wiki_rebuild" as const,
    id: r.path,
    headline: `${r.title} (${r.path}) rebuilt`,
    at: r.last_synthesis_at,
    refs: { wiki_path: r.path },
  }));
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

export function renderDigestMarkdown(report: DigestReport): string {
  const dateRange = `${report.window.sinceIso.slice(0, 10)} to ${report.window.untilIso.slice(0, 10)}`;
  const lines: string[] = [`# Compost Digest — ${dateRange}`, ""];

  if (report.items.length === 0) {
    lines.push("(no items)");
    return lines.join("\n") + "\n";
  }

  if (report.new_facts.length > 0) {
    lines.push(`## New confident facts (${report.new_facts.length})`, "");
    for (const f of report.new_facts) lines.push(`- ${f.headline}`);
    lines.push("");
  }

  if (report.resolved_gaps.length > 0) {
    lines.push(`## Resolved gaps (${report.resolved_gaps.length})`, "");
    for (const g of report.resolved_gaps) lines.push(`- ${g.headline}`);
    lines.push("");
  }

  if (report.wiki_rebuilds.length > 0) {
    lines.push(`## Wiki pages rebuilt (${report.wiki_rebuilds.length})`, "");
    for (const w of report.wiki_rebuilds) lines.push(`- ${w.headline}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Shape report into SplitOptions-compatible input for Round B push wiring
// ---------------------------------------------------------------------------

export interface DigestInsightInput {
  compostFactIds: string[];
  content: string;
  synthesizedAt: string;
}

export function digestInsightInput(
  report: DigestReport
): DigestInsightInput | null {
  if (report.items.length === 0) return null;

  const factIds = new Set<string>();
  for (const item of [...report.new_facts, ...report.resolved_gaps]) {
    if (item.refs.fact_id) factIds.add(item.refs.fact_id);
  }
  if (factIds.size === 0) return null;

  return {
    compostFactIds: [...factIds].sort(),
    content: renderDigestMarkdown(report),
    synthesizedAt: report.generated_at,
  };
}
