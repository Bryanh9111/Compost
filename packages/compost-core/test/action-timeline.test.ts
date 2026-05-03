import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyMigrations } from "../src/schema/migrator";
import {
  formatActionTimeline,
  parseActionTimelineWindow,
  summarizeActionTimeline,
} from "../src/metacognitive/action-timeline";

interface ActionInput {
  action_id: string;
  source_system: string;
  source_id: string;
  what_text: string;
  when_ts: string;
  project?: string;
  artifact_locations?: Record<string, unknown>;
  next_query_hint?: string;
}

function insertAction(db: Database, input: ActionInput): void {
  db.query(
    `INSERT INTO action_log (
       action_id, source_system, source_id, who, what_text, when_ts, project,
       artifact_locations, next_query_hint
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.action_id,
    input.source_system,
    input.source_id,
    input.source_system,
    input.what_text,
    input.when_ts,
    input.project ?? null,
    input.artifact_locations ? JSON.stringify(input.artifact_locations) : null,
    input.next_query_hint ?? null
  );
}

describe("metacognitive/action-timeline", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-did-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("parses calendar date and relative UTC windows", () => {
    const now = new Date("2026-05-03T12:00:00.000Z");

    expect(parseActionTimelineWindow("2026-05-03", now)).toMatchObject({
      start_ts: "2026-05-03T00:00:00.000Z",
      end_ts: "2026-05-04T00:00:00.000Z",
      timezone: "UTC",
    });
    expect(parseActionTimelineWindow("this week", now)).toMatchObject({
      start_ts: "2026-04-27T00:00:00.000Z",
      end_ts: "2026-05-04T00:00:00.000Z",
    });
    expect(parseActionTimelineWindow("last week", now)).toMatchObject({
      start_ts: "2026-04-20T00:00:00.000Z",
      end_ts: "2026-04-27T00:00:00.000Z",
    });
  });

  test("summarizes actions for an exact date", () => {
    insertAction(db, {
      action_id: "act-codex",
      source_system: "codex",
      source_id: "turn:did",
      what_text: "Implemented compost did action timeline aggregation.",
      when_ts: "2026-05-03T10:00:00.000Z",
      project: "compost",
      artifact_locations: {
        git_ref: "git:Compost@abc123",
        codex_session_file: "/tmp/codex-session.jsonl",
      },
    });
    insertAction(db, {
      action_id: "act-git",
      source_system: "git",
      source_id: "commit:abc123",
      what_text: "feat: add action timeline did CLI",
      when_ts: "2026-05-03T11:00:00.000Z",
      project: "compost",
      artifact_locations: { git_ref: "git:Compost@abc123" },
    });
    insertAction(db, {
      action_id: "act-other-day",
      source_system: "zsh",
      source_id: "cmd:old",
      what_text: "Historical command outside the requested date.",
      when_ts: "2026-05-02T23:59:59.000Z",
      project: "compost",
    });

    const report = summarizeActionTimeline(db, "2026-05-03", {
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    expect(report.action_count).toBe(2);
    expect(report.returned_action_count).toBe(2);
    expect(report.actions.map((action) => action.action_id)).toEqual([
      "act-git",
      "act-codex",
    ]);
    expect(report.source_counts).toEqual([
      { key: "codex", count: 1 },
      { key: "git", count: 1 },
    ]);
    expect(report.project_counts).toEqual([{ key: "compost", count: 2 }]);
    expect(report.days).toHaveLength(1);
    expect(report.days[0]?.date).toBe("2026-05-03");
  });

  test("filters this week by project and source system", () => {
    insertAction(db, {
      action_id: "act-compost-codex",
      source_system: "codex",
      source_id: "turn:compost",
      what_text: "Continued Compost metacognitive CLI work.",
      when_ts: "2026-04-28T10:00:00.000Z",
      project: "compost",
    });
    insertAction(db, {
      action_id: "act-compost-git",
      source_system: "git",
      source_id: "commit:def456",
      what_text: "Committed unrelated Compost work.",
      when_ts: "2026-04-29T10:00:00.000Z",
      project: "compost",
    });
    insertAction(db, {
      action_id: "act-other-project",
      source_system: "codex",
      source_id: "turn:other",
      what_text: "Worked on another project this week.",
      when_ts: "2026-04-30T10:00:00.000Z",
      project: "other",
    });

    const report = summarizeActionTimeline(db, "this week", {
      now: new Date("2026-05-03T12:00:00.000Z"),
      project: "compost",
      sourceSystem: "codex",
    });

    expect(report.action_count).toBe(1);
    expect(report.actions[0]?.action_id).toBe("act-compost-codex");
    expect(report.project).toBe("compost");
    expect(report.source_system).toBe("codex");
  });

  test("reports total matched actions separately from the returned limit", () => {
    insertAction(db, {
      action_id: "act-1",
      source_system: "codex",
      source_id: "turn:1",
      what_text: "First action in the window.",
      when_ts: "2026-05-03T10:00:00.000Z",
      project: "compost",
    });
    insertAction(db, {
      action_id: "act-2",
      source_system: "git",
      source_id: "commit:2",
      what_text: "Second action in the window.",
      when_ts: "2026-05-03T11:00:00.000Z",
      project: "compost",
    });

    const report = summarizeActionTimeline(db, "today", {
      now: new Date("2026-05-03T12:00:00.000Z"),
      limit: 1,
    });

    expect(report.action_count).toBe(2);
    expect(report.returned_action_count).toBe(1);
    expect(report.source_counts).toEqual([
      { key: "codex", count: 1 },
      { key: "git", count: 1 },
    ]);
    expect(formatActionTimeline(report)).toContain(
      "actions: 1 returned (2 matched)"
    );
  });

  test("formats non-empty and empty terminal reports", () => {
    insertAction(db, {
      action_id: "act-obsidian",
      source_system: "obsidian",
      source_id: "note:xhs",
      what_text: "Updated XHS strategy note.",
      when_ts: "2026-05-03T09:30:00.000Z",
      project: "compost",
      artifact_locations: {
        obsidian: {
          vault: "Constellation",
          relative_path: "GitWiki Knowledge/XHS Strategy.md",
        },
      },
    });

    const report = summarizeActionTimeline(db, "today", {
      now: new Date("2026-05-03T12:00:00.000Z"),
    });
    const output = formatActionTimeline(report);

    expect(output).toContain("did: today");
    expect(output).toContain("sources: obsidian=1");
    expect(output).toContain("2026-05-03 (1)");
    expect(output).toContain(
      "artifacts: obsidian=GitWiki Knowledge/XHS Strategy.md"
    );

    const emptyOutput = formatActionTimeline(
      summarizeActionTimeline(db, "yesterday", {
        now: new Date("2026-05-03T12:00:00.000Z"),
      })
    );

    expect(emptyOutput).toContain("actions: 0");
    expect(emptyOutput).toContain("verify capture hooks");
  });
});
