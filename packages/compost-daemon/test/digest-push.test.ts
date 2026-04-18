import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  type EngramMcpClient,
  PendingWritesQueue,
  type RememberArgs,
} from "../../compost-engram-adapter/src";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import {
  buildDigest,
  type DigestReport,
} from "../../compost-core/src/cognitive/digest";
import { logGap, resolveGap } from "../../compost-core/src/cognitive/gap-tracker";
import { runDigestPushOnce } from "../src/digest-push";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeMcpClient implements EngramMcpClient {
  rememberCalls: RememberArgs[] = [];
  invalidateCalls: Array<{ fact_ids: string[] }> = [];
  failRemember = false;

  async remember(args: RememberArgs) {
    this.rememberCalls.push(args);
    if (this.failRemember) {
      return { ok: false as const, error: "mcp refused" };
    }
    return {
      ok: true as const,
      data: { id: `mem-${this.rememberCalls.length}` },
    };
  }

  async invalidate(args: { fact_ids: string[] }) {
    this.invalidateCalls.push(args);
    return {
      ok: true as const,
      data: {
        invalidated_memory_ids: args.fact_ids.map((f) => `mem-of-${f}`),
        count: args.fact_ids.length,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function insertSource(db: Database, id: string): void {
  db.run(
    "INSERT INTO source VALUES (?,?,?,NULL,0.0,'user',datetime('now'),NULL)",
    [id, `file:///${id}`, "local-file"]
  );
}

function insertObservation(db: Database, obsId: string, sourceId: string): void {
  db.run(
    `INSERT INTO observations VALUES
       (?,?,?,datetime('now','-1 days'),datetime('now','-1 days'),
        'h','r',NULL,NULL,'text/plain','test',1,'user',?,'tp-2026-04',NULL,NULL,NULL)`,
    [obsId, sourceId, `file:///${sourceId}`, `idem-${obsId}`]
  );
}

function insertFact(
  db: Database,
  factId: string,
  obsId: string,
  confidence = 0.9
): void {
  db.run(
    `INSERT INTO facts
       (fact_id, subject, predicate, object, confidence, importance, observe_id, created_at)
     VALUES (?, 'subj', 'pred', 'obj', ?, 0.5, ?, datetime('now','-1 days'))`,
    [factId, confidence, obsId]
  );
}

function insertWikiPage(db: Database, path: string): void {
  db.run(
    `INSERT INTO wiki_pages (path, title, last_synthesis_at, last_synthesis_model)
     VALUES (?, 'T', datetime('now','-1 days'), 'test')`,
    [path]
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDigestPushOnce", () => {
  let tmpDir: string;
  let db: Database;
  let queue: PendingWritesQueue;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-digest-push-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
    queue = new PendingWritesQueue(join(tmpDir, "pending.db"));
  });

  afterEach(() => {
    db.close();
    queue.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("empty report yields skipped-empty — no remember call", async () => {
    const report: DigestReport = buildDigest(db);
    const mcpClient = new FakeMcpClient();

    const outcome = await runDigestPushOnce({ mcpClient, queue, report });
    expect(outcome.status).toBe("skipped-empty");
    if (outcome.status === "skipped-empty") {
      expect(outcome.reason).toBe("no_insight_input");
    }
    expect(mcpClient.rememberCalls).toHaveLength(0);
  });

  test("wiki-only report yields skipped-empty (slice 3 deferral)", async () => {
    insertWikiPage(db, "/topics/foo");
    const report = buildDigest(db);
    expect(report.wiki_rebuilds).toHaveLength(1);
    expect(report.new_facts).toHaveLength(0);

    const mcpClient = new FakeMcpClient();
    const outcome = await runDigestPushOnce({ mcpClient, queue, report });
    expect(outcome.status).toBe("skipped-empty");
    expect(mcpClient.rememberCalls).toHaveLength(0);
  });

  test("report with facts pushes remember call with scope=meta + digest tag", async () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1");
    insertFact(db, "f1", "obs-1", 0.9);
    insertFact(db, "f2", "obs-1", 0.9);
    const report = buildDigest(db);
    expect(report.new_facts).toHaveLength(2);

    const mcpClient = new FakeMcpClient();
    const outcome = await runDigestPushOnce({ mcpClient, queue, report });
    expect(outcome.status).toBe("pushed");
    expect(mcpClient.rememberCalls).toHaveLength(1);

    const call = mcpClient.rememberCalls[0]!;
    expect(call.origin).toBe("compost");
    expect(call.kind).toBe("insight");
    expect(call.scope).toBe("meta");
    expect(call.tags).toEqual(["digest"]);
    expect(call.project).toBeNull();
    expect(new Set(call.source_trace.compost_fact_ids)).toEqual(
      new Set(["f1", "f2"])
    );
  });

  test("resolved gap with fact_id ref contributes to compost_fact_ids", async () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1");
    insertFact(db, "f-answer", "obs-1", 0.9);
    const g = logGap(db, "Q?");
    resolveGap(db, g.problem_id, { factId: "f-answer" });

    const report = buildDigest(db);
    const mcpClient = new FakeMcpClient();
    const outcome = await runDigestPushOnce({ mcpClient, queue, report });
    expect(outcome.status).toBe("pushed");
    // fact_id appears once even though it's in both new_facts AND resolved_gap.refs
    const ids = mcpClient.rememberCalls[0]!.source_trace.compost_fact_ids;
    expect(ids.filter((id) => id === "f-answer")).toHaveLength(1);
  });

  test("custom tags + scope override defaults", async () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1");
    insertFact(db, "f1", "obs-1", 0.9);
    const report = buildDigest(db);

    const mcpClient = new FakeMcpClient();
    const outcome = await runDigestPushOnce({
      mcpClient,
      queue,
      report,
      scope: "project",
      tags: ["digest", "weekly"],
      project: "compost",
    });
    expect(outcome.status).toBe("pushed");
    const call = mcpClient.rememberCalls[0]!;
    expect(call.scope).toBe("project");
    expect(call.tags).toEqual(["digest", "weekly"]);
    expect(call.project).toBe("compost");
  });

  test("remember failure enqueues pending row — ok=true preserved via queue", async () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1");
    insertFact(db, "f1", "obs-1", 0.9);
    const report = buildDigest(db);

    const mcpClient = new FakeMcpClient();
    mcpClient.failRemember = true;
    const outcome = await runDigestPushOnce({ mcpClient, queue, report });
    expect(outcome.status).toBe("pushed");
    if (outcome.status === "pushed") {
      // writeInsight returns ok=true because the failed chunk was queued
      expect(outcome.result.ok).toBe(true);
      expect(outcome.result.outcomes.every((o) => o.status === "pending")).toBe(
        true
      );
    }
    expect(queue.listPending()).toHaveLength(1);
  });
});
