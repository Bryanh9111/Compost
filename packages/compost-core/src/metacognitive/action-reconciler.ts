import type { Database } from "bun:sqlite";
import {
  parseActionTimelineWindow,
  type ActionTimelineWindow,
} from "./action-timeline";

export type ActionReconcileIssueKind =
  | "missing_git_ref"
  | "missing_obsidian_pointer"
  | "missing_engram_memory_uri"
  | "missing_durable_pointer";

export type ActionReconcileSeverity = "warning" | "error";

export interface ActionReconcileOptions {
  project?: string;
  sourceSystem?: string;
  limit?: number;
  issueLimit?: number;
  now?: Date;
}

export interface ActionReconcileIssue {
  kind: ActionReconcileIssueKind;
  severity: ActionReconcileSeverity;
  action_id: string;
  source_system: string;
  source_id: string;
  what_text: string;
  when_ts: string;
  project: string | null;
  missing_system: "git" | "obsidian" | "engram" | "artifact";
  reason: string;
  next_step: string;
}

export interface ActionReconcileReport {
  expression: string;
  generated_at: string;
  window: ActionTimelineWindow;
  project: string | null;
  source_system: string | null;
  scanned_actions: number;
  scanned_limit: number;
  issue_count: number;
  returned_issue_count: number;
  ok: boolean;
  by_kind: Array<{ key: ActionReconcileIssueKind; count: number }>;
  by_source: Array<{ key: string; count: number }>;
  issues: ActionReconcileIssue[];
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
}

interface ReconcileCandidate extends ActionRow {
  parsed_artifact_locations: Record<string, unknown>;
}

const MAX_SCAN_LIMIT = 10_000;
const MAX_ISSUE_LIMIT = 500;

export function reconcileActionPointers(
  db: Database,
  expression: string,
  opts: ActionReconcileOptions = {}
): ActionReconcileReport {
  const cleanedExpression = expression.trim();
  const now = opts.now ?? new Date();
  const window = parseActionTimelineWindow(cleanedExpression, now);
  const scanLimit = Math.max(1, Math.min(opts.limit ?? 1000, MAX_SCAN_LIMIT));
  const issueLimit = Math.max(
    1,
    Math.min(opts.issueLimit ?? 50, MAX_ISSUE_LIMIT)
  );
  const rows = loadActions(db, {
    startTs: window.start_ts,
    endTs: window.end_ts,
    project: opts.project,
    sourceSystem: opts.sourceSystem,
    limit: scanLimit,
  }).map(toCandidate);
  const allIssues = rows.flatMap(issuesForAction);

  return {
    expression: cleanedExpression,
    generated_at: now.toISOString(),
    window,
    project: opts.project ?? null,
    source_system: opts.sourceSystem ?? null,
    scanned_actions: rows.length,
    scanned_limit: scanLimit,
    issue_count: allIssues.length,
    returned_issue_count: Math.min(allIssues.length, issueLimit),
    ok: allIssues.length === 0,
    by_kind: countBy(allIssues, (issue) => issue.kind),
    by_source: countBy(allIssues, (issue) => issue.source_system),
    issues: allIssues.slice(0, issueLimit),
    empty_hint:
      rows.length === 0
        ? "No action_log entries matched this time window."
        : allIssues.length === 0
          ? "No missing Engram/Obsidian/git/durable pointers found in scanned actions."
          : null,
  };
}

export function formatActionReconcile(report: ActionReconcileReport): string {
  const lines: string[] = [];
  lines.push(`reconcile: ${report.expression}`);
  lines.push(
    `window: ${report.window.start_ts} -> ${report.window.end_ts} (${report.window.timezone})`
  );
  if (report.project) lines.push(`project: ${report.project}`);
  if (report.source_system) lines.push(`source: ${report.source_system}`);
  lines.push(`scanned: ${report.scanned_actions}`);
  lines.push(
    report.returned_issue_count === report.issue_count
      ? `issues: ${report.issue_count}`
      : `issues: ${report.returned_issue_count} returned (${report.issue_count} found)`
  );

  if (report.issue_count === 0) {
    lines.push(`status: ok`);
    if (report.empty_hint) lines.push(`hint: ${report.empty_hint}`);
    return `${lines.join("\n")}\n`;
  }

  lines.push(`by_kind: ${formatCounts(report.by_kind)}`);
  lines.push(`by_source: ${formatCounts(report.by_source)}`);
  lines.push("");
  lines.push("missing pointers:");
  for (const issue of report.issues) {
    lines.push(
      `  - [${issue.kind}] ${issue.when_ts} ${issue.action_id} [${issue.source_system}] ${truncate(issue.what_text, 160)}`
    );
    lines.push(`    missing: ${issue.missing_system}; ${issue.reason}`);
    lines.push(`    next: ${issue.next_step}`);
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
              artifact_locations
       FROM action_log
       WHERE ${where.join(" AND ")}
       ORDER BY when_ts DESC, created_at DESC
       LIMIT ?`
    )
    .all(...params) as ActionRow[];
}

function toCandidate(row: ActionRow): ReconcileCandidate {
  return {
    ...row,
    parsed_artifact_locations: parseArtifactLocations(row.artifact_locations),
  };
}

function issuesForAction(action: ReconcileCandidate): ActionReconcileIssue[] {
  const out: ActionReconcileIssue[] = [];
  const locations = action.parsed_artifact_locations;

  if (action.source_system === "git" && !hasGitPointer(locations)) {
    out.push(
      issue(
        action,
        "missing_git_ref",
        "error",
        "git",
        "git action has no git_ref artifact pointer",
        "rerun `compost capture git` for the commit or backfill artifact_locations.git_ref"
      )
    );
  }

  if (action.source_system === "obsidian" && !hasObsidianPointer(locations)) {
    out.push(
      issue(
        action,
        "missing_obsidian_pointer",
        "error",
        "obsidian",
        "Obsidian action has no vault/path artifact pointer",
        "rerun the Obsidian watcher or backfill artifact_locations.obsidian with vault/path metadata"
      )
    );
  }

  if (action.source_system === "engram" && !hasEngramPointer(locations)) {
    out.push(
      issue(
        action,
        "missing_engram_memory_uri",
        "error",
        "engram",
        "Engram action has no engram_memory_uri artifact pointer",
        "backfill artifact_locations.engram_memory_uri with the canonical Engram memory URI"
      )
    );
  }

  if (shouldRequireDurablePointer(action) && !hasDurablePointer(locations)) {
    out.push(
      issue(
        action,
        "missing_durable_pointer",
        "warning",
        "artifact",
        "action has no durable artifact pointer beyond the raw observation",
        "add the canonical artifact pointer, or use `compost route`/`compost cover` to locate and link it"
      )
    );
  }

  return out;
}

function issue(
  action: ReconcileCandidate,
  kind: ActionReconcileIssueKind,
  severity: ActionReconcileSeverity,
  missingSystem: ActionReconcileIssue["missing_system"],
  reason: string,
  nextStep: string
): ActionReconcileIssue {
  return {
    kind,
    severity,
    action_id: action.action_id,
    source_system: action.source_system,
    source_id: action.source_id,
    what_text: action.what_text,
    when_ts: action.when_ts,
    project: action.project,
    missing_system: missingSystem,
    reason,
    next_step: nextStep,
  };
}

function hasGitPointer(locations: Record<string, unknown>): boolean {
  return stringValue(locations["git_ref"]) !== null;
}

function hasEngramPointer(locations: Record<string, unknown>): boolean {
  return stringValue(locations["engram_memory_uri"]) !== null;
}

function hasObsidianPointer(locations: Record<string, unknown>): boolean {
  const obsidian = recordValue(locations["obsidian"]);
  if (!obsidian) return false;
  return (
    stringValue(obsidian["vault"]) !== null ||
    stringValue(obsidian["relative_path"]) !== null ||
    stringValue(obsidian["path"]) !== null
  );
}

function hasDurablePointer(locations: Record<string, unknown>): boolean {
  return (
    hasGitPointer(locations) ||
    hasEngramPointer(locations) ||
    hasObsidianPointer(locations) ||
    stringValue(locations["codex_session_file"]) !== null ||
    stringValue(locations["claude_transcript_path"]) !== null ||
    stringValue(locations["file_path"]) !== null
  );
}

function shouldRequireDurablePointer(action: ReconcileCandidate): boolean {
  return new Set(["codex", "claude-code", "local-file"]).has(
    action.source_system
  );
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

function countBy<T, K extends string>(
  items: T[],
  keyFor: (item: T) => K
): Array<{ key: K; count: number }> {
  const counts = new Map<K, number>();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.key.localeCompare(b.key);
    });
}

function formatCounts<T extends string>(
  counts: Array<{ key: T; count: number }>
): string {
  return counts.length > 0
    ? counts.map((item) => `${item.key}=${item.count}`).join(", ")
    : "(none)";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}
