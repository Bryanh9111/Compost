import type { Database } from "bun:sqlite";

export interface ActionTimelineOptions {
  project?: string;
  sourceSystem?: string;
  limit?: number;
  now?: Date;
}

export interface ActionTimelineWindow {
  expression: string;
  label: string;
  start_ts: string;
  end_ts: string;
  timezone: "UTC";
}

export interface ActionTimelineAction {
  action_id: string;
  source_system: string;
  source_id: string;
  what_text: string;
  when_ts: string;
  project: string | null;
  artifact_locations: Record<string, unknown>;
  next_query_hint: string | null;
}

export interface CountSummary {
  key: string;
  count: number;
}

export interface DayActionGroup {
  date: string;
  count: number;
  actions: ActionTimelineAction[];
}

export interface ActionTimelineReport {
  expression: string;
  generated_at: string;
  window: ActionTimelineWindow;
  project: string | null;
  source_system: string | null;
  action_count: number;
  returned_action_count: number;
  source_counts: CountSummary[];
  project_counts: CountSummary[];
  days: DayActionGroup[];
  actions: ActionTimelineAction[];
  empty_hint: string | null;
}

interface ActionRow {
  action_id: string;
  source_system: string;
  source_id: string;
  what_text: string;
  when_ts: string;
  project: string | null;
  artifact_locations: string | null;
  next_query_hint: string | null;
}

const MAX_LIMIT = 500;
const SUMMARY_LIMIT = 20;

export function summarizeActionTimeline(
  db: Database,
  expression: string,
  opts: ActionTimelineOptions = {}
): ActionTimelineReport {
  const cleanedExpression = expression.trim();
  const now = opts.now ?? new Date();
  const window = parseActionTimelineWindow(cleanedExpression, now);
  const limit = Math.max(1, Math.min(opts.limit ?? 50, MAX_LIMIT));
  const rows = loadActions(db, {
    startTs: window.start_ts,
    endTs: window.end_ts,
    project: opts.project,
    sourceSystem: opts.sourceSystem,
    limit,
  });
  const actions = rows.map(toActionTimelineAction);
  const actionCount = countActions(db, {
    startTs: window.start_ts,
    endTs: window.end_ts,
    project: opts.project,
    sourceSystem: opts.sourceSystem,
  });

  return {
    expression: cleanedExpression,
    generated_at: now.toISOString(),
    window,
    project: opts.project ?? null,
    source_system: opts.sourceSystem ?? null,
    action_count: actionCount,
    returned_action_count: actions.length,
    source_counts: countColumn(db, "source_system", {
      startTs: window.start_ts,
      endTs: window.end_ts,
      project: opts.project,
      sourceSystem: opts.sourceSystem,
    }),
    project_counts: countColumn(db, "project", {
      startTs: window.start_ts,
      endTs: window.end_ts,
      project: opts.project,
      sourceSystem: opts.sourceSystem,
    }),
    days: groupByDay(actions),
    actions,
    empty_hint:
      actionCount === 0
        ? "No action_log entries matched this time window; verify capture hooks or backfill actions first."
        : null,
  };
}

export function parseActionTimelineWindow(
  expression: string,
  now: Date = new Date()
): ActionTimelineWindow {
  const cleaned = expression.trim();
  if (!cleaned) {
    throw new Error(
      "expected a date expression such as today, this week, or 2026-05-03"
    );
  }

  const normalized = cleaned.toLowerCase().replace(/\s+/g, " ");
  const exactDate = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (exactDate) {
    const year = Number(exactDate[1]);
    const month = Number(exactDate[2]);
    const day = Number(exactDate[3]);
    const start = new Date(Date.UTC(year, month - 1, day));
    if (
      start.getUTCFullYear() !== year ||
      start.getUTCMonth() !== month - 1 ||
      start.getUTCDate() !== day
    ) {
      throw new Error(`invalid calendar date: ${cleaned}`);
    }
    return windowFromDates(cleaned, cleaned, start, addUtcDays(start, 1));
  }

  if (normalized === "today" || normalized === "今天") {
    const start = startOfUtcDay(now);
    return windowFromDates(cleaned, "today", start, addUtcDays(start, 1));
  }

  if (normalized === "yesterday" || normalized === "昨天") {
    const end = startOfUtcDay(now);
    return windowFromDates(cleaned, "yesterday", addUtcDays(end, -1), end);
  }

  if (normalized === "this week" || normalized === "本周") {
    const start = startOfUtcIsoWeek(now);
    return windowFromDates(cleaned, "this week", start, addUtcDays(start, 7));
  }

  if (normalized === "last week" || normalized === "上周") {
    const end = startOfUtcIsoWeek(now);
    return windowFromDates(cleaned, "last week", addUtcDays(end, -7), end);
  }

  if (normalized === "this month" || normalized === "本月") {
    const start = startOfUtcMonth(now);
    return windowFromDates(cleaned, "this month", start, addUtcMonths(start, 1));
  }

  if (normalized === "last month" || normalized === "上月") {
    const end = startOfUtcMonth(now);
    return windowFromDates(cleaned, "last month", addUtcMonths(end, -1), end);
  }

  const recentDays = normalized.match(
    /^(?:last|past|最近)\s+(\d{1,3})\s+(?:days|day|天)$/
  );
  if (recentDays) {
    const days = Number(recentDays[1]);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error(`expected days between 1 and 365, got ${recentDays[1]}`);
    }
    return windowFromDates(
      cleaned,
      `last ${days} days`,
      addUtcDays(now, -days),
      now
    );
  }

  throw new Error(
    `unsupported date expression "${cleaned}"; use today, yesterday, this week, last week, this month, last month, last N days, or YYYY-MM-DD`
  );
}

export function formatActionTimeline(report: ActionTimelineReport): string {
  const lines: string[] = [];
  lines.push(`did: ${report.expression}`);
  lines.push(
    `window: ${report.window.start_ts} -> ${report.window.end_ts} (${report.window.timezone})`
  );
  if (report.project) lines.push(`project: ${report.project}`);
  if (report.source_system) lines.push(`source: ${report.source_system}`);
  lines.push(
    report.returned_action_count === report.action_count
      ? `actions: ${report.action_count}`
      : `actions: ${report.returned_action_count} returned (${report.action_count} matched)`
  );

  if (report.action_count === 0) {
    lines.push(`hint: ${report.empty_hint}`);
    return `${lines.join("\n")}\n`;
  }

  lines.push(`sources: ${formatCounts(report.source_counts)}`);
  lines.push(`projects: ${formatCounts(report.project_counts)}`);

  for (const day of report.days) {
    lines.push("");
    lines.push(`${day.date} (${day.count})`);
    for (const action of day.actions) {
      lines.push(
        `  - ${timePart(action.when_ts)} [${action.source_system}] ${truncate(action.what_text, 160)}`
      );
      lines.push(`    ref: ${action.source_id}`);
      const artifacts = formatArtifacts(action.artifact_locations);
      if (artifacts) lines.push(`    artifacts: ${artifacts}`);
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
  const where = ["when_ts >= ?", "when_ts < ?"];
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

  return db
    .query(
      `SELECT action_id, source_system, source_id, what_text, when_ts, project,
              artifact_locations, next_query_hint
       FROM action_log
       WHERE ${where.join(" AND ")}
       ORDER BY when_ts DESC, created_at DESC
       LIMIT ?`
    )
    .all(...params) as ActionRow[];
}

function countActions(
  db: Database,
  opts: {
    startTs: string;
    endTs: string;
    project?: string;
    sourceSystem?: string;
  }
): number {
  const query = buildWhere(opts);
  const row = db
    .query(`SELECT COUNT(*) AS count FROM action_log WHERE ${query.whereSql}`)
    .get(...query.params) as { count: number } | null;
  return row?.count ?? 0;
}

function countColumn(
  db: Database,
  column: "source_system" | "project",
  opts: {
    startTs: string;
    endTs: string;
    project?: string;
    sourceSystem?: string;
  }
): CountSummary[] {
  const query = buildWhere(opts);
  const keySql = column === "project" ? "COALESCE(project, '(none)')" : column;
  const rows = db
    .query(
      `SELECT ${keySql} AS key, COUNT(*) AS count
       FROM action_log
       WHERE ${query.whereSql}
       GROUP BY key
       ORDER BY count DESC, key ASC
       LIMIT ?`
    )
    .all(...query.params, SUMMARY_LIMIT) as CountSummary[];
  return rows;
}

function buildWhere(opts: {
  startTs: string;
  endTs: string;
  project?: string;
  sourceSystem?: string;
}): { whereSql: string; params: string[] } {
  const where = ["when_ts >= ?", "when_ts < ?"];
  const params = [opts.startTs, opts.endTs];
  if (opts.project) {
    where.push("project = ?");
    params.push(opts.project);
  }
  if (opts.sourceSystem) {
    where.push("source_system = ?");
    params.push(opts.sourceSystem);
  }
  return { whereSql: where.join(" AND "), params };
}

function toActionTimelineAction(row: ActionRow): ActionTimelineAction {
  return {
    action_id: row.action_id,
    source_system: row.source_system,
    source_id: row.source_id,
    what_text: row.what_text,
    when_ts: row.when_ts,
    project: row.project,
    artifact_locations: parseArtifactLocations(row.artifact_locations),
    next_query_hint: row.next_query_hint,
  };
}

function groupByDay(actions: ActionTimelineAction[]): DayActionGroup[] {
  const byDay = new Map<string, ActionTimelineAction[]>();
  for (const action of actions) {
    const day = action.when_ts.slice(0, 10);
    const group = byDay.get(day) ?? [];
    group.push(action);
    byDay.set(day, group);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dayActions]) => ({
      date,
      count: dayActions.length,
      actions: dayActions,
    }));
}

function windowFromDates(
  expression: string,
  label: string,
  start: Date,
  end: Date
): ActionTimelineWindow {
  return {
    expression,
    label,
    start_ts: start.toISOString(),
    end_ts: end.toISOString(),
    timezone: "UTC",
  };
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

function startOfUtcIsoWeek(value: Date): Date {
  const start = startOfUtcDay(value);
  const day = start.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  return addUtcDays(start, -daysSinceMonday);
}

function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function addUtcDays(value: Date, days: number): Date {
  const copy = new Date(value);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function addUtcMonths(value: Date, months: number): Date {
  const copy = new Date(value);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

function parseArtifactLocations(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return recordValue(parsed) ?? {};
  } catch {
    return {};
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatCounts(counts: CountSummary[]): string {
  return counts.length > 0
    ? counts.map((item) => `${item.key}=${item.count}`).join(", ")
    : "(none)";
}

function formatArtifacts(artifacts: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const entries = Object.entries(artifacts).sort(([a], [b]) => {
    return artifactPriority(a) - artifactPriority(b) || a.localeCompare(b);
  });
  for (const [key, value] of entries) {
    if (key === "observation" && entries.length > 1) continue;
    const formatted = formatArtifactValue(value);
    if (formatted) parts.push(`${key}=${truncate(formatted, 96)}`);
    if (parts.length >= 3) break;
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function artifactPriority(key: string): number {
  if (key === "git_ref") return 1;
  if (key === "engram_memory_uri") return 2;
  if (key === "obsidian") return 3;
  if (key === "codex_session_file") return 4;
  if (key === "claude_transcript_path") return 5;
  if (key === "file_path") return 6;
  if (key === "observation") return 99;
  return 50;
}

function formatArtifactValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const record = recordValue(value);
  if (!record) return null;
  const path =
    stringValue(record["relative_path"]) ??
    stringValue(record["path"]) ??
    stringValue(record["vault"]);
  return path ?? JSON.stringify(record);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timePart(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(11, 16);
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}
