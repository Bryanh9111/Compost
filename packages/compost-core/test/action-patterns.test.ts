import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyMigrations } from "../src/schema/migrator";
import {
  detectActionPatterns,
  formatActionPatterns,
} from "../src/metacognitive/action-patterns";

interface ActionInput {
  action_id: string;
  source_system: string;
  source_id: string;
  what_text: string;
  when_ts: string;
  project?: string;
}

function insertAction(db: Database, input: ActionInput): void {
  db.query(
    `INSERT INTO action_log (
       action_id, source_system, source_id, who, what_text, when_ts, project
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.action_id,
    input.source_system,
    input.source_id,
    input.source_system,
    input.what_text,
    input.when_ts,
    input.project ?? null
  );
}

describe("metacognitive/action-patterns", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-patterns-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("detects read-only patterns over action_log", () => {
    insertAction(db, {
      action_id: "act-codex-1",
      source_system: "codex",
      source_id: "turn:1",
      what_text: "Implemented Compost pattern planning.",
      when_ts: "2026-04-27T09:00:00.000Z",
      project: "Compost",
    });
    insertAction(db, {
      action_id: "act-git-1",
      source_system: "git",
      source_id: "commit:1",
      what_text: "feat: add pattern report",
      when_ts: "2026-04-27T09:10:00.000Z",
      project: "Compost",
    });
    insertAction(db, {
      action_id: "act-codex-2",
      source_system: "codex",
      source_id: "turn:2",
      what_text: "Refined Compost CLI output.",
      when_ts: "2026-04-28T09:00:00.000Z",
      project: "Compost",
    });
    insertAction(db, {
      action_id: "act-git-2",
      source_system: "git",
      source_id: "commit:2",
      what_text: "test: cover pattern report",
      when_ts: "2026-04-28T09:10:00.000Z",
      project: "Compost",
    });
    insertAction(db, {
      action_id: "act-obsidian",
      source_system: "obsidian",
      source_id: "note:1",
      what_text: "Updated Constellation note.",
      when_ts: "2026-04-29T10:00:00.000Z",
      project: "Constellation",
    });
    insertAction(db, {
      action_id: "act-athena",
      source_system: "codex",
      source_id: "turn:athena",
      what_text: "Worked on Athena research.",
      when_ts: "2026-04-30T11:00:00.000Z",
      project: "Athena",
    });

    const report = detectActionPatterns(db, "this week", {
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    expect(report.scanned_action_count).toBe(6);
    expect(report.active_days).toBe(4);
    expect(report.provisional_hint).toContain("provisional");
    expect(report.source_counts).toEqual([
      { key: "codex", count: 3 },
      { key: "git", count: 2 },
      { key: "obsidian", count: 1 },
    ]);
    expect(report.patterns.map((pattern) => pattern.kind)).toContain(
      "capture_spread"
    );
    expect(report.patterns.map((pattern) => pattern.kind)).toContain(
      "project_focus"
    );
    expect(report.patterns.map((pattern) => pattern.kind)).toContain(
      "source_sequence"
    );
    expect(
      report.patterns.find((pattern) => pattern.kind === "source_sequence")
        ?.title
    ).toContain("codex -> git");
  });

  test("filters by project and source system", () => {
    insertAction(db, {
      action_id: "act-compost-codex",
      source_system: "codex",
      source_id: "turn:compost",
      what_text: "Compost action.",
      when_ts: "2026-05-03T10:00:00.000Z",
      project: "Compost",
    });
    insertAction(db, {
      action_id: "act-compost-git",
      source_system: "git",
      source_id: "commit:compost",
      what_text: "Compost commit.",
      when_ts: "2026-05-03T10:10:00.000Z",
      project: "Compost",
    });
    insertAction(db, {
      action_id: "act-other-codex",
      source_system: "codex",
      source_id: "turn:other",
      what_text: "Other action.",
      when_ts: "2026-05-03T11:00:00.000Z",
      project: "Other",
    });

    const report = detectActionPatterns(db, "today", {
      now: new Date("2026-05-03T12:00:00.000Z"),
      project: "Compost",
      sourceSystem: "codex",
    });

    expect(report.scanned_action_count).toBe(1);
    expect(report.project).toBe("Compost");
    expect(report.source_system).toBe("codex");
    expect(report.patterns).toEqual([]);
  });

  test("formats non-empty and empty pattern reports", () => {
    insertAction(db, {
      action_id: "act-1",
      source_system: "codex",
      source_id: "turn:1",
      what_text: "First action.",
      when_ts: "2026-05-03 09:00:00",
      project: "Compost",
    });
    insertAction(db, {
      action_id: "act-2",
      source_system: "git",
      source_id: "commit:1",
      what_text: "Second action.",
      when_ts: "2026-05-03T09:10:00.000Z",
      project: "Compost",
    });

    const output = formatActionPatterns(
      detectActionPatterns(db, "today", {
        now: new Date("2026-05-03T12:00:00.000Z"),
      })
    );

    expect(output).toContain("patterns: today");
    expect(output).toContain("sources: codex=1, git=1");
    expect(output).toContain("status: provisional");

    const emptyOutput = formatActionPatterns(
      detectActionPatterns(db, "yesterday", {
        now: new Date("2026-05-03T12:00:00.000Z"),
      })
    );

    expect(emptyOutput).toContain("scanned: 0");
    expect(emptyOutput).toContain("keep capture running");
  });
});
