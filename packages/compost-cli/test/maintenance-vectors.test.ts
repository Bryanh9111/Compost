import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import type { EmbeddingService } from "../../compost-core/src/embedding/types";
import { VectorStore } from "../../compost-core/src/storage/lancedb";
import {
  assertDaemonStopped,
  canonicalChunkId,
  consolidateVectors,
  localChunkId,
} from "../src/maintenance-vectors";

const DIM = 8;
const stub: EmbeddingService = { model: "stub", dim: DIM, async embed(t) { return t.map(() => new Float32Array(DIM)); } };
const vec = (seed: number) => Float32Array.from({ length: DIM }, (_, i) => (i === seed % DIM ? 1 : 0));
const UUID = "019d88e8-c70a-7000-8000-000000000009";

async function fillStore(dir: string, rows: Array<[string, string, string, number]>) {
  const store = new VectorStore(dir, stub);
  await store.connect();
  await store.upsert(rows.map(([chunk_id, fact_id, observe_id, seed]) => ({ chunk_id, fact_id, observe_id, vector: vec(seed) })));
  await store.close();
}

async function readRefs(dir: string) {
  const store = new VectorStore(dir, stub);
  await store.connect();
  const refs = await store.listChunkRefs();
  const count = await store.countRows();
  await store.close();
  return { refs: refs.sort((a, b) => a.chunk_id.localeCompare(b.chunk_id)), count };
}

describe("maintenance --consolidate-vectors", () => {
  let dataDir: string;
  let db: Database;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "compost-consolidate-"));
    db = new Database(join(dataDir, "ledger.db"));
    applyMigrations(db);
    db.run("INSERT INTO source VALUES ('s1','file:///a','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    for (const id of ["A", "B", "C", "E"]) {
      db.run(
        `INSERT INTO observations VALUES (?,'s1','file:///a',datetime('now'),datetime('now'),?,?,NULL,NULL,'text/markdown','local-file',1,'user',?,'tp-2026-04',NULL,NULL,NULL)`,
        [id, `h-${id}`, `r-${id}`, `k-${id}`]
      );
    }
    // Live index: legacy local ids, one of them colliding across observations.
    await fillStore(join(dataDir, "lancedb"), [
      ["c0", "fA", "A", 0],
      ["c0", "fB", "B", 1],
      [UUID, "fE", "E", 2],
    ]);
    // Older copy: a duplicate of A:c0 (live wins), an extra C:c1, and an orphan Z.
    await fillStore(join(dataDir, "old"), [
      ["c0", "fA-old", "A", 3],
      ["c1", "fC", "C", 4],
      ["c0", "fZ", "Z", 5],
    ]);
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("id helpers namespace extractor-local ids and leave uuids alone", () => {
    expect(localChunkId("A:c3", "A")).toBe("c3");
    expect(localChunkId("c3", "A")).toBe("c3");
    expect(canonicalChunkId("c3", "A")).toBe("A:c3");
    expect(canonicalChunkId("A:c3", "A")).toBe("A:c3");
    expect(canonicalChunkId(UUID, "E")).toBe(UUID);
  });

  test("dry run counts rows, orphans, duplicates and rewrites without touching disk", async () => {
    const report = await consolidateVectors(db, { dataDir, includePrevious: [join(dataDir, "old")], pageSize: 2 });
    expect(report).toMatchObject({
      mode: "dry-run",
      orphans_dropped: 1,
      duplicates_dropped: 1,
      ids_rewritten: 3,
      written: 4,
      previous_dir: null,
    });
    expect(report.sources.map((s) => s.rows)).toEqual([3, 3]);
    expect((await readRefs(join(dataDir, "lancedb"))).count).toBe(3);
    expect(db.query("SELECT count(*) AS n FROM maintenance_audit").get()).toEqual({ n: 0 });
  });

  test("apply writes a merged, namespaced table, swaps it in and keeps the old live index", async () => {
    const report = await consolidateVectors(db, { dataDir, includePrevious: [join(dataDir, "old")], apply: true, pageSize: 2 });
    expect(report.mode).toBe("applied");
    expect(report.written).toBe(4);
    expect(report.previous_dir).toMatch(/lancedb-consolidate-.*-previous$/);
    expect(existsSync(report.previous_dir!)).toBe(true);

    const live = await readRefs(join(dataDir, "lancedb"));
    expect(live.count).toBe(4);
    expect(live.refs.map((r) => [r.chunk_id, r.fact_id])).toEqual([
      [UUID, "fE"],
      ["A:c0", "fA"],
      ["B:c0", "fB"],
      ["C:c1", "fC"],
    ]);
    expect((await readRefs(report.previous_dir!)).count).toBe(3);
    const audit = db.query("SELECT operation, detail_json FROM maintenance_audit").get() as { operation: string; detail_json: string };
    expect(audit.operation).toBe("consolidate-vectors");
    expect(JSON.parse(audit.detail_json).written).toBe(4);

    // Idempotent: a second pass finds nothing to rewrite or drop.
    const again = await consolidateVectors(db, { dataDir, pageSize: 2 });
    expect(again).toMatchObject({ orphans_dropped: 0, duplicates_dropped: 0, ids_rewritten: 0, written: 4 });
  });

  test("apply still retires a live index whose rows are all orphans", async () => {
    const orphanDir = mkdtempSync(join(tmpdir(), "compost-consolidate-orphans-"));
    const orphanDb = new Database(join(orphanDir, "ledger.db"));
    applyMigrations(orphanDb);
    try {
      await fillStore(join(orphanDir, "lancedb"), [["c0", "fZ", "Z", 0]]);
      const report = await consolidateVectors(orphanDb, { dataDir: orphanDir, apply: true });
      expect(report).toMatchObject({ mode: "applied", orphans_dropped: 1, written: 0 });
      expect(existsSync(join(orphanDir, "lancedb"))).toBe(false);
      expect(report.previous_dir).toMatch(/-previous$/);
      expect(existsSync(report.previous_dir!)).toBe(true);
      expect(orphanDb.query("SELECT count(*) AS n FROM maintenance_audit").get()).toEqual({ n: 1 });
    } finally {
      orphanDb.close();
      rmSync(orphanDir, { recursive: true, force: true });
    }
  });

  test("apply with no index at all writes nothing", async () => {
    const empty = mkdtempSync(join(tmpdir(), "compost-consolidate-empty-"));
    try {
      const report = await consolidateVectors(db, { dataDir: empty, apply: true });
      expect(report.written).toBe(0);
      expect(existsSync(join(empty, "lancedb"))).toBe(false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("assertDaemonStopped refuses a live pid and ignores a stale one", () => {
    writeFileSync(join(dataDir, "daemon.pid"), String(process.pid));
    expect(() => assertDaemonStopped(dataDir)).toThrow("daemon running");
    writeFileSync(join(dataDir, "daemon.pid"), "999999999");
    expect(() => assertDaemonStopped(dataDir)).not.toThrow();
    rmSync(join(dataDir, "daemon.pid"));
    expect(() => assertDaemonStopped(dataDir)).not.toThrow();
  });
});
