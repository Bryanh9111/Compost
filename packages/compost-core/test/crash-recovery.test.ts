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
import { reflect } from "../src/cognitive/reflect";
import { claimOne, complete, fail } from "../src/queue/lease";

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
      content: "test content",
      mime_type: "text/plain",
      occurred_at: new Date().toISOString(),
    }),
    contexts: [],
    ...overrides,
  };
}

describe("crash-recovery", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-crash-"));
    db = new Database(join(tmpDir, "crash.db"));
    applyMigrations(db);
    upsertPolicies(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Scenario 1: Crash during hook sync-append
  // The hook calls appendToOutbox, process dies. On restart the hook calls again
  // with the same idempotency_key. idx_outbox_idempotency (UNIQUE) prevents a
  // duplicate row via INSERT OR IGNORE.
  test("Scenario 1: crash during hook sync-append deduplicates via idempotency index", () => {
    const event = makeEvent({ idempotency_key: "fixed-idem-crash-1" });

    // First append — hook succeeds up to this point then crashes
    appendToOutbox(db, event);

    const countAfterFirst = db
      .query("SELECT count(*) as cnt FROM observe_outbox")
      .get() as { cnt: number };
    expect(countAfterFirst.cnt).toBe(1);

    // Recovery: hook restarts and calls appendToOutbox again with the same key
    appendToOutbox(db, event);

    // INSERT OR IGNORE means exactly one row should exist
    const countAfterRetry = db
      .query("SELECT count(*) as cnt FROM observe_outbox")
      .get() as { cnt: number };
    expect(countAfterRetry.cnt).toBe(1);

    // The row should be undrained — drain has not happened yet
    const row = db
      .query("SELECT drained_at FROM observe_outbox WHERE idempotency_key = ?")
      .get("fixed-idem-crash-1") as { drained_at: string | null };
    expect(row.drained_at).toBeNull();
  });

  // Scenario 2: Crash during daemon drain step 2 (observations insert)
  // Source is registered in the DB but the process dies before the observation
  // row is inserted. On retry drainOne inserts the observation (INSERT OR IGNORE
  // prevents duplicate if it already exists), completing normally.
  test("Scenario 2: crash after source registered but before observation insert — retry succeeds", () => {
    const event = makeEvent({ source_id: "src-crash-2" });
    appendToOutbox(db, event);

    // Simulate partial drain: source registered, observation NOT inserted,
    // outbox still has drained_at = NULL (crash before COMMIT)
    db.run(
      `INSERT OR IGNORE INTO source (id, uri, kind, trust_tier, refresh_sec)
       VALUES ('src-crash-2', 'file:///tmp/crash2.md', 'local-file', 'user', NULL)`
    );

    const obsBefore = db
      .query("SELECT count(*) as cnt FROM observations")
      .get() as { cnt: number };
    expect(obsBefore.cnt).toBe(0);

    // Recovery: daemon retries drainOne
    const result = drainOne(db);

    expect(result).toBeTruthy();
    expect(result!.seq).toBe(1);

    // Observation created
    const obsAfter = db
      .query("SELECT count(*) as cnt FROM observations")
      .get() as { cnt: number };
    expect(obsAfter.cnt).toBe(1);

    // Outbox marked drained
    const outbox = db
      .query("SELECT drained_at FROM observe_outbox WHERE seq = 1")
      .get() as { drained_at: string | null };
    expect(outbox.drained_at).toBeTruthy();
  });

  // Scenario 3: Crash during daemon drain step 4 (queue enqueue)
  // Source and observation exist, but the ingest_queue row was not created and
  // the outbox was not acked (drained_at = NULL). drainOne must:
  //   - re-attempt observation insert (INSERT OR IGNORE — no-op)
  //   - create the queue row (conditional INSERT guards against duplicates)
  //   - ack the outbox row
  test("Scenario 3: crash after observation inserted but before queue row — retry completes", () => {
    const idemKey = "idem-crash-3";
    const event = makeEvent({
      source_id: "src-crash-3",
      idempotency_key: idemKey,
    });
    appendToOutbox(db, event);

    // Simulate partial drain: source + observation written, queue NOT written, no ack
    const obsId = "obs-crash-3-id";
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    db.run(
      `INSERT OR IGNORE INTO source (id, uri, kind, trust_tier, refresh_sec)
       VALUES ('src-crash-3', 'file:///tmp/crash3.md', 'local-file', 'user', NULL)`
    );
    db.run(
      `INSERT INTO observations (
         observe_id, source_id, source_uri, occurred_at, captured_at,
         content_hash, raw_hash, raw_bytes, blob_ref, mime_type,
         adapter, adapter_sequence, trust_tier, idempotency_key,
         transform_policy, metadata
       ) VALUES (?, 'src-crash-3', 'file:///tmp/crash3.md', ?, ?, 'h1', 'r1', NULL, NULL,
                 'text/plain', 'test-adapter', 1, 'user', ?, 'tp-2026-04', NULL)`,
      [obsId, now, now, idemKey]
    );

    const queueBefore = db
      .query("SELECT count(*) as cnt FROM ingest_queue")
      .get() as { cnt: number };
    expect(queueBefore.cnt).toBe(0);

    // outbox drained_at remains NULL (crash before ack)

    // Recovery: drainOne retries
    const result = drainOne(db);

    expect(result).toBeTruthy();

    // Queue row created
    const queueAfter = db
      .query("SELECT count(*) as cnt FROM ingest_queue")
      .get() as { cnt: number };
    expect(queueAfter.cnt).toBe(1);

    // Still exactly one observation (INSERT OR IGNORE was a no-op)
    const obsCount = db
      .query("SELECT count(*) as cnt FROM observations")
      .get() as { cnt: number };
    expect(obsCount.cnt).toBe(1);

    // Outbox acked
    const outbox = db
      .query("SELECT drained_at FROM observe_outbox WHERE seq = 1")
      .get() as { drained_at: string | null };
    expect(outbox.drained_at).toBeTruthy();
  });

  // Scenario 4: Crash during daemon drain step 5 (outbox ack)
  // Observation and queue row are both present, but the process died before the
  // UPDATE that sets drained_at. drainOne must skip existing observation and
  // queue row (both idempotent), then ack the outbox.
  test("Scenario 4: crash after queue enqueued but before outbox ack — retry just acks", () => {
    const idemKey = "idem-crash-4";
    const event = makeEvent({
      source_id: "src-crash-4",
      idempotency_key: idemKey,
    });
    appendToOutbox(db, event);

    // Simulate full drain except ack
    const obsId = "obs-crash-4-id";
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    db.run(
      `INSERT OR IGNORE INTO source (id, uri, kind, trust_tier, refresh_sec)
       VALUES ('src-crash-4', 'file:///tmp/crash4.md', 'local-file', 'user', NULL)`
    );
    db.run(
      `INSERT INTO observations (
         observe_id, source_id, source_uri, occurred_at, captured_at,
         content_hash, raw_hash, raw_bytes, blob_ref, mime_type,
         adapter, adapter_sequence, trust_tier, idempotency_key,
         transform_policy, metadata
       ) VALUES (?, 'src-crash-4', 'file:///tmp/crash4.md', ?, ?, 'h2', 'r2', NULL, NULL,
                 'text/plain', 'test-adapter', 1, 'user', ?, 'tp-2026-04', NULL)`,
      [obsId, now, now, idemKey]
    );
    db.run(
      `INSERT INTO ingest_queue (observe_id, source_kind, priority)
       VALUES (?, 'local-file', 1)`,
      [obsId]
    );

    // outbox drained_at is still NULL
    const outboxBefore = db
      .query("SELECT drained_at FROM observe_outbox WHERE seq = 1")
      .get() as { drained_at: string | null };
    expect(outboxBefore.drained_at).toBeNull();

    // Recovery: drainOne retries
    const result = drainOne(db);

    expect(result).toBeTruthy();

    // Exactly one observation (no duplicate)
    const obsCount = db
      .query("SELECT count(*) as cnt FROM observations")
      .get() as { cnt: number };
    expect(obsCount.cnt).toBe(1);

    // Exactly one queue row (conditional INSERT was a no-op)
    const queueCount = db
      .query("SELECT count(*) as cnt FROM ingest_queue")
      .get() as { cnt: number };
    expect(queueCount.cnt).toBe(1);

    // Outbox now acked
    const outboxAfter = db
      .query("SELECT drained_at FROM observe_outbox WHERE seq = 1")
      .get() as { drained_at: string | null };
    expect(outboxAfter.drained_at).toBeTruthy();
  });

  // Scenario 5: Crash during reflect sensory GC
  // reflect() runs in a transaction for the sensory GC step. Simulating a crash
  // (manual rollback) must leave state intact. A subsequent reflect() call cleans
  // up correctly.
  test("Scenario 5: crash during reflect sensory GC — no partial delete, clean retry", () => {
    // Setup: sensory source + observation older than 7 days + a fact
    db.run(
      "INSERT INTO source VALUES ('sensor-gc-crash', 'file:///sensor', 'sensory', NULL, 0.0, 'user', datetime('now'), NULL)"
    );
    db.run(
      `INSERT INTO observations (
         observe_id, source_id, source_uri, occurred_at, captured_at,
         content_hash, raw_hash, raw_bytes, blob_ref, mime_type,
         adapter, adapter_sequence, trust_tier, idempotency_key,
         transform_policy, metadata
       ) VALUES ('obs-gc-crash', 'sensor-gc-crash', 'file:///sensor',
                 datetime('now', '-10 days'), datetime('now', '-10 days'),
                 'hx', 'rx', NULL, NULL, 'text/plain', 'test-adapter',
                 1, 'user', 'idem-gc-crash', 'tp-2026-04', NULL)`
    );
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES ('f-gc-crash', 's', 'p', 'o', 'obs-gc-crash')"
    );

    // Simulate crash: manually begin and rollback the GC transaction
    db.run("BEGIN");
    db.run(
      `DELETE FROM observations
       WHERE captured_at < datetime('now', '-7 days')
         AND source_id IN (SELECT id FROM source WHERE kind = 'sensory')`
    );
    // "crash" — rollback instead of commit
    db.run("ROLLBACK");

    // Verify: partial delete was rolled back, data intact
    const obsAfterCrash = db
      .query("SELECT 1 FROM observations WHERE observe_id = 'obs-gc-crash'")
      .get();
    expect(obsAfterCrash).toBeTruthy();

    const factAfterCrash = db
      .query("SELECT 1 FROM facts WHERE fact_id = 'f-gc-crash'")
      .get();
    expect(factAfterCrash).toBeTruthy();

    // Recovery: run reflect() normally
    const report = reflect(db);

    expect(report.sensoryObservationsDeleted).toBe(1);
    expect(report.sensoryFactsCascaded).toBe(1);
    expect(report.errors).toHaveLength(0);

    // Data cleaned up
    const obsAfterReflect = db
      .query("SELECT 1 FROM observations WHERE observe_id = 'obs-gc-crash'")
      .get();
    expect(obsAfterReflect).toBeNull();

    const factAfterReflect = db
      .query("SELECT 1 FROM facts WHERE fact_id = 'f-gc-crash'")
      .get();
    expect(factAfterReflect).toBeNull();
  });

  // Scenario 6: Crash during ingest queue extraction
  // Worker claims the queue row (sets lease + increments attempts) then crashes
  // without calling complete() or fail(). After the lease TTL passes a second
  // worker can reclaim the row; attempts increments again.
  test("Scenario 6: crash during ingest queue extraction — expired lease reclaimed with incremented attempts", () => {
    // Seed: source + observation + queue row (mimics successful drainOne)
    db.run(
      "INSERT INTO source VALUES ('src-ingest-crash', 'file:///tmp/ingest-crash.md', 'local-file', NULL, 0.0, 'user', datetime('now'), NULL)"
    );
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    db.run(
      `INSERT INTO observations (
         observe_id, source_id, source_uri, occurred_at, captured_at,
         content_hash, raw_hash, raw_bytes, blob_ref, mime_type,
         adapter, adapter_sequence, trust_tier, idempotency_key,
         transform_policy, metadata
       ) VALUES ('obs-ingest-crash', 'src-ingest-crash', 'file:///tmp/ingest-crash.md',
                 ?, ?, 'hh', 'rr', NULL, NULL, 'text/plain', 'test-adapter',
                 1, 'user', 'idem-ingest-crash', 'tp-2026-04', NULL)`,
      [now, now]
    );
    db.run(
      "INSERT INTO ingest_queue (observe_id, source_kind, priority) VALUES ('obs-ingest-crash', 'local-file', 1)"
    );

    // Worker 1 claims the row — then crashes (never calls complete/fail)
    const claim1 = claimOne(db, "worker-1");
    expect(claim1).toBeTruthy();
    expect(claim1!.attempts).toBe(1);

    // Lease must be set
    const leaseRow = db
      .query("SELECT lease_expires_at, lease_owner FROM ingest_queue WHERE id = ?")
      .get(claim1!.id) as { lease_expires_at: string | null; lease_owner: string | null };
    expect(leaseRow.lease_expires_at).toBeTruthy();
    expect(leaseRow.lease_owner).toBe("worker-1");

    // Simulate time passing: backdate lease_expires_at to the past
    db.run(
      "UPDATE ingest_queue SET lease_expires_at = datetime('now', '-1 seconds') WHERE id = ?",
      [claim1!.id]
    );

    // Worker 2 reclaims the now-expired row
    const claim2 = claimOne(db, "worker-2");
    expect(claim2).toBeTruthy();
    expect(claim2!.id).toBe(claim1!.id);
    expect(claim2!.attempts).toBe(2);
    expect(claim2!.observe_id).toBe("obs-ingest-crash");

    // Worker 2 processes successfully
    const ok = complete(db, claim2!.id, claim2!.lease_token);
    expect(ok).toBe(true);

    // Row is now completed
    const finalRow = db
      .query("SELECT completed_at FROM ingest_queue WHERE id = ?")
      .get(claim2!.id) as { completed_at: string | null };
    expect(finalRow.completed_at).toBeTruthy();
  });
});
