import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../src/schema/migrator";
import { getActivePolicy, upsertPolicies } from "../src/policies/registry";
import { countPendingChunks, embedPendingChunks } from "../src/pipeline/embed-pending";
import type { ChunkVector } from "../src/storage/lancedb";
import type { EmbeddingService } from "../src/embedding/types";

const DIM = 4;

function vectorFor(text: string): Float32Array {
  return new Float32Array([text.length, 1, 2, 3]);
}

/** Answers well unless a text contains "poison" (wrong dim) or "vanish" (dropped). */
function fakeService(): EmbeddingService & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    model: "fake",
    dim: DIM,
    calls,
    async embed(texts) {
      calls.push(texts);
      if (texts.some((t) => t.includes("outage"))) throw new Error("embedding service down");
      return texts
        .filter((t) => !t.includes("vanish"))
        .map((t) => (t.includes("poison") ? new Float32Array([1]) : vectorFor(t)));
    },
  };
}

function recorderStore() {
  const upserts: ChunkVector[][] = [];
  return { upserts, async upsert(rows: ChunkVector[]) { upserts.push(rows); } };
}

describe("pipeline/embed-pending", () => {
  let db: Database;
  let policyId: string;

  function seedObservation(observeId: string, texts: string[], withFact = true) {
    db.run(
      `INSERT INTO observations VALUES (?,'s1','file:///a',datetime('now'),datetime('now'),?,?,NULL,NULL,'text/markdown','local-file',1,'user',?,?,NULL,NULL,NULL)`,
      [observeId, `h-${observeId}`, `r-${observeId}`, `k-${observeId}`, policyId]
    );
    db.run(
      "INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status) VALUES (?, ?, 'L2', ?, 'succeeded')",
      [`d-${observeId}`, observeId, policyId]
    );
    const factId = withFact ? `f-${observeId}` : null;
    if (factId) {
      db.run("INSERT INTO facts (fact_id, subject, predicate, object, observe_id) VALUES (?, 's', 'p', 'o', ?)", [factId, observeId]);
    }
    texts.forEach((text, index) => {
      db.run(
        `INSERT INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy, fact_id)
         VALUES (?, ?, ?, ?, ?, 'hash', 0, 1, ?, ?)`,
        [`${observeId}:c${index}`, observeId, `d-${observeId}`, index, text, policyId, index === 0 ? factId : null]
      );
    });
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

  test("embeds pending chunks, upserts them with a fact fallback and marks embedded_at", async () => {
    seedObservation("obs-1", ["alpha", "beta"]);
    const store = recorderStore();
    const service = fakeService();

    const result = await embedPendingChunks(db, { embeddingService: service, vectorStore: store });
    expect(result).toEqual({ embedded: 2, failed: 0, remaining: 0 });
    expect(service.calls).toEqual([["alpha", "beta"]]);
    expect(store.upserts).toHaveLength(1);
    expect(store.upserts[0]?.map((r) => [r.chunk_id, r.fact_id])).toEqual([
      ["obs-1:c0", "f-obs-1"],
      ["obs-1:c1", "f-obs-1"],
    ]);
    expect(store.upserts[0]?.[1]?.vector).toEqual(vectorFor("beta"));

    const rows = db.query("SELECT embedded_at, embed_error FROM chunks").all() as { embedded_at: string | null; embed_error: string | null }[];
    expect(rows.every((r) => r.embedded_at !== null && r.embed_error === null)).toBe(true);
    expect(countPendingChunks(db)).toEqual({ pending: 0, failed: 0 });

    // Idempotent: nothing left, no further service call.
    expect(await embedPendingChunks(db, { embeddingService: service, vectorStore: store })).toEqual({ embedded: 0, failed: 0, remaining: 0 });
    expect(service.calls).toHaveLength(1);
  });

  test("chunks of observations without facts get an orphan fact id", async () => {
    seedObservation("obs-1", ["alpha"], false);
    const store = recorderStore();
    await embedPendingChunks(db, { embeddingService: fakeService(), vectorStore: store });
    expect(store.upserts[0]?.[0]?.fact_id).toBe("orphan:obs-1:0");
  });

  test("observeId scopes the sweep and limit bounds a call", async () => {
    seedObservation("obs-1", ["a", "b", "c"]);
    seedObservation("obs-2", ["d"]);
    const store = recorderStore();
    const service = fakeService();

    const first = await embedPendingChunks(db, { embeddingService: service, vectorStore: store, observeId: "obs-1", limit: 2 });
    expect(first).toEqual({ embedded: 2, failed: 0, remaining: 1 });
    expect(countPendingChunks(db, "obs-2")).toEqual({ pending: 1, failed: 0 });

    const second = await embedPendingChunks(db, { embeddingService: service, vectorStore: store, observeId: "obs-1", limit: 2 });
    expect(second).toEqual({ embedded: 1, failed: 0, remaining: 0 });
    expect(countPendingChunks(db)).toEqual({ pending: 1, failed: 0 });
  });

  test("a wrong-shaped batch is retried per chunk and the offenders are isolated", async () => {
    seedObservation("obs-1", ["alpha", "poison pill", "vanishing text", "gamma"]);
    const store = recorderStore();
    const service = fakeService();

    const result = await embedPendingChunks(db, { embeddingService: service, vectorStore: store });
    expect(result).toEqual({ embedded: 2, failed: 2, remaining: 0 });
    expect(service.calls).toHaveLength(5); // one batch + four single retries
    expect(store.upserts[0]?.map((r) => r.chunk_id)).toEqual(["obs-1:c0", "obs-1:c3"]);

    const failed = db
      .query("SELECT chunk_id, embed_error FROM chunks WHERE embed_error IS NOT NULL ORDER BY chunk_index")
      .all() as { chunk_id: string; embed_error: string }[];
    expect(failed.map((r) => r.chunk_id)).toEqual(["obs-1:c1", "obs-1:c2"]);
    expect(failed[0]?.embed_error).toContain("dim 1");
    expect(failed[1]?.embed_error).toContain("no vector");
    expect(countPendingChunks(db)).toEqual({ pending: 0, failed: 2 });

    // Isolated chunks are not picked up again.
    expect(await embedPendingChunks(db, { embeddingService: service, vectorStore: store })).toEqual({ embedded: 0, failed: 0, remaining: 0 });
  });

  test("a service outage propagates and marks nothing", async () => {
    seedObservation("obs-1", ["outage now", "beta"]);
    const store = recorderStore();
    await expect(embedPendingChunks(db, { embeddingService: fakeService(), vectorStore: store })).rejects.toThrow("down");
    expect(store.upserts).toHaveLength(0);
    expect(countPendingChunks(db)).toEqual({ pending: 2, failed: 0 });
  });
});
