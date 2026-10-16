import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startIngestWorker, type Scheduler } from "../src/scheduler";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { getActivePolicy, upsertPolicies } from "../../compost-core/src/policies/registry";
import type { EmbeddingService } from "../../compost-core/src/embedding/types";
import type { ChunkVector } from "../../compost-core/src/storage/lancedb";
import type { ExtractFn } from "../../compost-core/src/pipeline/extractor";
import type { ExtractionOutput } from "../../compost-core/src/pipeline/persist-extraction";

const schedulers: Scheduler[] = [];
const dbs: Database[] = [];
const dirs: string[] = [];

function makeDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  upsertPolicies(db);
  db.run("INSERT INTO source (id, uri, kind, trust_tier) VALUES ('s1', 'file:///t.md', 'local-file', 'first_party')");
  dbs.push(db);
  return db;
}

function seed(db: Database, observeId: string, attempts = 0): void {
  db.run(
    `INSERT INTO observations VALUES (?,'s1','file:///t.md',datetime('now'),datetime('now'),?,?,?,NULL,'text/markdown','test',1,'first_party',?,?,NULL,NULL,NULL)`,
    [observeId, `h-${observeId}`, `r-${observeId}`, Buffer.from("# Title\n\nBody."), `k-${observeId}`, getActivePolicy().id]
  );
  db.run("INSERT INTO ingest_queue (observe_id, source_kind, priority, attempts) VALUES (?, 'local-file', 1, ?)", [observeId, attempts]);
}

function output(observeId: string): ExtractionOutput {
  return {
    observe_id: observeId,
    extractor_version: "test",
    transform_policy: getActivePolicy().id,
    chunks: [
      { chunk_id: "c0", text: "Title", metadata: {} },
      { chunk_id: "c1", text: "Body.", metadata: {} },
    ],
    facts: [{ subject: "Title", predicate: "describes", object: "Body.", source_chunk_ids: ["c1"] }],
    normalized_content: "",
    content_hash_raw: "raw",
    content_hash_normalized: "norm",
  };
}

function fakeEmbedding(failFirst = 0): EmbeddingService & { calls: number } {
  return {
    model: "test",
    dim: 2,
    calls: 0,
    async embed(texts) {
      this.calls++;
      if (this.calls <= failFirst) throw new Error("embedding service down");
      return texts.map(() => new Float32Array([1, 0]));
    },
  };
}

function recorder() {
  return { rows: [] as ChunkVector[], async upsert(rows: ChunkVector[]) { this.rows.push(...rows); } };
}

function start(db: Database, extract: ExtractFn, embeddingService = fakeEmbedding(), vectorStore = recorder()) {
  const dataDir = mkdtempSync(join(tmpdir(), "compost-ingest-worker-"));
  dirs.push(dataDir);
  const scheduler = startIngestWorker(db, {
    embeddingService,
    vectorStore,
    dataDir,
    extract,
    heartbeatMs: 20,
    failureSleepMs: 0,
  });
  schedulers.push(scheduler);
  return { scheduler, vectorStore, embeddingService };
}

async function waitFor(assertion: () => boolean, message: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

const queueRow = (db: Database, observeId: string) =>
  db
    .query("SELECT attempts, last_error, next_attempt_at, quarantined_at, completed_at, lease_token FROM ingest_queue WHERE observe_id = ?")
    .get(observeId) as {
    attempts: number;
    last_error: string | null;
    next_attempt_at: string | null;
    quarantined_at: string | null;
    completed_at: string | null;
    lease_token: string | null;
  };

const runs = (db: Database, observeId: string) =>
  db.query("SELECT derivation_id, status, error FROM derivation_run WHERE observe_id = ? ORDER BY started_at").all(observeId) as {
    derivation_id: string;
    status: string;
    error: string | null;
  }[];

afterEach(() => {
  for (const s of schedulers.splice(0)) s.stop();
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("daemon ingest worker", () => {
  test("persists facts and chunks, completes the row and embeds the chunks", async () => {
    const db = makeDb();
    seed(db, "obs-1");
    let calls = 0;
    const { scheduler, vectorStore } = start(db, async (input) => {
      calls++;
      return output(input.observe_id);
    });

    await waitFor(() => queueRow(db, "obs-1").completed_at !== null, "queue row not completed");
    await waitFor(() => vectorStore.rows.length === 2, "chunks not embedded");

    expect(calls).toBe(1);
    const chunks = db.query("SELECT chunk_id, fact_id, embedded_at FROM chunks ORDER BY chunk_index").all() as { chunk_id: string; fact_id: string; embedded_at: string | null }[];
    expect(chunks.map((c) => c.chunk_id)).toEqual(["obs-1:c0", "obs-1:c1"]);
    const fact = db.query("SELECT fact_id FROM facts").get() as { fact_id: string };
    expect(chunks.every((c) => c.fact_id === fact.fact_id && c.embedded_at !== null)).toBe(true);
    expect(vectorStore.rows.map((r) => r.fact_id)).toEqual([fact.fact_id, fact.fact_id]);
    expect(runs(db, "obs-1").map((r) => r.status)).toEqual(["succeeded"]);
    expect(scheduler.getHealth().error_count).toBe(0);
  });

  test("a failed extraction records the error and backs off instead of hot-looping", async () => {
    const db = makeDb();
    seed(db, "obs-1");
    let calls = 0;
    const { scheduler } = start(db, async () => {
      calls++;
      throw new Error("extractor exploded");
    });

    await waitFor(() => queueRow(db, "obs-1").last_error !== null, "failure not recorded");
    await new Promise((resolve) => setTimeout(resolve, 300));

    const row = queueRow(db, "obs-1");
    expect(calls).toBe(1);
    expect(row.attempts).toBe(1);
    expect(row.completed_at).toBeNull();
    expect(row.last_error).toContain("extractor exploded");
    expect(row.next_attempt_at).not.toBeNull();
    expect(runs(db, "obs-1")).toEqual([expect.objectContaining({ status: "failed", error: "extractor exploded" })]);
    expect(scheduler.getHealth().error_count).toBe(1);
  });

  test("exhausted attempts quarantine the row", async () => {
    const db = makeDb();
    seed(db, "obs-1", 2);
    let calls = 0;
    start(db, async () => {
      calls++;
      throw new Error("still broken");
    });

    await waitFor(() => queueRow(db, "obs-1").quarantined_at !== null, "row not quarantined");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toBe(1);
    const row = queueRow(db, "obs-1");
    expect(row.attempts).toBe(3);
    expect(row.next_attempt_at).toBeNull();
    expect(row.completed_at).toBeNull();
  });

  test("an embedding failure leaves facts committed and the idle sweep catches up", async () => {
    const db = makeDb();
    seed(db, "obs-1");
    const embedding = fakeEmbedding(1);
    const { scheduler, vectorStore } = start(db, async (input) => output(input.observe_id), embedding);

    await waitFor(() => queueRow(db, "obs-1").completed_at !== null, "queue row not completed");
    expect(runs(db, "obs-1").map((r) => r.status)).toEqual(["succeeded"]);
    expect((db.query("SELECT count(*) AS n FROM facts").get() as { n: number }).n).toBe(1);

    await waitFor(() => vectorStore.rows.length === 2, "sweep did not embed the chunks");
    expect(embedding.calls).toBe(2);
    const pending = db.query("SELECT count(*) AS n FROM chunks WHERE embedded_at IS NULL").get() as { n: number };
    expect(pending.n).toBe(0);
    expect(scheduler.getHealth().error_count).toBe(1);
  });

  test("a running derivation left behind by a dead worker is superseded", async () => {
    const db = makeDb();
    seed(db, "obs-1");
    db.run(
      "INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status) VALUES ('stale-run', 'obs-1', 'L2', ?, 'running')",
      [getActivePolicy().id]
    );
    start(db, async (input) => output(input.observe_id));

    await waitFor(() => queueRow(db, "obs-1").completed_at !== null, "queue row not completed");
    const all = runs(db, "obs-1");
    expect(all.find((r) => r.derivation_id === "stale-run")).toEqual({ derivation_id: "stale-run", status: "failed", error: "superseded by re-claim" });
    expect(all.filter((r) => r.status === "succeeded")).toHaveLength(1);
  });

  test("a stolen lease aborts the extraction and persists nothing", async () => {
    const db = makeDb();
    seed(db, "obs-1");
    start(db, (input, { signal }) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        setTimeout(() => resolve(output(input.observe_id)), 600);
      })
    );

    await waitFor(() => runs(db, "obs-1").some((r) => r.status === "running"), "extraction did not start");
    db.run("UPDATE ingest_queue SET lease_token = 'stolen' WHERE observe_id = 'obs-1'");

    await waitFor(() => runs(db, "obs-1").some((r) => r.status === "failed"), "abort not recorded");
    expect(runs(db, "obs-1")[0]?.error).toContain("lease stolen");
    expect((db.query("SELECT count(*) AS n FROM chunks").get() as { n: number }).n).toBe(0);
    const row = queueRow(db, "obs-1");
    expect(row.completed_at).toBeNull();
    expect(row.lease_token).toBe("stolen");
  });
});
