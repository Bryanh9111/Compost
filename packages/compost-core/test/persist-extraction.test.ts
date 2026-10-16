import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../src/schema/migrator";
import { getActivePolicy, upsertPolicies } from "../src/policies/registry";
import { claimOne } from "../src/queue/lease";
import {
  type ExtractionOutput,
  namespaceExtractionOutput,
  persistExtraction,
} from "../src/pipeline/persist-extraction";

function output(partial: Partial<ExtractionOutput> = {}): ExtractionOutput {
  return {
    observe_id: "unused",
    extractor_version: "test",
    transform_policy: "tp",
    chunks: [
      { chunk_id: "c0", text: "# Heading", metadata: {} },
      { chunk_id: "c1", text: "Body text", metadata: {} },
    ],
    facts: [
      { subject: "Heading", predicate: "describes", object: "Body text", source_chunk_ids: ["c1"] },
    ],
    normalized_content: "",
    content_hash_raw: "raw",
    content_hash_normalized: "norm",
    ...partial,
  };
}

describe("pipeline/persist-extraction", () => {
  let db: Database;
  let policyId: string;

  function seedObservation(observeId: string) {
    db.run(
      `INSERT INTO observations VALUES (?,'s1','file:///a',datetime('now'),datetime('now'),?,?,NULL,NULL,'text/markdown','local-file',1,'user',?,?,NULL,NULL,NULL)`,
      [observeId, `h-${observeId}`, `r-${observeId}`, `k-${observeId}`, policyId]
    );
    db.run("INSERT INTO ingest_queue (observe_id, source_kind, priority) VALUES (?, 'local-file', 1)", [observeId]);
    const claimed = claimOne(db, "test", { observeId })!;
    const derivationId = `d-${observeId}`;
    db.run(
      "INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status) VALUES (?, ?, 'L2', ?, 'running')",
      [derivationId, observeId, policyId]
    );
    return { claimed, derivationId };
  }

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    applyMigrations(db);
    upsertPolicies(db);
    policyId = getActivePolicy().id;
    db.run("INSERT INTO source VALUES ('s1','file:///a','local-file',NULL,0.0,'user',datetime('now'),NULL)");
  });

  afterEach(() => db.close());

  test("namespaceExtractionOutput scopes chunk ids and fact references, idempotently", () => {
    const once = namespaceExtractionOutput(output(), "obs-1");
    expect(once.chunks.map((c) => c.chunk_id)).toEqual(["obs-1:c0", "obs-1:c1"]);
    expect(once.facts[0]?.source_chunk_ids).toEqual(["obs-1:c1"]);
    const twice = namespaceExtractionOutput(once, "obs-1");
    expect(twice).toEqual(once);
  });

  test("two observations with identical local chunk ids both keep their chunks", () => {
    for (const observeId of ["obs-1", "obs-2"]) {
      const { claimed, derivationId } = seedObservation(observeId);
      const result = persistExtraction(db, {
        observeId,
        derivationId,
        policyId,
        output: output(),
        queue: { id: claimed.id, leaseToken: claimed.lease_token },
      });
      expect(result.chunkIds).toEqual([`${observeId}:c0`, `${observeId}:c1`]);
      expect(result.factIds).toHaveLength(1);
    }
    const rows = db
      .query("SELECT chunk_id, observe_id, chunk_index, fact_id, embedded_at FROM chunks ORDER BY observe_id, chunk_index")
      .all() as { chunk_id: string; observe_id: string; chunk_index: number; fact_id: string | null; embedded_at: string | null }[];
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.chunk_id)).toEqual(["obs-1:c0", "obs-1:c1", "obs-2:c0", "obs-2:c1"]);
    expect(rows.every((r) => r.embedded_at === null)).toBe(true);
    const fact1 = (db.query("SELECT fact_id FROM facts WHERE observe_id = 'obs-1'").get() as { fact_id: string }).fact_id;
    // c1 is cited by the fact; c0 falls back to the observation's first fact.
    expect(rows[0]?.fact_id).toBe(fact1);
    expect(rows[1]?.fact_id).toBe(fact1);
  });

  test("marks the derivation succeeded and completes the queue row in the same transaction", () => {
    const { claimed, derivationId } = seedObservation("obs-1");
    persistExtraction(db, {
      observeId: "obs-1",
      derivationId,
      policyId,
      output: output(),
      queue: { id: claimed.id, leaseToken: claimed.lease_token },
    });
    const run = db.query("SELECT status, artifact_ref FROM derivation_run WHERE derivation_id = ?").get(derivationId) as {
      status: string;
      artifact_ref: string;
    };
    expect(run.status).toBe("succeeded");
    expect(JSON.parse(run.artifact_ref)).toEqual({ chunks: 2, facts: 1 });
    const queue = db.query("SELECT completed_at, lease_token FROM ingest_queue WHERE id = ?").get(claimed.id) as {
      completed_at: string | null;
      lease_token: string | null;
    };
    expect(queue.completed_at).toBeTruthy();
    expect(queue.lease_token).toBeNull();
  });

  test("chunks without any fact get a NULL fact_id", () => {
    const { claimed, derivationId } = seedObservation("obs-1");
    persistExtraction(db, {
      observeId: "obs-1",
      derivationId,
      policyId,
      output: output({ facts: [] }),
      queue: { id: claimed.id, leaseToken: claimed.lease_token },
    });
    const rows = db.query("SELECT fact_id FROM chunks").all() as { fact_id: string | null }[];
    expect(rows.map((r) => r.fact_id)).toEqual([null, null]);
  });

  test("replaces facts and chunks left behind by an earlier failed attempt", () => {
    const { claimed, derivationId } = seedObservation("obs-1");
    db.run(
      "INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status) VALUES ('d-failed', 'obs-1', 'L2', ?, 'failed')",
      [policyId]
    );
    db.run("INSERT INTO facts (fact_id, subject, predicate, object, observe_id) VALUES ('stale-fact', 's', 'p', 'o', 'obs-1')");
    db.run(
      `INSERT INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy, embedded_at)
       VALUES ('obs-1:c0', 'obs-1', 'd-failed', 0, 'stale', 'h', 0, 5, ?, datetime('now'))`,
      [policyId]
    );

    const result = persistExtraction(db, {
      observeId: "obs-1",
      derivationId,
      policyId,
      output: output(),
      queue: { id: claimed.id, leaseToken: claimed.lease_token },
    });
    expect(result.replacedFacts).toBe(1);
    expect(result.replacedChunks).toBe(1);
    expect(db.query("SELECT fact_id FROM facts").all()).toEqual([{ fact_id: result.factIds[0] }]);
    const chunks = db.query("SELECT chunk_id, text_content, embedded_at FROM chunks ORDER BY chunk_index").all() as { chunk_id: string; text_content: string; embedded_at: string | null }[];
    expect(chunks.map((c) => [c.chunk_id, c.text_content, c.embedded_at])).toEqual([
      ["obs-1:c0", "# Heading", null],
      ["obs-1:c1", "Body text", null],
    ]);
  });

  test("keeps facts of a run that succeeded under an older policy but re-derives the chunks", () => {
    const { claimed, derivationId } = seedObservation("obs-1");
    db.run(
      "INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status) VALUES ('d-old', 'obs-1', 'L2', 'tp-2026-04', 'succeeded')"
    );
    db.run("INSERT INTO facts (fact_id, subject, predicate, object, observe_id) VALUES ('old-fact', 's', 'p', 'o', 'obs-1')");
    const result = persistExtraction(db, {
      observeId: "obs-1",
      derivationId,
      policyId,
      output: output(),
      queue: { id: claimed.id, leaseToken: claimed.lease_token },
    });
    expect(result.replacedFacts).toBe(0);
    expect((db.query("SELECT count(*) AS n FROM facts").get() as { n: number }).n).toBe(2);
  });

  test("a lost lease rolls back facts, chunks and the derivation transition", () => {
    const { claimed, derivationId } = seedObservation("obs-1");
    expect(() =>
      persistExtraction(db, {
        observeId: "obs-1",
        derivationId,
        policyId,
        output: output(),
        queue: { id: claimed.id, leaseToken: "stolen" },
      })
    ).toThrow("lease was lost");
    expect((db.query("SELECT count(*) AS n FROM facts").get() as { n: number }).n).toBe(0);
    expect((db.query("SELECT count(*) AS n FROM chunks").get() as { n: number }).n).toBe(0);
    const run = db.query("SELECT status FROM derivation_run WHERE derivation_id = ?").get(derivationId) as { status: string };
    expect(run.status).toBe("running");
  });

  test("a superseded derivation throws and leaves the queue row uncompleted", () => {
    const { claimed, derivationId } = seedObservation("obs-1");
    db.run("UPDATE derivation_run SET status = 'failed' WHERE derivation_id = ?", [derivationId]);
    expect(() =>
      persistExtraction(db, {
        observeId: "obs-1",
        derivationId,
        policyId,
        output: output(),
        queue: { id: claimed.id, leaseToken: claimed.lease_token },
      })
    ).toThrow("no longer running");
    const queue = db.query("SELECT completed_at FROM ingest_queue WHERE id = ?").get(claimed.id) as { completed_at: string | null };
    expect(queue.completed_at).toBeNull();
    expect((db.query("SELECT count(*) AS n FROM chunks").get() as { n: number }).n).toBe(0);
  });
});
