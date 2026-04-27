import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { recoverStaleRuns } from "../src/recovery";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "compost-recovery-"));
}

function openTestDb(dataDir: string): Database {
  const db = new Database(join(dataDir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  const result = applyMigrations(db);
  if (result.errors.length > 0) {
    throw new Error(`Migration failed: ${result.errors[0]?.error}`);
  }
  return db;
}

function seedObservation(db: Database, observeId: string): void {
  db.run(
    `INSERT INTO source (id, uri, kind, trust_tier)
     VALUES (?, ?, 'local-file', 'user')`,
    [`source-${observeId}`, `file:///tmp/${observeId}.txt`]
  );
  db.run(
    `INSERT INTO observations (
      observe_id, source_id, source_uri, occurred_at, captured_at,
      content_hash, raw_hash, raw_bytes, blob_ref, mime_type,
      adapter, adapter_sequence, trust_tier, idempotency_key,
      transform_policy, metadata
    ) VALUES (
      ?, ?, ?, datetime('now'), datetime('now'),
      ?, ?, ?, NULL, 'text/plain',
      'test', 1, 'user', ?, 'tp-test', NULL
    )`,
    [
      observeId,
      `source-${observeId}`,
      `file:///tmp/${observeId}.txt`,
      `content-${observeId}`,
      `raw-${observeId}`,
      Buffer.from(`content ${observeId}`),
      `idem-${observeId}`,
    ]
  );
}

function seedRun(
  db: Database,
  derivationId: string,
  observeId: string,
  status: "running" | "succeeded" | "failed",
  startedAtSql: string
): void {
  seedObservation(db, observeId);
  db.run(
    `INSERT INTO derivation_run (
      derivation_id, observe_id, layer, transform_policy, status, started_at
    ) VALUES (?, ?, 'L2', 'tp-test', ?, ${startedAtSql})`,
    [derivationId, observeId, status]
  );
}

function getRun(db: Database, derivationId: string): {
  status: string;
  finished_at: string | null;
  error: string | null;
} {
  return db
    .query(
      `SELECT status, finished_at, error
       FROM derivation_run
       WHERE derivation_id = ?`
    )
    .get(derivationId) as {
    status: string;
    finished_at: string | null;
    error: string | null;
  };
}

describe("recoverStaleRuns", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    db = openTestDb(tmpDir);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("marks a stale running row as failed", () => {
    seedRun(
      db,
      "deriv-stale",
      "obs-stale",
      "running",
      "datetime('now', '-2 hours')"
    );

    recoverStaleRuns(db);

    const row = getRun(db, "deriv-stale");
    expect(row.status).toBe("failed");
    expect(row.finished_at).toBeTruthy();
    expect(row.error).toBe("daemon restart - reclaimed by recoverStaleRuns");
  });

  test("leaves a fresh running row unchanged", () => {
    seedRun(
      db,
      "deriv-fresh",
      "obs-fresh",
      "running",
      "datetime('now', '-20 minutes')"
    );

    recoverStaleRuns(db);

    const row = getRun(db, "deriv-fresh");
    expect(row.status).toBe("running");
    expect(row.finished_at).toBeNull();
    expect(row.error).toBeNull();
  });

  test("clears only stale rows in a mixed set", () => {
    seedRun(db, "deriv-old", "obs-old", "running", "datetime('now', '-3 hours')");
    seedRun(db, "deriv-new", "obs-new", "running", "datetime('now', '-5 minutes')");
    seedRun(
      db,
      "deriv-done",
      "obs-done",
      "succeeded",
      "datetime('now', '-3 hours')"
    );

    recoverStaleRuns(db);

    expect(getRun(db, "deriv-old").status).toBe("failed");
    expect(getRun(db, "deriv-new").status).toBe("running");
    expect(getRun(db, "deriv-done").status).toBe("succeeded");
  });

  test("does not error when no rows exist", () => {
    expect(() => recoverStaleRuns(db)).not.toThrow();
  });

  test("uses a custom staleHours window", () => {
    seedRun(
      db,
      "deriv-custom-old",
      "obs-custom-old",
      "running",
      "datetime('now', '-10 minutes')"
    );
    seedRun(
      db,
      "deriv-custom-new",
      "obs-custom-new",
      "running",
      "datetime('now', '-2 minutes')"
    );

    recoverStaleRuns(db, { staleHours: 0.1 });

    expect(getRun(db, "deriv-custom-old").status).toBe("failed");
    expect(getRun(db, "deriv-custom-new").status).toBe("running");
  });
});
