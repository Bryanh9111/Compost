import type { Database } from "bun:sqlite";
import {
  auditCoverage,
  type CoverageAction,
  type CoverageAuditOptions,
  type CoverageEvidence,
} from "./coverage-audit";

export type RouteSystemId =
  | "obsidian"
  | "engram"
  | "git"
  | "repo-docs"
  | "action_log"
  | "codex"
  | "claude-code"
  | "zsh"
  | "local-file"
  | "web";

export interface RouteQuestionOptions extends CoverageAuditOptions {}

export interface RouteCandidate {
  system: RouteSystemId;
  ref: string;
  label: string;
  reason: string;
  confidence: number;
  evidence_count: number;
  source_action_id?: string;
  when_ts?: string;
  project?: string | null;
}

export interface RouteQuestionReport {
  question: string;
  generated_at: string;
  project: string | null;
  audit_mode: "topic" | "timeline";
  searched_actions: number;
  candidates: RouteCandidate[];
  fallback: string | null;
}

export function routeQuestion(
  db: Database,
  question: string,
  opts: RouteQuestionOptions = {}
): RouteQuestionReport {
  const audit = auditCoverage(db, question, opts);
  const candidates: RouteCandidate[] = [];

  if (audit.mode === "timeline" && audit.matched_actions.length > 0) {
    candidates.push({
      system: "action_log",
      ref: `action_log:${audit.since_ts ?? "all-time"}`,
      label: "Use matched action_log rows for this time-window question.",
      reason: "time-window questions route to the metacognitive timeline",
      confidence: 0.99,
      evidence_count: audit.matched_actions.length,
      project: audit.project,
    });
  }

  for (const action of audit.matched_actions) {
    candidates.push(...candidatesForAction(action));
  }

  for (const evidence of audit.systems.flatMap((system) => system.evidence)) {
    if (evidence.kind === "doc") candidates.push(candidateForDoc(evidence));
  }

  const deduped = dedupeCandidates(candidates)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (b.evidence_count !== a.evidence_count) {
        return b.evidence_count - a.evidence_count;
      }
      return (b.when_ts ?? "").localeCompare(a.when_ts ?? "");
    })
    .slice(0, Math.max(1, Math.min(opts.limit ?? 10, 50)));

  return {
    question: audit.query,
    generated_at: audit.generated_at,
    project: audit.project,
    audit_mode: audit.mode,
    searched_actions: audit.matched_actions.length,
    candidates: deduped,
    fallback:
      deduped.length > 0
        ? null
        : "No route found in action_log or repo docs; capture or link an artifact first.",
  };
}

export function formatRouteQuestion(report: RouteQuestionReport): string {
  const lines: string[] = [];
  lines.push(`route: ${report.question}`);
  lines.push(`mode: ${report.audit_mode}`);
  if (report.project) lines.push(`project: ${report.project}`);
  lines.push(`actions: ${report.searched_actions}`);

  if (report.candidates.length > 0) {
    const best = report.candidates[0]!;
    lines.push(
      `best: [${best.system}] ${best.ref} (${best.confidence.toFixed(2)})`
    );
    lines.push("");
    lines.push("candidates:");
    for (const candidate of report.candidates) {
      lines.push(
        `  - [${candidate.system}] ${candidate.ref} (${candidate.confidence.toFixed(2)}): ${candidate.reason}`
      );
      lines.push(`    ${candidate.label}`);
    }
  } else {
    lines.push(`fallback: ${report.fallback}`);
  }

  return `${lines.join("\n")}\n`;
}

function candidatesForAction(action: CoverageAction): RouteCandidate[] {
  const out: RouteCandidate[] = [];
  const locations = action.artifact_locations;

  const obsidian = recordValue(locations["obsidian"]);
  if (obsidian) {
    const vault = stringValue(obsidian["vault"]);
    const relativePath = stringValue(obsidian["relative_path"]);
    const absolutePath = stringValue(obsidian["path"]);
    const ref = [vault, relativePath].filter(Boolean).join("/") || absolutePath;
    if (ref) {
      out.push(
        actionCandidate(
          "obsidian",
          ref,
          "curated Obsidian note pointer from action_log",
          action,
          0.25
        )
      );
    }
  }

  pushLocation(out, "engram", locations["engram_memory_uri"], action, 0.23);
  pushLocation(out, "git", locations["git_ref"], action, 0.2);
  pushLocation(out, "codex", locations["codex_session_file"], action, 0.12);
  pushLocation(
    out,
    "claude-code",
    locations["claude_transcript_path"],
    action,
    0.12
  );
  pushLocation(out, "local-file", locations["file_path"], action, 0.1);

  const sourceSystem = normalizeRouteSystem(action.source_system);
  if (sourceSystem) {
    out.push(
      actionCandidate(
        sourceSystem,
        action.source_id,
        "source-system match from action_log",
        action,
        sourceSystem === "action_log" ? 0.02 : 0.08
      )
    );
  }

  out.push(
    actionCandidate(
      "action_log",
      action.action_id,
      "metacognitive timeline evidence",
      action,
      0.02
    )
  );

  return out;
}

function pushLocation(
  out: RouteCandidate[],
  system: RouteSystemId,
  value: unknown,
  action: CoverageAction,
  bonus: number
): void {
  const ref = stringValue(value);
  if (!ref) return;
  out.push(
    actionCandidate(
      system,
      ref,
      "artifact pointer from action_log",
      action,
      bonus
    )
  );
}

function actionCandidate(
  system: RouteSystemId,
  ref: string,
  reason: string,
  action: CoverageAction,
  bonus: number
): RouteCandidate {
  return {
    system,
    ref,
    label: truncate(action.what_text, 160),
    reason,
    confidence: confidenceFromScore(action.score, bonus),
    evidence_count: 1,
    source_action_id: action.action_id,
    when_ts: action.when_ts,
    project: action.project,
  };
}

function candidateForDoc(evidence: CoverageEvidence): RouteCandidate {
  return {
    system: "repo-docs",
    ref: evidence.ref,
    label: truncate(evidence.label, 160),
    reason: "repo documentation match",
    confidence: Math.min(0.74, confidenceFromScore(evidence.score, 0.02)),
    evidence_count: 1,
    project: evidence.project,
  };
}

function confidenceFromScore(score: number, bonus: number): number {
  return Math.min(
    0.98,
    Number((0.4 + Math.log1p(score) / 5 + bonus).toFixed(2))
  );
}

function normalizeRouteSystem(value: string): RouteSystemId | null {
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

function dedupeCandidates(items: RouteCandidate[]): RouteCandidate[] {
  const byKey = new Map<string, RouteCandidate>();
  for (const item of items) {
    const key = `${item.system}:${item.ref}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...item });
      continue;
    }
    existing.evidence_count += item.evidence_count;
    if (item.confidence > existing.confidence) {
      existing.confidence = item.confidence;
      existing.label = item.label;
      existing.reason = item.reason;
      existing.source_action_id = item.source_action_id;
      existing.when_ts = item.when_ts;
      existing.project = item.project;
    }
  }
  return [...byKey.values()];
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
