import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyMigrations } from "../src/schema/migrator";
import {
  formatRouteQuestion,
  routeQuestion,
  type RouteSystemId,
} from "../src/metacognitive/router";

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

function candidateFor(
  report: ReturnType<typeof routeQuestion>,
  system: RouteSystemId
) {
  return report.candidates.find((candidate) => candidate.system === system);
}

describe("metacognitive/router", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-route-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("routes XHS strategy questions to the Obsidian vault artifact", () => {
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

    const report = routeQuestion(
      db,
      "which Obsidian vault has my XHS strategy notes",
      {
        includeDocs: false,
      }
    );

    expect(report.candidates[0]?.system).toBe("obsidian");
    expect(candidateFor(report, "obsidian")?.ref).toBe(
      "Constellation/GitWiki Knowledge/XHS Strategy.md"
    );
    expect(report.fallback).toBeNull();
  });

  test("routes implementation questions to Engram and git pointers", () => {
    insertAction(db, {
      action_id: "act-engram",
      source_system: "engram",
      source_id: "engram://memory/route-baseline",
      what_text: "Compost route baseline records artifact routing decisions.",
      when_ts: "2026-05-03T10:00:00.000Z",
      artifact_locations: {
        engram_memory_uri: "engram://memory/route-baseline",
      },
    });
    insertAction(db, {
      action_id: "act-git",
      source_system: "git",
      source_id: "commit:def456",
      what_text: "feat: add route question CLI for artifact routing baseline",
      when_ts: "2026-05-03T10:01:00.000Z",
      artifact_locations: {
        git_ref: "git:Compost@def456",
      },
    });

    const report = routeQuestion(db, "route question artifact routing baseline", {
      includeDocs: false,
    });

    expect(candidateFor(report, "engram")?.ref).toBe(
      "engram://memory/route-baseline"
    );
    expect(candidateFor(report, "git")?.ref).toBe("git:Compost@def456");
  });

  test("falls back to repo docs when no action artifact matches", () => {
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    writeFileSync(
      join(tmpDir, "docs", "ROADMAP.md"),
      "The route question primitive points users to the canonical artifact.\n"
    );

    const report = routeQuestion(db, "route question canonical artifact", {
      repoRoot: tmpDir,
    });

    expect(candidateFor(report, "repo-docs")?.ref).toBe("docs/ROADMAP.md:1");
    expect(report.searched_actions).toBe(0);
  });

  test("routes timeline questions to action_log before incidental artifacts", () => {
    insertAction(db, {
      action_id: "act-recent",
      source_system: "obsidian",
      source_id: "note:recent",
      what_text: "Updated a local model note during last week's work.",
      when_ts: "2026-05-02T10:00:00.000Z",
      artifact_locations: {
        obsidian: {
          vault: "Constellation",
          relative_path: "GitWiki Knowledge/Models.md",
        },
      },
    });

    const report = routeQuestion(db, "what did I work on last week", {
      includeDocs: false,
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    expect(report.audit_mode).toBe("timeline");
    expect(report.candidates[0]?.system).toBe("action_log");
    expect(report.candidates[0]?.ref).toBe(
      "action_log:2026-04-26T12:00:00.000Z"
    );
  });

  test("formats fallback reports when no route is known", () => {
    const report = routeQuestion(db, "unknown route", { includeDocs: false });
    const output = formatRouteQuestion(report);

    expect(report.candidates).toEqual([]);
    expect(output).toContain("route: unknown route");
    expect(output).toContain("fallback: No route found");
  });
});
