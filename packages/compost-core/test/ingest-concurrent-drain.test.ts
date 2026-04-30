import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { basename, join, resolve } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import { upsertPolicies } from "../src/policies/registry";
import { ingestFile } from "../src/pipeline/ingest";
import {
  appendToOutbox,
  drainOne,
  type OutboxEvent,
} from "../src/ledger/outbox";

function computeHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

function makeIngestFileEvent(filePath: string, content: string): OutboxEvent {
  const absPath = resolve(filePath);

  return {
    adapter: "local-file",
    source_id: absPath,
    source_kind: "local-file",
    source_uri: `file://${absPath}`,
    idempotency_key: computeHash(`local-file:${absPath}:${content}`),
    trust_tier: "user",
    transform_policy: "tp-2026-04",
    payload: JSON.stringify({
      content,
      mime_type: "text/markdown",
      occurred_at: new Date().toISOString(),
      metadata: { filename: basename(absPath) },
    }),
    contexts: [],
  };
}

function createDrainedObservation(
  db: Database,
  filePath: string,
  content: string
): string {
  appendToOutbox(db, makeIngestFileEvent(filePath, content));
  const result = drainOne(db);
  expect(result).not.toBeNull();
  return result!.observe_id;
}

describe("ingestFile concurrent drain reporting", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-ingest-race-"));
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    upsertPolicies(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns ok when drainOne returns null but active facts exist for the observe_id", async () => {
    const content = "# Race note\n\nThe concurrent worker already extracted facts.";
    const filePath = join(tmpDir, "race-note.md");
    writeFileSync(filePath, content);
    const observeId = createDrainedObservation(db, filePath, content);
    const derivationId = "derivation-existing";

    db.run(
      `INSERT INTO derivation_run
       (derivation_id, observe_id, layer, transform_policy, status, finished_at)
       VALUES (?, ?, 'L2', 'tp-2026-04', 'succeeded', datetime('now'))`,
      [derivationId, observeId]
    );
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES ('fact-1','note','has','fact one',?)",
      [observeId]
    );
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES ('fact-2','note','has','fact two',?)",
      [observeId]
    );

    const result = await ingestFile(db, filePath, tmpDir);

    expect(result.ok).toBe(true);
    expect(result.observe_id).toBe(observeId);
    expect(result.derivation_id).toBe(derivationId);
    expect(result.facts_count).toBe(2);
    expect(result.already_drained_by_concurrent_worker).toBe(true);
  });

  test("returns upgraded error when drainOne returns null and no facts exist for the observe_id", async () => {
    const content = "# Empty race note\n\nThe concurrent worker drained only L0.";
    const filePath = join(tmpDir, "empty-race-note.md");
    writeFileSync(filePath, content);
    createDrainedObservation(db, filePath, content);

    const result = await ingestFile(db, filePath, tmpDir);

    expect(result).toEqual({
      ok: false,
      error:
        "drain returned null and no facts found — investigate concurrent drainer or schema corruption",
    });
  });
});
