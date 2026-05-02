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

function makeEvent(overrides?: Partial<OutboxEvent>): OutboxEvent {
  return {
    adapter: "test-adapter",
    source_id: "test:src:1",
    source_kind: "local-file",
    source_uri: "file:///tmp/test.md",
    idempotency_key: `idem-${Date.now()}-${Math.random()}`,
    trust_tier: "user",
    transform_policy: "tp-2026-04",
    payload: JSON.stringify({
      content: "hello world",
      mime_type: "text/plain",
      occurred_at: new Date().toISOString(),
    }),
    contexts: [],
    ...overrides,
  };
}

describe("ledger/outbox", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-ledger-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
    upsertPolicies(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- appendToOutbox ---

  test("appendToOutbox inserts a row into observe_outbox", () => {
    const event = makeEvent();
    appendToOutbox(db, event);

    const row = db.query("SELECT * FROM observe_outbox WHERE seq = 1").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.adapter).toBe("test-adapter");
    expect(row.source_id).toBe("test:src:1");
    expect(row.source_kind).toBe("local-file");
    expect(row.idempotency_key).toBe(event.idempotency_key);
    expect(row.drained_at).toBeNull();
    expect(row.drain_attempts).toBe(0);
  });

  test("appendToOutbox is idempotent (same idempotency_key)", () => {
    const event = makeEvent({ idempotency_key: "fixed-key" });
    appendToOutbox(db, event);
    appendToOutbox(db, event);

    const count = db
      .query("SELECT count(*) as cnt FROM observe_outbox")
      .get() as { cnt: number };
    expect(count.cnt).toBe(1);
  });

  test("appendToOutbox different idempotency_keys create separate rows", () => {
    appendToOutbox(db, makeEvent({ idempotency_key: "key-1" }));
    appendToOutbox(db, makeEvent({ idempotency_key: "key-2" }));

    const count = db
      .query("SELECT count(*) as cnt FROM observe_outbox")
      .get() as { cnt: number };
    expect(count.cnt).toBe(2);
  });

  // --- drainOne ---

  test("drainOne returns null when outbox is empty", () => {
    const result = drainOne(db);
    expect(result).toBeNull();
  });

  test("drainOne processes a single outbox row end-to-end", () => {
    const event = makeEvent();
    appendToOutbox(db, event);

    const result = drainOne(db);

    expect(result).toBeTruthy();
    expect(result!.observe_id).toBeTruthy();
    expect(result!.seq).toBe(1);

    // Outbox row should be marked drained
    const outboxRow = db.query("SELECT drained_at, observe_id FROM observe_outbox WHERE seq = 1").get() as Record<string, unknown>;
    expect(outboxRow.drained_at).toBeTruthy();
    expect(outboxRow.observe_id).toBe(result!.observe_id);

    // Source should be auto-registered
    const source = db.query("SELECT * FROM source WHERE id = ?").get(event.source_id) as Record<string, unknown>;
    expect(source).toBeTruthy();
    expect(source.kind).toBe("local-file");
    expect(source.uri).toBe("file:///tmp/test.md");

    // Observation should exist
    const obs = db.query("SELECT * FROM observations WHERE observe_id = ?").get(result!.observe_id) as Record<string, unknown>;
    expect(obs).toBeTruthy();
    expect(obs.source_id).toBe(event.source_id);
    expect(obs.adapter).toBe("test-adapter");
    expect(obs.idempotency_key).toBe(event.idempotency_key);
    expect(obs.transform_policy).toBe("tp-2026-04");

    // Ingest queue should have an entry
    const queue = db.query("SELECT * FROM ingest_queue WHERE observe_id = ?").get(result!.observe_id) as Record<string, unknown>;
    expect(queue).toBeTruthy();
    expect(queue.source_kind).toBe("local-file");
  });

  test("drainOne auto-registers source_context links", () => {
    // First create context entries
    db.run("INSERT INTO context (id, display_name) VALUES ('work', 'Work')");
    db.run("INSERT INTO context (id, display_name) VALUES ('project-x', 'Project X')");

    const event = makeEvent({ contexts: ["work", "project-x"] });
    appendToOutbox(db, event);
    drainOne(db);

    const links = db
      .query("SELECT context_id FROM source_context WHERE source_id = ? ORDER BY context_id")
      .all(event.source_id) as { context_id: string }[];
    expect(links).toHaveLength(2);
    expect(links[0].context_id).toBe("project-x");
    expect(links[1].context_id).toBe("work");
  });

  test("drainOne skips quarantined rows", () => {
    const event = makeEvent();
    appendToOutbox(db, event);

    // Simulate quarantine
    db.run(
      "UPDATE observe_outbox SET drain_quarantined_at = datetime('now'), drain_attempts = 6 WHERE seq = 1"
    );

    const result = drainOne(db);
    expect(result).toBeNull();
  });

  test("drainOne increments drain_attempts and quarantines after 5 failures", () => {
    const event = makeEvent({
      // Empty payload — explicitly rejected by v4 consumer-flexibility tolerance
      // (see outbox-payload-tolerance.test.ts case 4). Plain non-JSON strings now
      // auto-wrap successfully (v4 turn 2026-05-02), so use empty string here to
      // trigger the legitimate drain-failure path that this test exercises.
      payload: "",
    });
    appendToOutbox(db, event);

    // Simulate 5 prior failures
    db.run("UPDATE observe_outbox SET drain_attempts = 5 WHERE seq = 1");

    const result = drainOne(db);
    // Should fail and quarantine
    expect(result).toBeNull();

    const row = db.query("SELECT drain_attempts, drain_quarantined_at FROM observe_outbox WHERE seq = 1").get() as {
      drain_attempts: number;
      drain_quarantined_at: string | null;
    };
    expect(row.drain_attempts).toBe(6);
    expect(row.drain_quarantined_at).toBeTruthy();
  });

  test("drain handles crash-retry: second drain of same event is idempotent", () => {
    const event = makeEvent();
    appendToOutbox(db, event);

    const result1 = drainOne(db);
    expect(result1).toBeTruthy();

    // Append same event again (simulating hook retry with same idempotency_key)
    appendToOutbox(db, event);

    // Only one outbox row should exist (INSERT OR IGNORE)
    const count = db.query("SELECT count(*) as cnt FROM observe_outbox").get() as { cnt: number };
    expect(count.cnt).toBe(1);

    // Observations should also only have one row
    const obsCount = db.query("SELECT count(*) as cnt FROM observations").get() as { cnt: number };
    expect(obsCount.cnt).toBe(1);
  });

  test("drain processes outbox rows in seq order", () => {
    appendToOutbox(db, makeEvent({ idempotency_key: "first", source_id: "s1" }));
    appendToOutbox(db, makeEvent({ idempotency_key: "second", source_id: "s2" }));
    appendToOutbox(db, makeEvent({ idempotency_key: "third", source_id: "s3" }));

    const r1 = drainOne(db);
    const r2 = drainOne(db);
    const r3 = drainOne(db);
    const r4 = drainOne(db);

    expect(r1!.seq).toBe(1);
    expect(r2!.seq).toBe(2);
    expect(r3!.seq).toBe(3);
    expect(r4).toBeNull();
  });

  test("observations UNIQUE constraint prevents duplicate on drain retry", () => {
    const event = makeEvent();
    appendToOutbox(db, event);

    drainOne(db);

    // Manually reset outbox to simulate crash between COMMIT and ack
    db.run("UPDATE observe_outbox SET drained_at = NULL WHERE seq = 1");

    // Re-drain should succeed (INSERT OR IGNORE on observations)
    const result = drainOne(db);
    expect(result).toBeTruthy();

    // Still only one observation
    const obsCount = db.query("SELECT count(*) as cnt FROM observations").get() as { cnt: number };
    expect(obsCount.cnt).toBe(1);
  });
});
