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
  type ClaimResult,
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
      `INSERT INTO observations VALUES (?,  's1','file:///test',datetime('now'),datetime('now'),'h${i}','r${i}',NULL,NULL,'text/plain','test',${i},'user','idem${i}','tp-2026-04',NULL)`,
      [obsId]
    );
    db.run(
      `INSERT INTO ingest_queue(observe_id, source_kind, priority) VALUES (?, 'local-file', ?)`,
      [obsId, i]
    );
  }
  return observeIds;
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

    // Simulate failure: clear lease
    fail(db, r1.id, r1.lease_token, "test error");

    const r2 = claimOne(db, "w2")!;
    expect(r2.attempts).toBe(2);
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
