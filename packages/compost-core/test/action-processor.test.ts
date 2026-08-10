import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import { upsertPolicies } from "../src/policies/registry";
import {
  appendToOutbox,
  drainOne,
  type OutboxEvent,
} from "../src/ledger/outbox";
import {
  processObservationAction,
  processObservationActions,
} from "../src/metacognitive/action-processor";

function makeEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    adapter: "compost-adapter-codex",
    source_id: "codex:session-1:/workspace/Repos/Zylo/Compost",
    source_kind: "local-dir",
    source_uri: "codex:///workspace/Repos/Zylo/Compost",
    idempotency_key: `idem-${Date.now()}-${Math.random()}`,
    trust_tier: "first_party",
    transform_policy: "tp-2026-04",
    payload: JSON.stringify({
      content: "hello world",
      mime_type: "text/plain",
      occurred_at: "2026-05-03T01:00:00.000Z",
    }),
    contexts: [],
    ...overrides,
  };
}

function codexTurnContent(): string {
  return JSON.stringify({
    kind: "codex-turn-summary",
    event: "turn-ended",
    session_id: "019deb01-a140-70d1-940a-b29051026171",
    session_file:
      "/workspace/.codex/sessions/2026/05/02/rollout-2026-05-02T19-24-05-019deb01-a140-70d1-940a-b29051026171.jsonl",
    bytes: { from: 100, to: 240 },
    assistant_messages: [
      "D2-2 action processor landed and action_log started accumulating.",
    ],
  });
}

describe("metacognitive/action-processor", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-actions-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
    upsertPolicies(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("drainOne lifts a Codex turn observation into action_log", () => {
    appendToOutbox(
      db,
      makeEvent({
        payload: JSON.stringify({
          content: codexTurnContent(),
          mime_type: "application/json",
          occurred_at: "2026-05-03T01:00:00.000Z",
          metadata: {
            source: "codex-notify",
            session_file:
              "/workspace/.codex/sessions/2026/05/02/rollout.jsonl",
          },
        }),
      })
    );

    const drained = drainOne(db);
    expect(drained).toBeTruthy();

    const action = db
      .query("SELECT * FROM action_log WHERE source_observe_id = ?")
      .get(drained!.observe_id) as Record<string, string> | null;

    expect(action).toBeTruthy();
    expect(action!.source_system).toBe("codex");
    expect(action!.source_id).toBe(
      "turn:019deb01-a140-70d1-940a-b29051026171:240"
    );
    expect(action!.who).toBe("codex");
    expect(action!.what_text).toContain("D2-2 action processor landed");
    expect(action!.project).toBe("Compost");

    const locations = JSON.parse(action!.artifact_locations) as Record<
      string,
      unknown
    >;
    expect(locations["codex_session_file"]).toBe(
      "/workspace/.codex/sessions/2026/05/02/rollout-2026-05-02T19-24-05-019deb01-a140-70d1-940a-b29051026171.jsonl"
    );
  });

  test("processObservationAction is idempotent for an already lifted observation", () => {
    appendToOutbox(
      db,
      makeEvent({
        payload: JSON.stringify({
          content: codexTurnContent(),
          mime_type: "application/json",
          occurred_at: "2026-05-03T01:00:00.000Z",
        }),
      })
    );

    const drained = drainOne(db);
    expect(drained).toBeTruthy();

    const result = processObservationAction(db, drained!.observe_id);
    expect(result.status).toBe("duplicate");

    const count = db
      .query("SELECT COUNT(*) AS c FROM action_log")
      .get() as { c: number };
    expect(count.c).toBe(1);
  });

  test("plain manual observations become action records", () => {
    appendToOutbox(
      db,
      makeEvent({
        adapter: "codex-manual",
        source_id: "codex-compost-daemon-live-check-2026-05-03",
        source_kind: "claude-code",
        source_uri: "local:launchctl/com.zion.compost-daemon",
        idempotency_key: "manual-daemon-check",
        payload:
          "User asked whether Compost background relies on daemon; Codex verified launchd and daemon status.",
      })
    );

    const drained = drainOne(db);
    expect(drained).toBeTruthy();

    const action = db
      .query("SELECT source_system, source_id, what_text FROM action_log")
      .get() as {
      source_system: string;
      source_id: string;
      what_text: string;
    };

    expect(action.source_system).toBe("codex");
    expect(action.source_id).toBe("codex-compost-daemon-live-check-2026-05-03");
    expect(action.what_text).toContain("Compost background relies on daemon");
  });

  test("explicit payload project wins over a GitHub pull request URI", () => {
    appendToOutbox(
      db,
      makeEvent({
        adapter: "codex",
        source_id: "zyloapp-pr-52",
        source_kind: "host-adapter",
        source_uri: "https://github.com/Bryanh9111/ZyloApp/pull/52",
        idempotency_key: "zyloapp-pr-52",
        payload: JSON.stringify({
          content: JSON.stringify({
            action: "merged",
            project: "ZyloApp",
            pull_request: 52,
          }),
          mime_type: "application/json",
          occurred_at: "2026-08-09T02:44:26.000Z",
        }),
      })
    );

    expect(drainOne(db)).toBeTruthy();

    const action = db
      .query("SELECT project, next_query_hint FROM action_log")
      .get() as { project: string; next_query_hint: string };
    expect(action.project).toBe("ZyloApp");
    expect(action.next_query_hint).toStartWith("ZyloApp:");
  });

  test("GitHub URLs fall back to the repository name", () => {
    appendToOutbox(
      db,
      makeEvent({
        adapter: "codex",
        source_id: "zyloapp-pr-41",
        source_kind: "web",
        source_uri: "https://github.com/Bryanh9111/ZyloApp/pull/41",
        idempotency_key: "zyloapp-pr-41",
        payload: "Merged pull request 41.",
      })
    );

    expect(drainOne(db)).toBeTruthy();

    const action = db.query("SELECT project FROM action_log").get() as {
      project: string;
    };
    expect(action.project).toBe("ZyloApp");
  });

  test("routing contexts beat a filename fallback when project is omitted", () => {
    appendToOutbox(
      db,
      makeEvent({
        adapter: "codex",
        source_id: "perchery-video-pilot",
        source_kind: "local-file",
        source_uri: "video/episodes/perchery-avatar-pilot.md",
        idempotency_key: "perchery-video-pilot",
        payload: "Recorded the presenter pilot result.",
        contexts: ["video", "perchery", "content-production"],
      })
    );

    const drained = drainOne(db);
    expect(drained).toBeTruthy();

    const row = db
      .query(
        `SELECT a.project, o.metadata
         FROM action_log a
         JOIN observations o ON o.observe_id = a.source_observe_id`
      )
      .get() as { project: string; metadata: string };
    expect(row.project).toBe("perchery");
    expect(JSON.parse(row.metadata).contexts).toEqual([
      "video",
      "perchery",
      "content-production",
    ]);
  });

  test("zsh command observations become command timeline actions", () => {
    const commandId = "zsh:mac:4242:2026-05-03T02:00:00.000Z:abc123";
    appendToOutbox(
      db,
      makeEvent({
        adapter: "compost-adapter-zsh",
        source_id: "zsh:example@mac:4242",
        source_kind: "host-adapter",
        source_uri: "zsh://mac/workspace/Repos/Zylo/Compost",
        idempotency_key: "zsh-command-1",
        payload: JSON.stringify({
          content: JSON.stringify({
            kind: "zsh-command",
            command_id: commandId,
            command: "git status --short",
            cwd: "/workspace/Repos/Zylo/Compost",
            exit_status: 0,
            started_at: "2026-05-03T02:00:00.000Z",
            ended_at: "2026-05-03T02:00:01.000Z",
          }),
          mime_type: "application/json",
          occurred_at: "2026-05-03T02:00:01.000Z",
          metadata: { capture: "zsh", command_id: commandId },
        }),
      })
    );

    const drained = drainOne(db);
    expect(drained).toBeTruthy();

    const action = db
      .query("SELECT source_system, source_id, what_text, project FROM action_log")
      .get() as {
      source_system: string;
      source_id: string;
      what_text: string;
      project: string;
    };

    expect(action.source_system).toBe("zsh");
    expect(action.source_id).toBe(commandId);
    expect(action.what_text).toContain("zsh command in Compost exited 0");
    expect(action.what_text).toContain("git status --short");
    expect(action.project).toBe("Compost");
  });

  test("git commit observations become commit timeline actions", () => {
    const commitSha = "6ba90c1a2b3c4d5e6f";
    const commitId = `git:/workspace/Repos/Zylo/Compost:${commitSha}`;
    appendToOutbox(
      db,
      makeEvent({
        adapter: "compost-adapter-git",
        source_id: "git:/workspace/Repos/Zylo/Compost",
        source_kind: "host-adapter",
        source_uri: `git:/workspace/Repos/Zylo/Compost@${commitSha}`,
        idempotency_key: "git-commit-1",
        payload: JSON.stringify({
          content: JSON.stringify({
            kind: "git-commit",
            commit_id: commitId,
            commit_sha: commitSha,
            short_sha: "6ba90c1a2b3c",
            repo_root: "/workspace/Repos/Zylo/Compost",
            repo_name: "Compost",
            branch: "main",
            subject: "feat: capture git commits",
            committed_at: "2026-05-03T03:00:00.000Z",
          }),
          mime_type: "application/json",
          occurred_at: "2026-05-03T03:00:00.000Z",
          metadata: { capture: "git", commit_sha: commitSha },
        }),
      })
    );

    const drained = drainOne(db);
    expect(drained).toBeTruthy();

    const action = db
      .query("SELECT source_system, source_id, what_text, project FROM action_log")
      .get() as {
      source_system: string;
      source_id: string;
      what_text: string;
      project: string;
    };

    expect(action.source_system).toBe("git");
    expect(action.source_id).toBe(commitId);
    expect(action.what_text).toContain("git commit in Compost 6ba90c1a2b3c");
    expect(action.what_text).toContain("feat: capture git commits");
    expect(action.project).toBe("Compost");
  });

  test("Obsidian note observations become note timeline actions", () => {
    const changeId =
      "obsidian:/Users/example/Vaults/Constellation:XHS Knowledge/XHS Knowledge.md:2026-05-03T04:00:00.000Z:2048:updated";
    appendToOutbox(
      db,
      makeEvent({
        adapter: "compost-adapter-obsidian",
        source_id:
          "obsidian:/Users/example/Vaults/Constellation:XHS Knowledge/XHS Knowledge.md",
        source_kind: "host-adapter",
        source_uri: "obsidian://Constellation/XHS Knowledge/XHS Knowledge.md",
        idempotency_key: "obsidian-note-1",
        payload: JSON.stringify({
          content: JSON.stringify({
            kind: "obsidian-note-change",
            change_id: changeId,
            vault_root: "/Users/example/Vaults/Constellation",
            vault_name: "Constellation",
            path: "/Users/example/Vaults/Constellation/XHS Knowledge/XHS Knowledge.md",
            relative_path: "XHS Knowledge/XHS Knowledge.md",
            event: "updated",
            modified_at: "2026-05-03T04:00:00.000Z",
            size_bytes: 2048,
          }),
          mime_type: "application/json",
          occurred_at: "2026-05-03T04:00:00.000Z",
          metadata: {
            capture: "obsidian",
            vault_name: "Constellation",
            relative_path: "XHS Knowledge/XHS Knowledge.md",
          },
        }),
      })
    );

    const drained = drainOne(db);
    expect(drained).toBeTruthy();

    const action = db
      .query(
        "SELECT source_system, source_id, what_text, project, artifact_locations FROM action_log"
      )
      .get() as {
      source_system: string;
      source_id: string;
      what_text: string;
      project: string;
      artifact_locations: string;
    };

    expect(action.source_system).toBe("obsidian");
    expect(action.source_id).toBe(changeId);
    expect(action.what_text).toContain("Obsidian note in Constellation updated");
    expect(action.what_text).toContain("XHS Knowledge/XHS Knowledge.md");
    expect(action.project).toBe("Constellation");

    const locations = JSON.parse(action.artifact_locations) as {
      obsidian: { vault: string; relative_path: string };
    };
    expect(locations.obsidian.vault).toBe("Constellation");
    expect(locations.obsidian.relative_path).toBe(
      "XHS Knowledge/XHS Knowledge.md"
    );
  });

  test("processObservationActions backfills observations without action rows", () => {
    appendToOutbox(
      db,
      makeEvent({
        idempotency_key: "codex-turn",
        payload: JSON.stringify({
          content: codexTurnContent(),
          mime_type: "application/json",
          occurred_at: "2026-05-03T01:00:00.000Z",
        }),
      })
    );
    appendToOutbox(
      db,
      makeEvent({
        adapter: "codex-manual",
        source_id: "codex-v4-docs-push-2026-05-03",
        idempotency_key: "manual-docs",
        source_uri: "git:Compost@0742d38",
        payload: "Docs were aligned to the v4 metacognitive baseline.",
      })
    );

    expect(drainOne(db)).toBeTruthy();
    expect(drainOne(db)).toBeTruthy();

    db.run("DELETE FROM action_log");

    const report = processObservationActions(db, { limit: 10 });
    expect(report.scanned).toBe(2);
    expect(report.inserted).toBe(2);
    expect(report.duplicates).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.errors).toEqual([]);
  });

  test("repeated local-file captures are separate timeline actions", () => {
    const sourceId = "/workspace/Vaults/Constellation/XHS Knowledge/post.md";
    const sourceUri = "file:///workspace/Vaults/Constellation/XHS Knowledge/post.md";
    appendToOutbox(
      db,
      makeEvent({
        adapter: "local-file",
        source_id: sourceId,
        source_kind: "local-file",
        source_uri: sourceUri,
        idempotency_key: "local-v1",
        payload: "draft version",
      })
    );
    appendToOutbox(
      db,
      makeEvent({
        adapter: "local-file",
        source_id: sourceId,
        source_kind: "local-file",
        source_uri: sourceUri,
        idempotency_key: "local-v2",
        payload: "published version",
      })
    );

    expect(drainOne(db)).toBeTruthy();
    expect(drainOne(db)).toBeTruthy();

    const rows = db
      .query(
        "SELECT source_system, source_id, what_text FROM action_log ORDER BY when_ts"
      )
      .all() as {
      source_system: string;
      source_id: string;
      what_text: string;
    }[];

    expect(rows).toHaveLength(2);
    expect(rows[0]!.source_system).toBe("local-file");
    expect(rows[1]!.source_system).toBe("local-file");
    expect(rows[0]!.source_id).not.toBe(rows[1]!.source_id);
    const texts = rows.map((row) => row.what_text).join("\n");
    expect(texts).toContain("draft version");
    expect(texts).toContain("published version");
  });
});
