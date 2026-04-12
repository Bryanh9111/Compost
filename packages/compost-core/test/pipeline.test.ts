import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import { upsertPolicies, getActivePolicy } from "../src/policies/registry";
import { ingestFile, type IngestResult } from "../src/pipeline/ingest";

const FIXTURE_MD = `# Test Document

This is a test document about software architecture.

## Design Principles

Keep it simple. Prefer composition over inheritance.

## Implementation

Use TypeScript for type safety. Write tests first.
`;

describe("pipeline/ingest (end-to-end)", () => {
  let db: Database;
  let tmpDir: string;
  let dataDir: string;
  let fixtureFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-pipeline-"));
    dataDir = join(tmpDir, "compost");
    mkdirSync(dataDir, { mode: 0o700 });

    db = new Database(join(dataDir, "ledger.db"));
    applyMigrations(db);
    upsertPolicies(db);

    fixtureFile = join(tmpDir, "test-doc.md");
    writeFileSync(fixtureFile, FIXTURE_MD);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("ingestFile writes observation + queue + claims + extracts + derivation_run", async () => {
    const result = await ingestFile(db, fixtureFile, dataDir);

    expect(result.ok).toBe(true);
    expect(result.observe_id).toBeTruthy();
    expect(result.derivation_id).toBeTruthy();
    expect(result.chunks_count).toBeGreaterThan(0);
    expect(result.facts_count).toBeGreaterThanOrEqual(0);

    // Verify observation exists
    const obs = db
      .query("SELECT * FROM observations WHERE observe_id = ?")
      .get(result.observe_id!) as Record<string, unknown>;
    expect(obs).toBeTruthy();
    expect(obs.adapter).toBe("local-file");
    expect(obs.transform_policy).toBe(getActivePolicy().id);

    // Verify queue item completed
    const queue = db
      .query(
        "SELECT completed_at FROM ingest_queue WHERE observe_id = ?"
      )
      .get(result.observe_id!) as { completed_at: string | null };
    expect(queue.completed_at).toBeTruthy();

    // Verify derivation_run record
    const deriv = db
      .query(
        "SELECT * FROM derivation_run WHERE derivation_id = ?"
      )
      .get(result.derivation_id!) as Record<string, unknown>;
    expect(deriv).toBeTruthy();
    expect(deriv.observe_id).toBe(result.observe_id);
    expect(deriv.layer).toBe("L1");
    expect(deriv.status).toBe("succeeded");
    expect(deriv.transform_policy).toBe(getActivePolicy().id);

    // Verify outbox was drained
    const outbox = db
      .query("SELECT drained_at FROM observe_outbox WHERE seq = 1")
      .get() as { drained_at: string | null };
    expect(outbox.drained_at).toBeTruthy();
  });

  test("ingestFile is idempotent (same file = no duplicate observations)", async () => {
    const r1 = await ingestFile(db, fixtureFile, dataDir);
    expect(r1.ok).toBe(true);

    // Second ingest of same file: outbox INSERT OR IGNORE deduplicates,
    // drain finds nothing pending, returns gracefully
    const r2 = await ingestFile(db, fixtureFile, dataDir);
    // r2.ok may be false (drain null) or true (no-op) - either is correct behavior

    // Key invariant: still exactly one observation
    const obsCount = db
      .query("SELECT count(*) as cnt FROM observations")
      .get() as { cnt: number };
    expect(obsCount.cnt).toBe(1);
  });

  test("ingestFile handles missing file gracefully", async () => {
    const result = await ingestFile(
      db,
      join(tmpDir, "nonexistent.md"),
      dataDir
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("ingestFile uses active transform_policy", async () => {
    const result = await ingestFile(db, fixtureFile, dataDir);
    expect(result.ok).toBe(true);

    const obs = db
      .query("SELECT transform_policy FROM observations WHERE observe_id = ?")
      .get(result.observe_id!) as { transform_policy: string };
    expect(obs.transform_policy).toBe("tp-2026-04");
  });
});
