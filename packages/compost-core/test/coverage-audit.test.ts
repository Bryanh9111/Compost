import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyMigrations } from "../src/schema/migrator";
import {
  auditCoverage,
  formatCoverageAudit,
  type CoverageSystemId,
} from "../src/metacognitive/coverage-audit";

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

function hasSystem(
  report: ReturnType<typeof auditCoverage>,
  system: CoverageSystemId
): boolean {
  return report.systems.find((item) => item.system === system)?.present ?? false;
}

describe("metacognitive/coverage-audit", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-cover-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("audits topic coverage across actions and repo docs", () => {
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    writeFileSync(
      join(tmpDir, "docs", "ROADMAP.md"),
      "D2-4 coverage audit CLI tracks v4 turn metacognitive coverage.\n"
    );

    insertAction(db, {
      action_id: "act-engram",
      source_system: "engram",
      source_id: "mem:v4-turn",
      what_text: "Compost v4 turn baseline records D2-4 coverage audit.",
      when_ts: "2026-05-03T10:00:00.000Z",
      project: "compost",
      artifact_locations: { engram_memory_uri: "engram://memories/v4-turn" },
    });
    insertAction(db, {
      action_id: "act-git",
      source_system: "git",
      source_id: "commit:abc123",
      what_text: "feat: add coverage audit for v4 turn",
      when_ts: "2026-05-03T10:05:00.000Z",
      project: "compost",
      artifact_locations: { git_ref: "abc123" },
    });

    const report = auditCoverage(db, "v4 turn coverage audit", {
      repoRoot: tmpDir,
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    expect(report.mode).toBe("topic");
    expect(hasSystem(report, "action_log")).toBe(true);
    expect(hasSystem(report, "engram")).toBe(true);
    expect(hasSystem(report, "roadmap")).toBe(true);
    expect(hasSystem(report, "git")).toBe(true);
    expect(hasSystem(report, "obsidian")).toBe(false);
    expect(report.gaps.map((gap) => gap.system)).toContain("obsidian");
  });

  test("recognizes Obsidian artifact pointers", () => {
    insertAction(db, {
      action_id: "act-obsidian",
      source_system: "obsidian",
      source_id: "note:xhs-strategy",
      what_text: "Updated XHS strategy note and creator workflow baseline.",
      when_ts: "2026-05-03T10:00:00.000Z",
      artifact_locations: {
        obsidian: {
          vault: "Constellation",
          relative_path: "GitWiki Knowledge/XHS Strategy.md",
        },
      },
    });

    const report = auditCoverage(db, "XHS strategy note", {
      repoRoot: tmpDir,
      includeDocs: false,
    });

    expect(hasSystem(report, "obsidian")).toBe(true);
    expect(
      report.systems
        .find((system) => system.system === "obsidian")
        ?.evidence.map((item) => item.ref)
    ).toContain("Constellation/GitWiki Knowledge/XHS Strategy.md");
  });

  test("timeline queries default to the last seven days", () => {
    insertAction(db, {
      action_id: "act-recent",
      source_system: "codex",
      source_id: "turn:recent",
      what_text: "Landed Obsidian watcher for Compost capture expansion.",
      when_ts: "2026-05-02T10:00:00.000Z",
      project: "compost",
    });
    insertAction(db, {
      action_id: "act-old",
      source_system: "codex",
      source_id: "turn:old",
      what_text: "Historical planning outside the default coverage window.",
      when_ts: "2026-04-20T10:00:00.000Z",
      project: "compost",
    });

    const report = auditCoverage(db, "what did I work on last week", {
      now: new Date("2026-05-03T12:00:00.000Z"),
      includeDocs: false,
    });

    expect(report.mode).toBe("timeline");
    expect(report.since_ts).toBe("2026-04-26T12:00:00.000Z");
    expect(report.matched_actions.map((action) => action.action_id)).toEqual([
      "act-recent",
    ]);
  });

  test("formats coverage reports for terminal output", () => {
    const report = auditCoverage(db, "missing topic", { includeDocs: false });
    const output = formatCoverageAudit(report);

    expect(output).toContain("coverage audit: missing topic");
    expect(output).toContain("action_log: no");
    expect(output).toContain("obsidian: add or link an Obsidian note path");
  });
});
