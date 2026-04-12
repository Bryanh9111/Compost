import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import { reflect, type ReflectionReport } from "../src/cognitive/reflect";

function insertSource(db: Database, id: string, kind: string): void {
  db.run(
    "INSERT INTO source VALUES (?,?,?,NULL,0.0,'user',datetime('now'),NULL)",
    [id, `file:///${id}`, kind]
  );
}

function insertObservation(
  db: Database,
  obsId: string,
  sourceId: string,
  daysAgo: number
): void {
  db.run(
    `INSERT INTO observations VALUES (?,?,?,datetime('now', ? || ' days'),datetime('now', ? || ' days'),'h','r',NULL,NULL,'text/plain','test',1,'user',?,'tp-2026-04',NULL)`,
    [obsId, sourceId, `file:///${sourceId}`, -daysAgo, -daysAgo, `idem-${obsId}`]
  );
}

function insertFact(db: Database, factId: string, obsId: string): void {
  db.run(
    "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES (?,?,?,?,?)",
    [factId, "subj", "pred", "obj", obsId]
  );
}

describe("cognitive/reflect", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-reflect-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reflect returns empty report on empty database", () => {
    const report = reflect(db);
    expect(report.sensoryObservationsDeleted).toBe(0);
    expect(report.sensoryFactsCascaded).toBe(0);
    expect(report.semanticFactsTombstoned).toBe(0);
    expect(report.outboxRowsPruned).toBe(0);
    expect(report.skippedDueToFkViolation).toBe(0);
    expect(report.errors).toHaveLength(0);
    expect(report.reflectionDurationMs).toBeGreaterThanOrEqual(0);
  });

  // --- Sensory hard-GC ---

  test("sensory GC deletes observations older than 7 days from sensory sources", () => {
    insertSource(db, "sensor-1", "sensory");
    insertObservation(db, "obs-old", "sensor-1", 8); // 8 days ago
    insertObservation(db, "obs-new", "sensor-1", 3); // 3 days ago

    const report = reflect(db);
    expect(report.sensoryObservationsDeleted).toBe(1);

    // Old observation gone
    const old = db.query("SELECT 1 FROM observations WHERE observe_id = 'obs-old'").get();
    expect(old).toBeNull();

    // New observation kept
    const fresh = db.query("SELECT 1 FROM observations WHERE observe_id = 'obs-new'").get();
    expect(fresh).toBeTruthy();
  });

  test("sensory GC does NOT delete non-sensory observations", () => {
    insertSource(db, "file-1", "local-file");
    insertObservation(db, "obs-old-file", "file-1", 30); // 30 days old but non-sensory

    const report = reflect(db);
    expect(report.sensoryObservationsDeleted).toBe(0);

    const row = db.query("SELECT 1 FROM observations WHERE observe_id = 'obs-old-file'").get();
    expect(row).toBeTruthy();
  });

  test("sensory GC cascades to facts", () => {
    insertSource(db, "sensor-1", "sensory");
    insertObservation(db, "obs-old", "sensor-1", 10);
    insertFact(db, "f1", "obs-old");
    insertFact(db, "f2", "obs-old");

    const report = reflect(db);
    expect(report.sensoryObservationsDeleted).toBe(1);
    expect(report.sensoryFactsCascaded).toBe(2);

    const factCount = db.query("SELECT count(*) as cnt FROM facts").get() as { cnt: number };
    expect(factCount.cnt).toBe(0);
  });

  test("sensory GC cascades to ingest_queue", () => {
    insertSource(db, "sensor-1", "sensory");
    insertObservation(db, "obs-old", "sensor-1", 10);
    db.run("INSERT INTO ingest_queue(observe_id, source_kind, priority) VALUES ('obs-old','sensory',1)");

    const report = reflect(db);
    expect(report.sensoryObservationsDeleted).toBe(1);

    const queueCount = db.query("SELECT count(*) as cnt FROM ingest_queue").get() as { cnt: number };
    expect(queueCount.cnt).toBe(0);
  });

  test("sensory GC cascades to captured_item", () => {
    insertSource(db, "sensor-1", "sensory");
    insertObservation(db, "obs-old", "sensor-1", 10);
    db.run("INSERT INTO captured_item VALUES ('sensor-1','ext1',datetime('now'),'obs-old')");

    reflect(db);

    const capCount = db.query("SELECT count(*) as cnt FROM captured_item").get() as { cnt: number };
    expect(capCount.cnt).toBe(0);
  });

  test("sensory GC with zero FK violations", () => {
    insertSource(db, "sensor-1", "sensory");
    insertObservation(db, "obs-old", "sensor-1", 10);
    insertFact(db, "f1", "obs-old");
    db.run("INSERT INTO ingest_queue(observe_id, source_kind, priority) VALUES ('obs-old','sensory',1)");
    db.run("INSERT INTO captured_item VALUES ('sensor-1','ext1',datetime('now'),'obs-old')");

    const report = reflect(db);
    expect(report.skippedDueToFkViolation).toBe(0);
    expect(report.sensoryObservationsDeleted).toBe(1);
  });

  // --- Semantic soft-tombstone ---

  test("semantic tombstone marks decayed facts as archived", () => {
    insertSource(db, "file-1", "local-file");
    insertObservation(db, "obs-1", "file-1", 0);
    insertFact(db, "f-decayed", "obs-1");

    // Set fact to be heavily decayed: very old reinforcement, low importance
    db.run(
      `UPDATE facts
       SET importance = 0.001,
           importance_pinned = FALSE,
           last_reinforced_at_unix_sec = unixepoch() - 86400 * 365,
           half_life_seconds = 86400
       WHERE fact_id = 'f-decayed'`
    );

    const report = reflect(db);
    expect(report.semanticFactsTombstoned).toBe(1);

    const fact = db.query("SELECT archived_at FROM facts WHERE fact_id = 'f-decayed'").get() as {
      archived_at: string | null;
    };
    expect(fact.archived_at).toBeTruthy();
  });

  test("semantic tombstone skips importance_pinned facts", () => {
    insertSource(db, "file-1", "local-file");
    insertObservation(db, "obs-1", "file-1", 0);
    insertFact(db, "f-pinned", "obs-1");

    db.run(
      `UPDATE facts
       SET importance = 0.001,
           importance_pinned = TRUE,
           last_reinforced_at_unix_sec = unixepoch() - 86400 * 365,
           half_life_seconds = 86400
       WHERE fact_id = 'f-pinned'`
    );

    const report = reflect(db);
    expect(report.semanticFactsTombstoned).toBe(0);
  });

  test("semantic tombstone skips already-archived facts", () => {
    insertSource(db, "file-1", "local-file");
    insertObservation(db, "obs-1", "file-1", 0);
    insertFact(db, "f-already", "obs-1");

    db.run(
      `UPDATE facts
       SET importance = 0.001,
           importance_pinned = FALSE,
           last_reinforced_at_unix_sec = unixepoch() - 86400 * 365,
           half_life_seconds = 86400,
           archived_at = datetime('now')
       WHERE fact_id = 'f-already'`
    );

    const report = reflect(db);
    expect(report.semanticFactsTombstoned).toBe(0);
  });

  // --- Outbox prune ---

  test("outbox prune removes drained rows older than 7 days", () => {
    insertSource(db, "s1", "local-file");
    insertObservation(db, "obs-1", "s1", 0);

    // Old drained row
    db.run(
      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,observe_id)
       VALUES ('test','s1','local-file','file:///test','k1','user','tp-2026-04','{}',datetime('now','-8 days'),'obs-1')`
    );
    // Recent drained row
    db.run(
      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,observe_id)
       VALUES ('test','s1','local-file','file:///test','k2','user','tp-2026-04','{}',datetime('now','-1 days'),'obs-1')`
    );
    // Pending row (never drained)
    db.run(
      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload)
       VALUES ('test','s1','local-file','file:///test','k3','user','tp-2026-04','{}')`
    );

    const report = reflect(db);
    expect(report.outboxRowsPruned).toBe(1);

    const remaining = db.query("SELECT count(*) as cnt FROM observe_outbox").get() as { cnt: number };
    expect(remaining.cnt).toBe(2); // recent drained + pending
  });

  test("outbox prune never removes quarantined rows", () => {
    insertSource(db, "s1", "local-file");

    db.run(
      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,drain_quarantined_at)
       VALUES ('test','s1','local-file','file:///test','k1','user','tp-2026-04','{}',datetime('now','-30 days'),datetime('now','-20 days'))`
    );

    const report = reflect(db);
    expect(report.outboxRowsPruned).toBe(0);

    const remaining = db.query("SELECT count(*) as cnt FROM observe_outbox").get() as { cnt: number };
    expect(remaining.cnt).toBe(1);
  });
});
