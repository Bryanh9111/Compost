import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { tokenizeQuestion } from "../cognitive/curiosity";

export type CoverageMode = "topic" | "timeline";

export type CoverageSystemId =
  | "action_log"
  | "engram"
  | "roadmap"
  | "obsidian"
  | "git"
  | "codex"
  | "claude-code"
  | "zsh"
  | "local-file"
  | "web";

export interface CoverageAuditOptions {
  project?: string;
  sinceDays?: number;
  limit?: number;
  repoRoot?: string;
  includeDocs?: boolean;
  now?: Date;
}

export interface CoverageEvidence {
  system: CoverageSystemId;
  kind: "action" | "doc";
  ref: string;
  label: string;
  when_ts?: string;
  project?: string | null;
  score: number;
}

export interface CoverageAction {
  action_id: string;
  source_system: string;
  source_id: string;
  what_text: string;
  when_ts: string;
  project: string | null;
  artifact_locations: Record<string, unknown>;
  score: number;
}

export interface CoverageSystemReport {
  system: CoverageSystemId;
  present: boolean;
  evidence_count: number;
  evidence: CoverageEvidence[];
}

export interface CoverageGap {
  system: CoverageSystemId;
  reason: string;
  next_step: string;
}

export interface CoverageAuditReport {
  query: string;
  mode: CoverageMode;
  generated_at: string;
  since_ts: string | null;
  project: string | null;
  matched_actions: CoverageAction[];
  systems: CoverageSystemReport[];
  gaps: CoverageGap[];
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

const SYSTEM_ORDER: CoverageSystemId[] = [
  "action_log",
  "engram",
  "roadmap",
  "obsidian",
  "git",
  "codex",
  "claude-code",
  "zsh",
  "local-file",
  "web",
];

const DEFAULT_EXPECTED: CoverageSystemId[] = [
  "action_log",
  "engram",
  "roadmap",
  "obsidian",
  "git",
];

const DOC_PATHS = [
  "README.md",
  "docs/ROADMAP.md",
  "docs/metacognitive-direction.md",
  "docs/ARCHITECTURE.md",
  "docs/CONCEPTS.md",
];

export function auditCoverage(
  db: Database,
  query: string,
  opts: CoverageAuditOptions = {}
): CoverageAuditReport {
  const cleanedQuery = query.trim();
  const now = opts.now ?? new Date();
  const mode = isTimelineQuery(cleanedQuery) ? "timeline" : "topic";
  const sinceDays = opts.sinceDays ?? (mode === "timeline" ? 7 : undefined);
  const sinceTs = sinceDays ? daysAgo(now, sinceDays).toISOString() : null;
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 200));
  const tokens = mode === "timeline" ? [] : tokenizeCoverageQuery(cleanedQuery);

  const rows = loadCandidateActions(db, {
    project: opts.project,
    sinceTs,
    limit: mode === "timeline" ? limit : 1000,
  });

  const scoredActions = rows
    .map((row) => {
      const artifactLocations = parseArtifactLocations(row.artifact_locations);
      const haystack = [
        row.source_system,
        row.source_id,
        row.project ?? "",
        row.what_text,
        row.next_query_hint ?? "",
        JSON.stringify(artifactLocations),
      ].join(" ");
      const score =
        mode === "timeline" ? 1 : scoreText(haystack, cleanedQuery, tokens);
      return toCoverageAction(row, artifactLocations, score);
    })
    .filter((action) => action.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.when_ts.localeCompare(a.when_ts);
    })
    .slice(0, limit);

  const evidence: CoverageEvidence[] = [];
  for (const action of scoredActions) {
    evidence.push(...evidenceForAction(action));
  }

  if (opts.includeDocs !== false) {
    evidence.push(
      ...scanRepoDocs(opts.repoRoot ?? process.cwd(), cleanedQuery, tokens)
    );
  }

  const systems = buildSystemReports(evidence);
  const gaps = DEFAULT_EXPECTED
    .filter((system) => !systems.find((s) => s.system === system)?.present)
    .map((system) => ({
      system,
      reason: `no ${system} evidence matched this query`,
      next_step: nextStepForSystem(system),
    }));

  return {
    query: cleanedQuery,
    mode,
    generated_at: now.toISOString(),
    since_ts: sinceTs,
    project: opts.project ?? null,
    matched_actions: scoredActions,
    systems,
    gaps,
  };
}

export function formatCoverageAudit(report: CoverageAuditReport): string {
  const lines: string[] = [];
  lines.push(`coverage audit: ${report.query}`);
  lines.push(`mode: ${report.mode}`);
  if (report.project) lines.push(`project: ${report.project}`);
  if (report.since_ts) lines.push(`since: ${report.since_ts}`);
  lines.push(`actions: ${report.matched_actions.length}`);
  lines.push("");
  lines.push("systems:");
  for (const system of report.systems) {
    lines.push(
      `  ${system.system}: ${system.present ? "yes" : "no"} (${system.evidence_count})`
    );
  }

  const allEvidence = report.systems.flatMap((system) => system.evidence);
  if (allEvidence.length > 0) {
    lines.push("");
    lines.push("evidence:");
    for (const item of allEvidence.slice(0, 12)) {
      const when = item.when_ts ? ` ${item.when_ts}` : "";
      lines.push(`  - [${item.system}] ${item.ref}${when}: ${item.label}`);
    }
  }

  lines.push("");
  lines.push("gaps:");
  if (report.gaps.length === 0) {
    lines.push("  (none)");
  } else {
    for (const gap of report.gaps) {
      lines.push(`  - ${gap.system}: ${gap.next_step}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function loadCandidateActions(
  db: Database,
  opts: { project?: string; sinceTs: string | null; limit: number }
): ActionRow[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.project) {
    where.push("project = ?");
    params.push(opts.project);
  }
  if (opts.sinceTs) {
    where.push("when_ts >= ?");
    params.push(opts.sinceTs);
  }
  params.push(opts.limit);

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  return db
    .query(
      `SELECT action_id, source_system, source_id, what_text, when_ts, project,
              artifact_locations, next_query_hint
       FROM action_log
       ${whereSql}
       ORDER BY when_ts DESC, created_at DESC
       LIMIT ?`
    )
    .all(...params) as ActionRow[];
}

function toCoverageAction(
  row: ActionRow,
  artifactLocations: Record<string, unknown>,
  score: number
): CoverageAction {
  return {
    action_id: row.action_id,
    source_system: row.source_system,
    source_id: row.source_id,
    what_text: row.what_text,
    when_ts: row.when_ts,
    project: row.project,
    artifact_locations: artifactLocations,
    score,
  };
}

function evidenceForAction(action: CoverageAction): CoverageEvidence[] {
  const out: CoverageEvidence[] = [
    {
      system: "action_log",
      kind: "action",
      ref: action.action_id,
      label: truncate(action.what_text, 160),
      when_ts: action.when_ts,
      project: action.project,
      score: action.score,
    },
  ];

  const sourceSystem = normalizeSystem(action.source_system);
  if (sourceSystem) {
    out.push({
      system: sourceSystem,
      kind: "action",
      ref: action.source_id,
      label: truncate(action.what_text, 160),
      when_ts: action.when_ts,
      project: action.project,
      score: action.score,
    });
  }

  const locations = action.artifact_locations;
  if (hasKey(locations, "engram_memory_uri")) {
    out.push(
      locationEvidence("engram", String(locations["engram_memory_uri"]), action)
    );
  }
  if (hasKey(locations, "git_ref")) {
    out.push(locationEvidence("git", String(locations["git_ref"]), action));
  }
  if (hasKey(locations, "codex_session_file")) {
    out.push(
      locationEvidence("codex", String(locations["codex_session_file"]), action)
    );
  }
  if (hasKey(locations, "claude_transcript_path")) {
    out.push(
      locationEvidence(
        "claude-code",
        String(locations["claude_transcript_path"]),
        action
      )
    );
  }
  if (hasKey(locations, "file_path")) {
    out.push(
      locationEvidence("local-file", String(locations["file_path"]), action)
    );
  }
  const obsidian = recordValue(locations["obsidian"]);
  if (obsidian) {
    const vault = stringValue(obsidian["vault"]);
    const relativePath = stringValue(obsidian["relative_path"]);
    const ref = [vault, relativePath].filter(Boolean).join("/");
    out.push(locationEvidence("obsidian", ref || "obsidian", action));
  }

  return dedupeEvidence(out);
}

function locationEvidence(
  system: CoverageSystemId,
  ref: string,
  action: CoverageAction
): CoverageEvidence {
  return {
    system,
    kind: "action",
    ref,
    label: truncate(action.what_text, 160),
    when_ts: action.when_ts,
    project: action.project,
    score: action.score,
  };
}

function scanRepoDocs(
  repoRoot: string,
  query: string,
  tokens: string[]
): CoverageEvidence[] {
  const out: CoverageEvidence[] = [];
  if (tokens.length === 0 && !query.trim()) return out;

  for (const rel of DOC_PATHS) {
    const path = join(repoRoot, rel);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8");
    const score = scoreText(content, query, tokens);
    if (score <= 0) continue;
    out.push({
      system: "roadmap",
      kind: "doc",
      ref: `${rel}:${firstMatchingLine(content, query, tokens)}`,
      label: firstMatchingSnippet(content, query, tokens),
      score,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

function buildSystemReports(evidence: CoverageEvidence[]): CoverageSystemReport[] {
  return SYSTEM_ORDER.map((system) => {
    const items = evidence
      .filter((item) => item.system === system)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.when_ts ?? "").localeCompare(a.when_ts ?? "");
      });
    return {
      system,
      present: items.length > 0,
      evidence_count: items.length,
      evidence: items.slice(0, 3),
    };
  });
}

function tokenizeCoverageQuery(query: string): string[] {
  const tokens = tokenizeQuestion(query).filter(
    (token) => !TIMELINE_STOPWORDS.has(token)
  );
  return tokens.length > 0 ? tokens : tokenizeQuestion(query);
}

const TIMELINE_STOPWORDS = new Set([
  "work",
  "worked",
  "record",
  "recorded",
  "last",
  "week",
  "month",
  "today",
]);

function scoreText(text: string, query: string, tokens: string[]): number {
  const normalized = normalizeText(text);
  const phrase = normalizeText(query);
  let score = 0;
  if (phrase && normalized.includes(phrase)) score += tokens.length + 5;
  for (const token of tokens) {
    if (normalized.includes(normalizeText(token))) score++;
  }
  return score;
}

function isTimelineQuery(query: string): boolean {
  const normalized = normalizeText(query);
  return (
    normalized.includes("what did i work on") ||
    normalized.includes("what have i worked on") ||
    normalized.includes("last week") ||
    normalized.includes("this week") ||
    normalized.includes("last month") ||
    normalized.includes("today") ||
    normalized.includes("昨天") ||
    normalized.includes("上周") ||
    normalized.includes("本周") ||
    normalized.includes("最近")
  );
}

function firstMatchingLine(content: string, query: string, tokens: string[]): number {
  const lines = content.split(/\r?\n/);
  let bestLine = 1;
  let bestScore = -1;
  for (let i = 0; i < lines.length; i++) {
    const score = scoreText(lines[i] ?? "", query, tokens);
    if (score > bestScore) {
      bestScore = score;
      bestLine = i + 1;
    }
  }
  return bestLine;
}

function firstMatchingSnippet(content: string, query: string, tokens: string[]): string {
  const lines = content.split(/\r?\n/);
  let best = "";
  let bestScore = -1;
  for (const line of lines) {
    const score = scoreText(line, query, tokens);
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return truncate(best.trim() || "(matched document)", 160);
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

function normalizeSystem(value: string): CoverageSystemId | null {
  if (value === "action_log") return "action_log";
  if (value === "engram") return "engram";
  if (value === "obsidian") return "obsidian";
  if (value === "git") return "git";
  if (value === "codex") return "codex";
  if (value === "claude-code") return "claude-code";
  if (value === "zsh") return "zsh";
  if (value === "local-file") return "local-file";
  if (value === "web") return "web";
  return null;
}

function nextStepForSystem(system: CoverageSystemId): string {
  if (system === "action_log") return "capture or backfill an action_log entry";
  if (system === "engram") return "write a concise Engram baseline/pointer";
  if (system === "roadmap") {
    return "link or promote the stable baseline into repo docs";
  }
  if (system === "obsidian") return "add or link an Obsidian note path";
  if (system === "git") return "land the relevant code/docs in a git commit";
  return `add ${system} evidence if it is expected for this topic`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function daysAgo(now: Date, days: number): Date {
  const copy = new Date(now);
  copy.setUTCDate(copy.getUTCDate() - days);
  return copy;
}

function hasKey(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dedupeEvidence(items: CoverageEvidence[]): CoverageEvidence[] {
  const seen = new Set<string>();
  const out: CoverageEvidence[] = [];
  for (const item of items) {
    const key = `${item.system}:${item.kind}:${item.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}
