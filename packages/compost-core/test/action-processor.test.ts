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
    source_id: "codex:session-1:/Users/zion/Repos/Zylo/Compost",
    source_kind: "local-dir",
    source_uri: "codex:///Users/zion/Repos/Zylo/Compost",
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
      "/Users/zion/.codex/sessions/2026/05/02/rollout-2026-05-02T19-24-05-019deb01-a140-70d1-940a-b29051026171.jsonl",
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
              "/Users/zion/.codex/sessions/2026/05/02/rollout.jsonl",
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
      "/Users/zion/.codex/sessions/2026/05/02/rollout-2026-05-02T19-24-05-019deb01-a140-70d1-940a-b29051026171.jsonl"
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
    const sourceId = "/Users/zion/Vaults/Constellation/XHS Knowledge/post.md";
    const sourceUri = "file:///Users/zion/Vaults/Constellation/XHS Knowledge/post.md";
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
