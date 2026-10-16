import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  claimOne,
  heartbeat,
  complete,
  fail,
  requeueQuarantined,
  ingestQueueCounts,
} from "../src/queue/lease";

function seedTestData(db: Database, count: number = 1): string[] {
  db.run(
    "INSERT INTO source VALUES ('s1','file:///test','local-file',NULL,0.0,'user',datetime('now'),NULL)"
  );

  const observeIds: string[] = [];
  for (let i = 1; i <= count; i++) {
    const obsId = `obs-${i}`;
    observeIds.push(obsId);
    db.run(
      `INSERT INTO observations VALUES (?,  's1','file:///test',datetime('now'),datetime('now'),'h${i}','r${i}',NULL,NULL,'text/plain','test',${i},'user','idem${i}','tp-2026-04',NULL,NULL,NULL)`,
      [obsId]
    );
    db.run(
      `INSERT INTO ingest_queue(observe_id, source_kind, priority) VALUES (?, 'local-file', ?)`,
      [obsId, i]
    );
  }
  return observeIds;
}

function dueNow(db: Database, id: number): void {
  db.run("UPDATE ingest_queue SET next_attempt_at = datetime('now', '-1 seconds') WHERE id = ?", [id]);
}

function secondsUntilNextAttempt(db: Database, id: number): number {
  const row = db
    .query("SELECT strftime('%s', next_attempt_at) - strftime('%s', 'now') AS delta FROM ingest_queue WHERE id = ?")
    .get(id) as { delta: number };
  return row.delta;
}

describe("queue/lease", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-queue-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- claimOne ---

  test("claimOne returns null on empty queue", () => {
    const result = claimOne(db, "worker-1");
    expect(result).toBeNull();
  });

  test("claimOne claims the highest-priority pending row", () => {
    seedTestData(db, 3);

    const result = claimOne(db, "worker-1");
    expect(result).toBeTruthy();
    expect(result!.observe_id).toBe("obs-1"); // priority 1 (lowest number = highest priority)
    expect(result!.attempts).toBe(1);
    expect(result!.lease_token).toBeTruthy();
  });

  test("claimOne sets lease_owner, lease_token, lease_expires_at", () => {
    seedTestData(db);

    const result = claimOne(db, "worker-1")!;

    const row = db
      .query("SELECT lease_owner, lease_token, lease_expires_at FROM ingest_queue WHERE id = ?")
      .get(result.id) as {
      lease_owner: string;
      lease_token: string;
      lease_expires_at: string;
    };

    expect(row.lease_owner).toBe("worker-1");
    expect(row.lease_token).toBe(result.lease_token);
    expect(row.lease_expires_at).toBeTruthy();
  });

  test("claimOne skips rows with active leases", () => {
    seedTestData(db, 2);

    const r1 = claimOne(db, "worker-1");
    const r2 = claimOne(db, "worker-2");

    expect(r1!.observe_id).toBe("obs-1");
    expect(r2!.observe_id).toBe("obs-2");
  });

  test("claimOne reclaims expired leases", () => {
    seedTestData(db);

    // Claim then expire the lease
    const r1 = claimOne(db, "worker-1")!;
    db.run(
      "UPDATE ingest_queue SET lease_expires_at = datetime('now', '-1 seconds') WHERE id = ?",
      [r1.id]
    );

    // Another worker can now claim it
    const r2 = claimOne(db, "worker-2");
    expect(r2).toBeTruthy();
    expect(r2!.id).toBe(r1.id);
    expect(r2!.attempts).toBe(2); // incremented again
  });

  test("claimOne skips completed rows", () => {
    seedTestData(db);

    const r1 = claimOne(db, "worker-1")!;
    complete(db, r1.id, r1.lease_token);

    const r2 = claimOne(db, "worker-1");
    expect(r2).toBeNull();
  });

  test("claimOne increments attempts on each claim", () => {
    seedTestData(db);

    const r1 = claimOne(db, "w1")!;
    expect(r1.attempts).toBe(1);

    // Simulate failure, then let the backoff elapse
    fail(db, r1.id, r1.lease_token, "test error");
    dueNow(db, r1.id);

    const r2 = claimOne(db, "w2")!;
    expect(r2.attempts).toBe(2);
  });

  // --- retry policy (0028) ---

  test("fail schedules a backoff and claimOne skips the row until it is due", () => {
    seedTestData(db);
    const r1 = claimOne(db, "w1")!;
    fail(db, r1.id, r1.lease_token, "boom");

    expect(secondsUntilNextAttempt(db, r1.id)).toBeWithin(55, 65);
    expect(claimOne(db, "w1")).toBeNull();

    dueNow(db, r1.id);
    expect(claimOne(db, "w1")!.attempts).toBe(2);
  });

  test("backoff doubles per attempt and is capped at 15 minutes", () => {
    seedTestData(db);
    const r1 = claimOne(db, "w1")!;
    fail(db, r1.id, r1.lease_token, "first");
    expect(secondsUntilNextAttempt(db, r1.id)).toBeWithin(55, 65);

    dueNow(db, r1.id);
    const r2 = claimOne(db, "w1")!;
    fail(db, r2.id, r2.lease_token, "second");
    expect(secondsUntilNextAttempt(db, r2.id)).toBeWithin(115, 125);

    db.run("UPDATE ingest_queue SET attempts = 10, quarantined_at = NULL WHERE id = ?", [r1.id]);
    dueNow(db, r1.id);
    const r3 = claimOne(db, "w1", { maxRetries: 100 })!;
    fail(db, r3.id, r3.lease_token, "tenth", { maxRetries: 100 });
    expect(secondsUntilNextAttempt(db, r3.id)).toBeWithin(895, 905);
  });

  test("the third failure quarantines the row and it is never claimed again", () => {
    seedTestData(db);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = claimOne(db, "w1")!;
      expect(claimed.attempts).toBe(attempt);
      fail(db, claimed.id, claimed.lease_token, `failure ${attempt}`);
      if (attempt < 3) dueNow(db, claimed.id);
    }
    const row = db
      .query("SELECT quarantined_at, next_attempt_at, last_error FROM ingest_queue")
      .get() as { quarantined_at: string | null; next_attempt_at: string | null; last_error: string };
    expect(row.quarantined_at).toBeTruthy();
    expect(row.next_attempt_at).toBeNull();
    expect(row.last_error).toBe("failure 3");
    expect(claimOne(db, "w1")).toBeNull();
    expect(ingestQueueCounts(db)).toEqual({ pending: 0, quarantined: 1 });
  });

  test("claimOne quarantines rows whose attempts are exhausted without a fail()", () => {
    seedTestData(db);
    db.run("UPDATE ingest_queue SET attempts = 3, lease_expires_at = datetime('now', '-1 seconds')");

    expect(claimOne(db, "w1")).toBeNull();
    const row = db
      .query("SELECT quarantined_at, last_error, lease_token FROM ingest_queue")
      .get() as { quarantined_at: string | null; last_error: string | null; lease_token: string | null };
    expect(row.quarantined_at).toBeTruthy();
    expect(row.last_error).toBe("attempts exhausted");
    expect(row.lease_token).toBeNull();
  });

  test("maxRetries can be lowered per caller", () => {
    seedTestData(db);
    const claimed = claimOne(db, "w1", { maxRetries: 1 })!;
    fail(db, claimed.id, claimed.lease_token, "once", { maxRetries: 1 });
    expect(ingestQueueCounts(db)).toEqual({ pending: 0, quarantined: 1 });
  });

  test("observeId filter claims only that observation's row", () => {
    seedTestData(db, 2);
    expect(claimOne(db, "w1", { observeId: "obs-2" })!.observe_id).toBe("obs-2");
    expect(claimOne(db, "w1", { observeId: "obs-9" })).toBeNull();
    expect(claimOne(db, "w1")!.observe_id).toBe("obs-1");
  });

  test("requeueQuarantined resets quarantine, backoff and attempts", () => {
    seedTestData(db, 2);
    db.run("UPDATE ingest_queue SET attempts = 3, quarantined_at = datetime('now'), last_error = 'x'");
    expect(ingestQueueCounts(db)).toEqual({ pending: 0, quarantined: 2 });

    expect(requeueQuarantined(db, 1)).toBe(1);
    expect(ingestQueueCounts(db)).toEqual({ pending: 1, quarantined: 1 });
    const claimed = claimOne(db, "w1")!;
    expect(claimed.id).toBe(1);
    expect(claimed.attempts).toBe(1);

    expect(requeueQuarantined(db)).toBe(1);
    expect(ingestQueueCounts(db)).toEqual({ pending: 2, quarantined: 0 });
  });

  // --- heartbeat ---

  test("heartbeat extends lease and returns true", () => {
    seedTestData(db);
    const claimed = claimOne(db, "w1")!;

    const ok = heartbeat(db, claimed.id, claimed.lease_token);
    expect(ok).toBe(true);
  });

  test("heartbeat returns false if lease was stolen", () => {
    seedTestData(db);
    const claimed = claimOne(db, "w1")!;

    // Simulate lease theft
    db.run("UPDATE ingest_queue SET lease_token = 'stolen' WHERE id = ?", [
      claimed.id,
    ]);

    const ok = heartbeat(db, claimed.id, claimed.lease_token);
    expect(ok).toBe(false);
  });

  // --- complete ---

  test("complete marks row done and clears lease", () => {
    seedTestData(db);
    const claimed = claimOne(db, "w1")!;

    const ok = complete(db, claimed.id, claimed.lease_token);
    expect(ok).toBe(true);

    const row = db
      .query(
        "SELECT completed_at, lease_owner, lease_token, lease_expires_at FROM ingest_queue WHERE id = ?"
      )
      .get(claimed.id) as Record<string, unknown>;

    expect(row.completed_at).toBeTruthy();
    expect(row.lease_owner).toBeNull();
    expect(row.lease_token).toBeNull();
    expect(row.lease_expires_at).toBeNull();
  });

  test("complete returns false with wrong lease_token", () => {
    seedTestData(db);
    const claimed = claimOne(db, "w1")!;

    const ok = complete(db, claimed.id, "wrong-token");
    expect(ok).toBe(false);
  });

  // --- fail ---

  test("fail clears lease and records error without setting completed_at", () => {
    seedTestData(db);
    const claimed = claimOne(db, "w1")!;

    const ok = fail(db, claimed.id, claimed.lease_token, "extraction timeout");
    expect(ok).toBe(true);

    const row = db
      .query(
        "SELECT completed_at, last_error, lease_owner, lease_token, lease_expires_at FROM ingest_queue WHERE id = ?"
      )
      .get(claimed.id) as Record<string, unknown>;

    expect(row.completed_at).toBeNull();
    expect(row.last_error).toBe("extraction timeout");
    expect(row.lease_owner).toBeNull();
    expect(row.lease_token).toBeNull();
    expect(row.lease_expires_at).toBeNull();
  });

  test("fail returns false with wrong lease_token", () => {
    seedTestData(db);
    const claimed = claimOne(db, "w1")!;

    const ok = fail(db, claimed.id, "wrong-token", "err");
    expect(ok).toBe(false);
  });
});
