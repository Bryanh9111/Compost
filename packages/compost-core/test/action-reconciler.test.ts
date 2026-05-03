import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyMigrations } from "../src/schema/migrator";
import {
  formatActionReconcile,
  reconcileActionPointers,
  type ActionReconcileIssueKind,
} from "../src/metacognitive/action-reconciler";

interface ActionInput {
  action_id: string;
  source_system: string;
  source_id: string;
  what_text: string;
  when_ts: string;
  project?: string;
  artifact_locations?: Record<string, unknown>;
}

function insertAction(db: Database, input: ActionInput): void {
  db.query(
    `INSERT INTO action_log (
       action_id, source_system, source_id, who, what_text, when_ts, project,
       artifact_locations
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.action_id,
    input.source_system,
    input.source_id,
    input.source_system,
    input.what_text,
    input.when_ts,
    input.project ?? null,
    input.artifact_locations ? JSON.stringify(input.artifact_locations) : null
  );
}

function issueKinds(
  report: ReturnType<typeof reconcileActionPointers>
): ActionReconcileIssueKind[] {
  return report.issues.map((issue) => issue.kind);
}

describe("metacognitive/action-reconciler", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-reconcile-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reports source-specific missing pointers for git, Obsidian, and Engram", () => {
    insertAction(db, {
      action_id: "act-git-ok",
      source_system: "git",
      source_id: "commit:ok",
      what_text: "git commit with pointer",
      when_ts: "2026-05-03T10:00:00.000Z",
      artifact_locations: { git_ref: "git:Compost@abc123" },
    });
    insertAction(db, {
      action_id: "act-git-missing",
      source_system: "git",
      source_id: "commit:missing",
      what_text: "git commit without pointer",
      when_ts: "2026-05-03T10:01:00.000Z",
      artifact_locations: { observation: { observe_id: "obs-git" } },
    });
    insertAction(db, {
      action_id: "act-obsidian-missing",
      source_system: "obsidian",
      source_id: "note:missing",
      what_text: "Obsidian note without vault path",
      when_ts: "2026-05-03T10:02:00.000Z",
    });
    insertAction(db, {
      action_id: "act-engram-missing",
      source_system: "engram",
      source_id: "memory:missing",
      what_text: "Engram memory without URI",
      when_ts: "2026-05-03T10:03:00.000Z",
    });

    const report = reconcileActionPointers(db, "today", {
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    expect(report.ok).toBe(false);
    expect(report.scanned_actions).toBe(4);
    expect(issueKinds(report)).toEqual([
      "missing_engram_memory_uri",
      "missing_obsidian_pointer",
      "missing_git_ref",
    ]);
    expect(report.by_kind).toEqual([
      { key: "missing_engram_memory_uri", count: 1 },
      { key: "missing_git_ref", count: 1 },
      { key: "missing_obsidian_pointer", count: 1 },
    ]);
  });

  test("reports durable pointer gaps for agent actions without canonical artifacts", () => {
    insertAction(db, {
      action_id: "act-codex-missing",
      source_system: "codex",
      source_id: "turn:missing",
      what_text: "Codex implemented a feature but only raw observation exists.",
      when_ts: "2026-05-03T10:00:00.000Z",
      artifact_locations: { observation: { observe_id: "obs-codex" } },
    });
    insertAction(db, {
      action_id: "act-codex-ok",
      source_system: "codex",
      source_id: "turn:ok",
      what_text: "Codex turn with transcript pointer.",
      when_ts: "2026-05-03T10:01:00.000Z",
      artifact_locations: { codex_session_file: "/tmp/session.jsonl" },
    });
    insertAction(db, {
      action_id: "act-zsh",
      source_system: "zsh",
      source_id: "cmd:1",
      what_text: "zsh command without durable artifact is allowed.",
      when_ts: "2026-05-03T10:02:00.000Z",
    });

    const report = reconcileActionPointers(db, "2026-05-03", {
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    expect(report.issue_count).toBe(1);
    expect(report.issues[0]?.kind).toBe("missing_durable_pointer");
    expect(report.issues[0]?.severity).toBe("warning");
    expect(report.issues[0]?.action_id).toBe("act-codex-missing");
  });

  test("filters by project and source system", () => {
    insertAction(db, {
      action_id: "act-compost",
      source_system: "codex",
      source_id: "turn:compost",
      what_text: "Compost action missing durable pointer.",
      when_ts: "2026-05-03T10:00:00.000Z",
      project: "compost",
    });
    insertAction(db, {
      action_id: "act-other",
      source_system: "codex",
      source_id: "turn:other",
      what_text: "Other project action missing durable pointer.",
      when_ts: "2026-05-03T10:01:00.000Z",
      project: "other",
    });
    insertAction(db, {
      action_id: "act-compost-git",
      source_system: "git",
      source_id: "commit:compost",
      what_text: "Compost git action missing git pointer.",
      when_ts: "2026-05-03T10:02:00.000Z",
      project: "compost",
    });

    const report = reconcileActionPointers(db, "today", {
      now: new Date("2026-05-03T12:00:00.000Z"),
      project: "compost",
      sourceSystem: "codex",
    });

    expect(report.scanned_actions).toBe(1);
    expect(report.issue_count).toBe(1);
    expect(report.issues[0]?.action_id).toBe("act-compost");
  });

  test("formats ok and missing-pointer terminal reports", () => {
    insertAction(db, {
      action_id: "act-git-missing",
      source_system: "git",
      source_id: "commit:missing",
      what_text: "git commit without pointer",
      when_ts: "2026-05-03T10:00:00.000Z",
    });

    const report = reconcileActionPointers(db, "today", {
      now: new Date("2026-05-03T12:00:00.000Z"),
    });
    const output = formatActionReconcile(report);

    expect(output).toContain("reconcile: today");
    expect(output).toContain("issues: 1");
    expect(output).toContain("[missing_git_ref]");
    expect(output).toContain("next: rerun `compost capture git`");

    const okOutput = formatActionReconcile(
      reconcileActionPointers(db, "yesterday", {
        now: new Date("2026-05-03T12:00:00.000Z"),
      })
    );

    expect(okOutput).toContain("status: ok");
    expect(okOutput).toContain("No action_log entries matched");
  });
});
