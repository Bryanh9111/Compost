import type { Database } from "bun:sqlite";
import { v7 as uuidv7 } from "uuid";

export type ActionProcessStatus =
  | "inserted"
  | "duplicate"
  | "skipped"
  | "error";

export interface ActionProcessOneResult {
  observe_id: string;
  status: ActionProcessStatus;
  action_id?: string;
  reason?: string;
}

export interface ActionProcessBatchOptions {
  limit?: number;
}

export interface ActionProcessBatchReport {
  scanned: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  errors: Array<{ observe_id: string; error: string }>;
}

interface ObservationRow {
  observe_id: string;
  source_id: string;
  source_uri: string;
  source_kind: string | null;
  occurred_at: string;
  captured_at: string;
  raw_text: string | null;
  mime_type: string;
  adapter: string;
  adapter_sequence: number;
  trust_tier: string;
  idempotency_key: string;
  transform_policy: string;
  metadata: string | null;
}

interface DerivedAction {
  source_system: string;
  source_id: string;
  who: string;
  what_text: string;
  when_ts: string;
  project: string | null;
  artifact_locations: Record<string, unknown>;
  next_query_hint: string | null;
}

export function processObservationAction(
  db: Database,
  observeId: string
): ActionProcessOneResult {
  try {
    const row = loadObservation(db, observeId);
    if (!row) {
      return {
        observe_id: observeId,
        status: "skipped",
        reason: "observation not found",
      };
    }

    if (hasActionForObservation(db, observeId)) {
      const existing = getActionForObservation(db, observeId);
      return {
        observe_id: observeId,
        status: "duplicate",
        action_id: existing?.action_id,
        reason: "source_observe_id already processed",
      };
    }

    const parsedPayload = parseJsonObject(row.raw_text);
    const metadata = parseJsonObject(row.metadata);
    const derived = deriveAction(row, parsedPayload, metadata);
    if (!derived.what_text.trim()) {
      return {
        observe_id: observeId,
        status: "skipped",
        reason: "empty action text",
      };
    }

    const duplicate = db
      .query(
        `SELECT action_id FROM action_log
         WHERE source_system = ? AND source_id = ?`
      )
      .get(derived.source_system, derived.source_id) as
      | { action_id: string }
      | null;
    if (duplicate) {
      return {
        observe_id: observeId,
        status: "duplicate",
        action_id: duplicate.action_id,
        reason: "source identity already processed",
      };
    }

    const actionId = uuidv7();
    db.run(
      `INSERT OR IGNORE INTO action_log (
        action_id, source_system, source_id, source_observe_id,
        who, what_text, when_ts, project, artifact_locations,
        coverage_audit, next_query_hint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        actionId,
        derived.source_system,
        derived.source_id,
        row.observe_id,
        derived.who,
        derived.what_text,
        derived.when_ts,
        derived.project,
        JSON.stringify(derived.artifact_locations),
        derived.next_query_hint,
      ]
    );

    const inserted = db
      .query("SELECT action_id FROM action_log WHERE action_id = ?")
      .get(actionId) as { action_id: string } | null;

    return inserted
      ? { observe_id: observeId, status: "inserted", action_id: actionId }
      : {
          observe_id: observeId,
          status: "duplicate",
          reason: "insert ignored",
        };
  } catch (e) {
    return {
      observe_id: observeId,
      status: "error",
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

export function processObservationActions(
  db: Database,
  opts: ActionProcessBatchOptions = {}
): ActionProcessBatchReport {
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 10_000));
  const rows = db
    .query(
      `SELECT o.observe_id
       FROM observations o
       WHERE NOT EXISTS (
         SELECT 1 FROM action_log a
         WHERE a.source_observe_id = o.observe_id
       )
       ORDER BY o.captured_at, o.adapter_sequence
       LIMIT ?`
    )
    .all(limit) as { observe_id: string }[];

  const report: ActionProcessBatchReport = {
    scanned: rows.length,
    inserted: 0,
    duplicates: 0,
    skipped: 0,
    errors: [],
  };

  for (const row of rows) {
    const result = processObservationAction(db, row.observe_id);
    if (result.status === "inserted") report.inserted++;
    if (result.status === "duplicate") report.duplicates++;
    if (result.status === "skipped") report.skipped++;
    if (result.status === "error") {
      report.errors.push({
        observe_id: row.observe_id,
        error: result.reason ?? "unknown error",
      });
    }
  }

  return report;
}

function loadObservation(db: Database, observeId: string): ObservationRow | null {
  return db
    .query(
      `SELECT
         o.observe_id,
         o.source_id,
         o.source_uri,
         s.kind AS source_kind,
         o.occurred_at,
         o.captured_at,
         CAST(o.raw_bytes AS TEXT) AS raw_text,
         o.mime_type,
         o.adapter,
         o.adapter_sequence,
         o.trust_tier,
         o.idempotency_key,
         o.transform_policy,
         o.metadata
       FROM observations o
       LEFT JOIN source s ON s.id = o.source_id
       WHERE o.observe_id = ?`
    )
    .get(observeId) as ObservationRow | null;
}

function hasActionForObservation(db: Database, observeId: string): boolean {
  return getActionForObservation(db, observeId) !== null;
}

function getActionForObservation(
  db: Database,
  observeId: string
): { action_id: string } | null {
  return db
    .query("SELECT action_id FROM action_log WHERE source_observe_id = ?")
    .get(observeId) as { action_id: string } | null;
}

function deriveAction(
  row: ObservationRow,
  payload: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null
): DerivedAction {
  const sourceSystem = deriveSourceSystem(row);
  const project = deriveProject(row, payload, metadata);
  const sourceId = deriveActionSourceId(row, payload, sourceSystem);
  const whatText = deriveWhatText(row, payload, metadata, sourceSystem, project);
  const artifactLocations = deriveArtifactLocations(row, payload, metadata);

  return {
    source_system: sourceSystem,
    source_id: sourceId,
    who: sourceSystem,
    what_text: truncateText(whatText, 1200),
    when_ts: row.occurred_at || row.captured_at,
    project,
    artifact_locations: artifactLocations,
    next_query_hint: deriveNextQueryHint(project, whatText),
  };
}

function deriveSourceSystem(row: ObservationRow): string {
  const adapter = row.adapter.toLowerCase();
  if (adapter.includes("codex")) return "codex";
  if (adapter.includes("claude-code")) return "claude-code";
  if (adapter === "engram" || row.source_uri.startsWith("engram://")) {
    return "engram";
  }
  if (row.source_kind === "web") return "web";
  if (row.source_kind === "local-file" || row.source_kind === "local-dir") {
    return row.source_kind;
  }
  return sanitizeSourceSystem(row.adapter);
}

function deriveActionSourceId(
  row: ObservationRow,
  payload: Record<string, unknown> | null,
  sourceSystem: string
): string {
  if (sourceSystem === "codex" && payload?.["kind"] === "codex-turn-summary") {
    const sessionId = stringValue(payload["session_id"]);
    const bytes = recordValue(payload["bytes"]);
    const byteTo = numberOrString(bytes?.["to"]);
    if (sessionId && byteTo) return `turn:${sessionId}:${byteTo}`;
    if (sessionId) return `turn:${sessionId}:${row.adapter_sequence}`;
  }

  if (sourceSystem === "claude-code") {
    const sessionId = stringValue(payload?.["session_id"]);
    const hookEvent = stringValue(payload?.["hook_event_name"]);
    if (sessionId && hookEvent) {
      return `${sessionId}:${hookEvent}:${row.adapter_sequence}`;
    }
  }

  if (sourceSystem === "engram" && row.source_uri.startsWith("engram://")) {
    return `${row.source_uri}:${row.adapter_sequence}:${row.observe_id}`;
  }

  if (sourceSystem === "codex" && looksUniqueSourceId(row.source_id)) {
    return row.source_id;
  }

  if (sourceSystem === "claude-code" && looksUniqueSourceId(row.source_id)) {
    return row.source_id;
  }

  return `${row.source_id}:${row.adapter_sequence}:${row.observe_id}`;
}

function deriveWhatText(
  row: ObservationRow,
  payload: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null,
  sourceSystem: string,
  project: string | null
): string {
  if (sourceSystem === "codex" && payload?.["kind"] === "codex-turn-summary") {
    const assistant = lastString(payload["assistant_messages"]);
    const user = lastString(payload["user_messages"]);
    const basis = assistant ?? user ?? "turn ended";
    return `Codex turn${project ? ` in ${project}` : ""}: ${basis}`;
  }

  if (sourceSystem === "claude-code" && payload) {
    const hookEvent = stringValue(payload["hook_event_name"]);
    const toolName = stringValue(payload["tool_name"]);
    const cwd = stringValue(payload["cwd"]);
    const toolInput = recordValue(payload["tool_input"]);
    const command = stringValue(toolInput?.["command"]);
    const prompt = stringValue(payload["prompt"]) ?? stringValue(payload["message"]);
    const detail = command ?? prompt ?? firstText(row.raw_text) ?? "event captured";
    const label = [hookEvent, toolName].filter(Boolean).join(" ");
    return `Claude Code${label ? ` ${label}` : ""}${cwd ? ` in ${projectNameFromPath(cwd) ?? cwd}` : ""}: ${detail}`;
  }

  const engramKind = stringValue(metadata?.["engram_kind"]);
  if (sourceSystem === "engram" || engramKind) {
    const engramProject = stringValue(metadata?.["engram_project"]);
    return `Engram ${engramKind ?? "memory"}${engramProject ? ` for ${engramProject}` : ""}: ${
      firstText(row.raw_text) ?? row.source_uri
    }`;
  }

  return firstText(row.raw_text) ?? `${row.adapter} observation from ${row.source_uri}`;
}

function deriveArtifactLocations(
  row: ObservationRow,
  payload: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null
): Record<string, unknown> {
  const locations: Record<string, unknown> = {
    observation: {
      observe_id: row.observe_id,
      adapter: row.adapter,
      adapter_sequence: row.adapter_sequence,
      source_id: row.source_id,
      source_uri: row.source_uri,
      source_kind: row.source_kind,
    },
  };

  const sessionFile = stringValue(payload?.["session_file"]) ??
    stringValue(metadata?.["session_file"]);
  const transcriptPath = stringValue(payload?.["transcript_path"]) ??
    stringValue(metadata?.["transcript_path"]);
  const cwd = stringValue(payload?.["cwd"]) ?? pathFromSourceUri(row.source_uri);
  const memoryUri = row.source_uri.startsWith("engram://")
    ? row.source_uri
    : null;

  if (sessionFile) locations["codex_session_file"] = sessionFile;
  if (transcriptPath) locations["claude_transcript_path"] = transcriptPath;
  if (cwd) locations["cwd"] = cwd;
  if (memoryUri) locations["engram_memory_uri"] = memoryUri;
  if (row.source_uri.startsWith("git:")) locations["git_ref"] = row.source_uri;
  if (row.source_uri.startsWith("file://")) {
    locations["file_path"] = row.source_uri.slice("file://".length);
  }

  return locations;
}

function deriveProject(
  row: ObservationRow,
  payload: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null
): string | null {
  const engramProject = stringValue(metadata?.["engram_project"]);
  if (engramProject) return engramProject;

  const cwd = stringValue(payload?.["cwd"]);
  if (cwd) return projectNameFromPath(cwd);

  const uriPath = pathFromSourceUri(row.source_uri);
  if (uriPath) return projectNameFromPath(uriPath);

  return projectNameFromPath(row.source_uri);
}

function deriveNextQueryHint(project: string | null, whatText: string): string | null {
  const text = firstText(whatText);
  if (!text) return null;
  return truncateText(project ? `${project}: ${text}` : text, 240);
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return recordValue(parsed) ?? null;
  } catch {
    return null;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberOrString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

function lastString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (let i = value.length - 1; i >= 0; i--) {
    const item = value[i];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return null;
}

function firstText(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized;
}

function truncateText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function sanitizeSourceSystem(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "unknown";
}

function looksUniqueSourceId(sourceId: string): boolean {
  return (
    sourceId.includes("://") ||
    sourceId.includes("@") ||
    /\d{4}-\d{2}-\d{2}/.test(sourceId) ||
    /^[0-9a-f]{8,}-/.test(sourceId)
  );
}

function pathFromSourceUri(sourceUri: string): string | null {
  if (sourceUri.startsWith("file://")) return sourceUri.slice("file://".length);
  if (sourceUri.startsWith("codex://")) return sourceUri.slice("codex://".length);
  if (sourceUri.startsWith("claude-code://")) {
    return sourceUri.slice("claude-code://".length);
  }
  if (sourceUri.startsWith("/")) return sourceUri;
  return null;
}

function projectNameFromPath(path: string): string | null {
  const normalized = path.replace(/\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const zyloIndex = parts.findIndex(
    (part, index) => part === "Zylo" && parts[index - 1] === "Repos"
  );
  if (zyloIndex >= 0 && parts[zyloIndex + 1]) return parts[zyloIndex + 1]!;

  const reposIndex = parts.findIndex((part) => part === "Repos");
  if (reposIndex >= 0 && parts[reposIndex + 2]) return parts[reposIndex + 2]!;

  return parts[parts.length - 1] ?? null;
}
