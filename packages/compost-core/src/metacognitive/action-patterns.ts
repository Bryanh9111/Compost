import type { Database } from "bun:sqlite";
import {
  parseActionTimelineWindow,
  type ActionTimelineWindow,
} from "./action-timeline";

export type ActionPatternKind =
  | "capture_spread"
  | "work_rhythm"
  | "project_focus"
  | "project_switching"
  | "source_sequence";

export type ActionPatternConfidence = "provisional" | "medium" | "strong";

export interface ActionPatternOptions {
  project?: string;
  sourceSystem?: string;
  limit?: number;
  patternLimit?: number;
  now?: Date;
}

export interface ActionPatternEvidence {
  action_id: string;
  source_system: string;
  source_id: string;
  what_text: string;
  when_ts: string;
  project: string | null;
}

export interface ActionPattern {
  kind: ActionPatternKind;
  title: string;
  description: string;
  confidence: ActionPatternConfidence;
  support_count: number;
  support_ratio: number | null;
  evidence: ActionPatternEvidence[];
}

export interface ActionPatternReport {
  expression: string;
  generated_at: string;
  window: ActionTimelineWindow;
  project: string | null;
  source_system: string | null;
  scanned_action_count: number;
  scanned_limit: number;
  active_days: number;
  source_counts: Array<{ key: string; count: number }>;
  project_counts: Array<{ key: string; count: number }>;
  patterns: ActionPattern[];
  empty_hint: string | null;
  provisional_hint: string | null;
}

interface ActionRow {
  action_id: string;
  source_system: string;
  source_id: string;
  what_text: string;
  when_ts: string;
  project: string | null;
}

const MAX_SCAN_LIMIT = 20_000;
const MAX_PATTERN_LIMIT = 50;
const SUMMARY_LIMIT = 20;
const EVIDENCE_LIMIT = 3;

export function detectActionPatterns(
  db: Database,
  expression: string,
  opts: ActionPatternOptions = {}
): ActionPatternReport {
  const cleanedExpression = expression.trim();
  const now = opts.now ?? new Date();
  const window = parseActionTimelineWindow(cleanedExpression, now);
  const scanLimit = Math.max(1, Math.min(opts.limit ?? 5000, MAX_SCAN_LIMIT));
  const patternLimit = Math.max(
    1,
    Math.min(opts.patternLimit ?? 8, MAX_PATTERN_LIMIT)
  );
  const rows = loadActions(db, {
    startTs: window.start_ts,
    endTs: window.end_ts,
    project: opts.project,
    sourceSystem: opts.sourceSystem,
    limit: scanLimit,
  });
  const activeDays = new Set(rows.map((row) => dayPart(row.when_ts))).size;
  const context = { total: rows.length, activeDays };
  const patterns = [
    captureSpreadPattern(rows, context),
    workRhythmPattern(rows, context),
    projectFocusPattern(rows, context),
    projectSwitchingPattern(rows, context),
    sourceSequencePattern(rows, context),
  ]
    .filter((pattern): pattern is ActionPattern => pattern !== null)
    .sort((a, b) => {
      const confidenceDelta =
        confidenceRank(b.confidence) - confidenceRank(a.confidence);
      if (confidenceDelta !== 0) return confidenceDelta;
      if (b.support_count !== a.support_count) {
        return b.support_count - a.support_count;
      }
      return a.kind.localeCompare(b.kind);
    })
    .slice(0, patternLimit);

  return {
    expression: cleanedExpression,
    generated_at: now.toISOString(),
    window,
    project: opts.project ?? null,
    source_system: opts.sourceSystem ?? null,
    scanned_action_count: rows.length,
    scanned_limit: scanLimit,
    active_days: activeDays,
    source_counts: countBy(rows, (row) => row.source_system),
    project_counts: countBy(rows, (row) => row.project ?? "(none)"),
    patterns,
    empty_hint:
      rows.length === 0
        ? "No action_log entries matched this time window; keep capture running or choose a wider window."
        : null,
    provisional_hint:
      rows.length > 0 && activeDays < 7
        ? "Patterns are provisional until the window has at least 7 active days of action_log data."
        : null,
  };
}

export function formatActionPatterns(report: ActionPatternReport): string {
  const lines: string[] = [];
  lines.push(`patterns: ${report.expression}`);
  lines.push(
    `window: ${report.window.start_ts} -> ${report.window.end_ts} (${report.window.timezone})`
  );
  if (report.project) lines.push(`project: ${report.project}`);
  if (report.source_system) lines.push(`source: ${report.source_system}`);
  lines.push(`scanned: ${report.scanned_action_count}`);
  lines.push(`active_days: ${report.active_days}`);

  if (report.scanned_action_count === 0) {
    lines.push(`hint: ${report.empty_hint}`);
    return `${lines.join("\n")}\n`;
  }

  lines.push(`sources: ${formatCounts(report.source_counts)}`);
  lines.push(`projects: ${formatCounts(report.project_counts)}`);
  if (report.provisional_hint) {
    lines.push(`status: provisional`);
    lines.push(`hint: ${report.provisional_hint}`);
  }

  if (report.patterns.length === 0) {
    lines.push(`patterns_found: 0`);
    lines.push(`hint: Need more repeated action sequences before reporting patterns.`);
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  lines.push(`patterns_found: ${report.patterns.length}`);
  for (const pattern of report.patterns) {
    lines.push(
      `  - [${pattern.kind}] ${pattern.title} (${pattern.confidence}, n=${pattern.support_count})`
    );
    lines.push(`    ${pattern.description}`);
    for (const evidence of pattern.evidence) {
      lines.push(
        `    evidence: ${evidence.when_ts} [${evidence.source_system}] ${truncate(evidence.what_text, 120)}`
      );
      lines.push(`      ref: ${evidence.source_id}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function loadActions(
  db: Database,
  opts: {
    startTs: string;
    endTs: string;
    project?: string;
    sourceSystem?: string;
    limit: number;
  }
): ActionRow[] {
  const where = [
    "julianday(when_ts) >= julianday(?)",
    "julianday(when_ts) < julianday(?)",
  ];
  const params: Array<string | number> = [opts.startTs, opts.endTs];
  if (opts.project) {
    where.push("project = ?");
    params.push(opts.project);
  }
  if (opts.sourceSystem) {
    where.push("source_system = ?");
    params.push(opts.sourceSystem);
  }
  params.push(opts.limit);

  const recentRows = db
    .query(
      `SELECT action_id, source_system, source_id, what_text, when_ts, project
       FROM action_log
       WHERE ${where.join(" AND ")}
       ORDER BY julianday(when_ts) DESC, created_at DESC
       LIMIT ?`
    )
    .all(...params) as ActionRow[];
  return recentRows.sort(compareActionsAscending);
}

function captureSpreadPattern(
  rows: ActionRow[],
  context: { total: number; activeDays: number }
): ActionPattern | null {
  const sourceCounts = countBy(rows, (row) => row.source_system);
  if (sourceCounts.length < 2) return null;
  const topSources = sourceCounts.slice(0, 5).map((item) => item.key);
  return {
    kind: "capture_spread",
    title: `${sourceCounts.length} action sources captured`,
    description: `action_log contains ${sourceCounts.length} sources in this window: ${topSources.join(", ")}.`,
    confidence: confidenceFor(context, sourceCounts.length >= 4 ? 10 : 20),
    support_count: context.total,
    support_ratio: 1,
    evidence: sampleEvidence(rows),
  };
}

function workRhythmPattern(
  rows: ActionRow[],
  context: { total: number; activeDays: number }
): ActionPattern | null {
  if (rows.length < 3) return null;
  const hourly = countBy(rows, (row) => hourPart(row.when_ts));
  const top = hourly[0];
  if (!top) return null;
  const ratio = top.count / rows.length;
  if (top.count < 3 || ratio < 0.2) return null;
  const evidence = sampleEvidence(
    rows.filter((row) => hourPart(row.when_ts) === top.key)
  );
  return {
    kind: "work_rhythm",
    title: `peak action hour ${top.key}:00 UTC`,
    description: `${top.count} of ${rows.length} scanned actions happened during ${top.key}:00-${top.key}:59 UTC.`,
    confidence: confidenceFor(context, 10),
    support_count: top.count,
    support_ratio: roundRatio(ratio),
    evidence,
  };
}

function projectFocusPattern(
  rows: ActionRow[],
  context: { total: number; activeDays: number }
): ActionPattern | null {
  const projectCounts = countBy(rows, (row) => row.project ?? "(none)");
  const top = projectCounts[0];
  if (!top || top.key === "(none)") return null;
  const ratio = top.count / rows.length;
  if (top.count < 3 || ratio < 0.25) return null;
  const evidence = sampleEvidence(
    rows.filter((row) => (row.project ?? "(none)") === top.key)
  );
  return {
    kind: "project_focus",
    title: `dominant project ${top.key}`,
    description: `${top.key} accounts for ${top.count} of ${rows.length} scanned actions (${Math.round(ratio * 100)}%).`,
    confidence: confidenceFor(context, 12),
    support_count: top.count,
    support_ratio: roundRatio(ratio),
    evidence,
  };
}

function projectSwitchingPattern(
  rows: ActionRow[],
  context: { total: number; activeDays: number }
): ActionPattern | null {
  let switches = 0;
  const examples: ActionRow[] = [];
  let previous = rows[0];
  for (const row of rows.slice(1)) {
    const prevProject = previous?.project ?? "(none)";
    const nextProject = row.project ?? "(none)";
    if (prevProject !== nextProject) {
      switches += 1;
      if (examples.length < EVIDENCE_LIMIT) examples.push(row);
    }
    previous = row;
  }
  if (switches < 3) return null;
  const ratio = rows.length > 1 ? switches / (rows.length - 1) : 0;
  return {
    kind: "project_switching",
    title: `${switches} project switches`,
    description: `Chronological action flow crossed project boundaries ${switches} times in ${rows.length} scanned actions.`,
    confidence: confidenceFor(context, 15),
    support_count: switches,
    support_ratio: roundRatio(ratio),
    evidence: sampleEvidence(examples.length > 0 ? examples : rows),
  };
}

function sourceSequencePattern(
  rows: ActionRow[],
  context: { total: number; activeDays: number }
): ActionPattern | null {
  const pairs = new Map<string, { count: number; rows: ActionRow[] }>();
  let previous = rows[0];
  for (const row of rows.slice(1)) {
    if (!previous || previous.source_system === row.source_system) {
      previous = row;
      continue;
    }
    const key = `${previous.source_system} -> ${row.source_system}`;
    const item = pairs.get(key) ?? { count: 0, rows: [] };
    item.count += 1;
    if (item.rows.length < EVIDENCE_LIMIT) item.rows.push(row);
    pairs.set(key, item);
    previous = row;
  }
  const top = [...pairs.entries()].sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    return a[0].localeCompare(b[0]);
  })[0];
  if (!top || top[1].count < 2) return null;
  const ratio = rows.length > 1 ? top[1].count / (rows.length - 1) : 0;
  return {
    kind: "source_sequence",
    title: `common source transition ${top[0]}`,
    description: `${top[0]} appeared ${top[1].count} times as adjacent chronological actions.`,
    confidence: confidenceFor(context, 12),
    support_count: top[1].count,
    support_ratio: roundRatio(ratio),
    evidence: sampleEvidence(top[1].rows),
  };
}

function compareActionsAscending(a: ActionRow, b: ActionRow): number {
  const aTime = Date.parse(a.when_ts);
  const bTime = Date.parse(b.when_ts);
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return aTime - bTime;
  }
  if (a.when_ts !== b.when_ts) return a.when_ts.localeCompare(b.when_ts);
  return a.action_id.localeCompare(b.action_id);
}

function confidenceFor(
  context: { total: number; activeDays: number },
  strongCount: number
): ActionPatternConfidence {
  if (context.activeDays >= 14 && context.total >= strongCount * 2) {
    return "strong";
  }
  if (context.activeDays >= 7 && context.total >= strongCount) {
    return "medium";
  }
  return "provisional";
}

function confidenceRank(value: ActionPatternConfidence): number {
  if (value === "strong") return 3;
  if (value === "medium") return 2;
  return 1;
}

function countBy<T>(
  items: T[],
  keyFor: (item: T) => string
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.key.localeCompare(b.key);
    })
    .slice(0, SUMMARY_LIMIT);
}

function sampleEvidence(rows: ActionRow[]): ActionPatternEvidence[] {
  return rows.slice(0, EVIDENCE_LIMIT).map((row) => ({
    action_id: row.action_id,
    source_system: row.source_system,
    source_id: row.source_id,
    what_text: row.what_text,
    when_ts: row.when_ts,
    project: row.project,
  }));
}

function dayPart(value: string): string {
  return value.slice(0, 10);
}

function hourPart(value: string): string {
  const match = value.match(/^\d{4}-\d{2}-\d{2}[ T](\d{2})/);
  return match?.[1] ?? "unknown";
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function formatCounts(counts: Array<{ key: string; count: number }>): string {
  return counts.length > 0
    ? counts.map((item) => `${item.key}=${item.count}`).join(", ")
    : "(none)";
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}
