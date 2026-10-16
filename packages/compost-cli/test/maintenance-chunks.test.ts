import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import type { ExtractFn } from "../../compost-core/src/pipeline/extractor";
import type { ChunkRef } from "../../compost-core/src/storage/lancedb";
import { backfillChunks, countBackfillCandidates, listBackfillCandidates } from "../src/maintenance-chunks";

function fakeExtract(chunksPer: Record<string, number>): ExtractFn & { calls: string[] } {
  const calls: string[] = [];
  const fn: ExtractFn = async (input) => {
    calls.push(input.observe_id);
    if (!input.skip_llm_facts) throw new Error("backfill must skip LLM facts");
    const n = chunksPer[input.observe_id] ?? 0;
    return {
      observe_id: input.observe_id,
      extractor_version: "test",
      transform_policy: input.transform_policy,
      chunks: Array.from({ length: n }, (_, i) => ({ chunk_id: `c${i}`, text: `chunk ${i} of ${input.observe_id}`, metadata: {} })),
      facts: [],
      normalized_content: "",
      content_hash_raw: "raw",
      content_hash_normalized: "norm",
    };
  };
  return Object.assign(fn, { calls });
}

function fakeVectors(refs: ChunkRef[]) {
  return { deleted: [] as string[][], async listChunkRefs() { return refs; }, async deleteByObserveIds(ids: string[]) { this.deleted.push(ids); } };
}

describe("maintenance --backfill-chunks", () => {
  let db: Database;

  function seed(observeId: string, expectedChunks: number, existingChunks = 0) {
    db.run(
      `INSERT INTO observations VALUES (?,'s1','file:///a',datetime('now'),datetime('now'),?,?,?,NULL,'text/markdown','local-file',1,'user',?,'tp-2026-04',NULL,NULL,NULL)`,
      [observeId, `h-${observeId}`, `r-${observeId}`, Buffer.from(`# ${observeId}`), `k-${observeId}`]
    );
    db.run(
      "INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status, finished_at, artifact_ref) VALUES (?, ?, 'L2', 'tp-2026-04', 'succeeded', datetime('now'), ?)",
      [`d-${observeId}`, observeId, JSON.stringify({ chunks: expectedChunks, facts: 1 })]
    );
    db.run("INSERT INTO facts (fact_id, subject, predicate, object, observe_id) VALUES (?, 's', 'p', 'o', ?)", [`f-${observeId}`, observeId]);
    for (let i = 0; i < existingChunks; i++) {
      db.run(
        `INSERT INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy, embedded_at)
         VALUES (?, ?, ?, ?, 'old', 'h', 0, 3, 'tp-2026-04', datetime('now'))`,
        [`${observeId}:c${i}`, observeId, `d-${observeId}`, i]
      );
    }
  }

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    applyMigrations(db);
    db.run("INSERT INTO source VALUES ('s1','file:///a','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    seed("A", 2); // vectors for both chunks -> matched
    seed("B", 2); // vector for one chunk only -> mismatched, vectors dropped
    seed("C", 2); // no vectors -> mismatched, left pending
    seed("D", 2, 2); // manifest complete -> not a candidate
    seed("P", 3, 1); // legacy partial manifest -> only the missing rows are added
    seed("Q", 2, 1); // legacy partial manifest with a missing vector -> whole observation re-embedded
  });

  afterEach(() => db.close());

  test("lists observations whose manifest is shorter than their recorded chunk count", () => {
    expect(listBackfillCandidates(db).map((c) => [c.observe_id, c.expected_chunks, c.existing_chunks])).toEqual([
      ["A", 2, 0],
      ["B", 2, 0],
      ["C", 2, 0],
      ["P", 3, 1],
      ["Q", 2, 1],
    ]);
    expect(countBackfillCandidates(db)).toBe(5);
    expect(listBackfillCandidates(db, 2)).toHaveLength(2);
  });

  test("dry run reports candidates without extracting", async () => {
    const extract = fakeExtract({});
    const report = await backfillChunks(db, { extract });
    expect(report).toMatchObject({ mode: "dry-run", candidates: 5, processed: 0, inserted_rows: 0 });
    expect(report.sample).toEqual(["A", "B", "C", "P", "Q"]);
    expect(extract.calls).toEqual([]);
  });

  test("apply inserts embedded rows when vectors match, pending rows otherwise, and drops stale vectors", async () => {
    const extract = fakeExtract({ A: 2, B: 2, C: 2, P: 3, Q: 2 });
    const vectors = fakeVectors([
      { chunk_id: "A:c0", fact_id: "fA", observe_id: "A" },
      { chunk_id: "c1", fact_id: "fA", observe_id: "A" }, // legacy-form id still resolves
      { chunk_id: "B:c0", fact_id: "fB", observe_id: "B" },
      { chunk_id: "P:c0", fact_id: "fP", observe_id: "P" },
      { chunk_id: "P:c1", fact_id: "fP", observe_id: "P" },
      { chunk_id: "P:c2", fact_id: "fP", observe_id: "P" },
      { chunk_id: "Q:c0", fact_id: "fQ", observe_id: "Q" },
    ]);

    const report = await backfillChunks(db, { apply: true, extract, vectors, concurrency: 3 });
    expect(report).toMatchObject({ mode: "applied", candidates: 5, processed: 5, matched: 2, mismatched: 3, failed: 0, inserted_rows: 9 });
    expect(extract.calls.sort()).toEqual(["A", "B", "C", "P", "Q"]);
    expect(vectors.deleted.sort()).toEqual([["B"], ["Q"]]);
    // Q's pre-existing embedded row is reset so the sweep re-embeds the whole observation.
    expect(
      db.query("SELECT chunk_id, embedded_at FROM chunks WHERE observe_id = 'Q' ORDER BY chunk_index").all()
    ).toEqual([
      { chunk_id: "Q:c0", embedded_at: null },
      { chunk_id: "Q:c1", embedded_at: null },
    ]);

    const rows = db
      .query("SELECT chunk_id, fact_id, embedded_at IS NOT NULL AS embedded FROM chunks ORDER BY observe_id, chunk_index")
      .all() as { chunk_id: string; fact_id: string | null; embedded: number }[];
    expect(rows.filter((r) => r.chunk_id.startsWith("A:"))).toEqual([
      { chunk_id: "A:c0", fact_id: "fA", embedded: 1 },
      { chunk_id: "A:c1", fact_id: "fA", embedded: 1 },
    ]);
    expect(rows.filter((r) => r.chunk_id.startsWith("B:")).every((r) => r.fact_id === "f-B" && r.embedded === 0)).toBe(true);
    expect(rows.filter((r) => r.chunk_id.startsWith("C:")).every((r) => r.embedded === 0)).toBe(true);
    expect(rows.filter((r) => r.chunk_id.startsWith("P:")).map((r) => [r.chunk_id, r.embedded])).toEqual([
      ["P:c0", 1],
      ["P:c1", 1],
      ["P:c2", 1],
    ]);
    expect(db.query("SELECT operation FROM maintenance_audit").get()).toEqual({ operation: "backfill-chunks" });

    expect(countBackfillCandidates(db)).toBe(0);
    expect(await backfillChunks(db, { apply: true, extract, vectors })).toMatchObject({ candidates: 0, processed: 0 });
  });

  test("an extraction failure is counted and does not stop the batch", async () => {
    const extract: ExtractFn = async (input) => {
      if (input.observe_id === "B") throw new Error("python exploded");
      return fakeExtract({ A: 2, C: 2, P: 3, Q: 2 })(input, { timeoutMs: 1 });
    };
    const report = await backfillChunks(db, { apply: true, extract, vectors: null, limit: 3 });
    expect(report.candidates).toBe(5);
    expect(report.processed).toBe(3);
    expect(report.failed).toBe(1);
    expect(report.errors).toEqual([{ observe_id: "B", message: "python exploded" }]);
    expect(countBackfillCandidates(db)).toBe(3);
  });
});
