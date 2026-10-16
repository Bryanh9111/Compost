import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { EmbeddingService } from "../src/embedding/types";
import { VectorStore } from "../src/storage/lancedb";

const DIM = 768;

const stubEmbedding: EmbeddingService = {
  model: "stub",
  dim: DIM,
  async embed(texts) {
    return texts.map(() => new Float32Array(DIM).fill(0.1));
  },
};

function unitVector(axis: number): Float32Array {
  const v = new Float32Array(DIM);
  v[axis] = 1;
  return v;
}

// Real LanceDB in a temp dir with synthetic vectors: no Ollama needed.
describe("storage/lancedb upsert, delete and optimize", () => {
  let dir: string;
  let store: VectorStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "compost-lance-upsert-"));
    store = new VectorStore(join(dir, "lancedb"), stubEmbedding);
    await store.connect();
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("upsert creates the table and replaces rows by chunk_id", async () => {
    await store.upsert([
      { chunk_id: "obs-1:c0", fact_id: "f1", observe_id: "obs-1", vector: unitVector(0) },
      { chunk_id: "obs-1:c1", fact_id: "f1", observe_id: "obs-1", vector: unitVector(1) },
    ]);
    expect(await store.countRows()).toBe(2);

    await store.upsert([{ chunk_id: "obs-1:c0", fact_id: "f9", observe_id: "obs-1", vector: unitVector(5) }]);
    expect(await store.countRows()).toBe(2);

    const [best] = await store.searchByVector(unitVector(5), 1);
    expect(best?.chunk_id).toBe("obs-1:c0");
    expect(best?.fact_id).toBe("f9");
    expect(best?.score).toBeCloseTo(1, 5);
  });

  test("upsert of an empty batch is a no-op before the table exists", async () => {
    await store.upsert([]);
    expect(await store.countRows()).toBe(0);
    expect(await store.isEmpty()).toBe(true);
  });

  test("deleteByObserveIds removes only the listed observations and escapes quotes", async () => {
    await store.upsert([
      { chunk_id: "a:c0", fact_id: "f", observe_id: "a", vector: unitVector(0) },
      { chunk_id: "b:c0", fact_id: "f", observe_id: "b", vector: unitVector(1) },
      { chunk_id: "it's:c0", fact_id: "f", observe_id: "it's", vector: unitVector(2) },
    ]);
    await store.deleteByObserveIds(["a", "it's", "missing"]);
    expect(await store.countRows()).toBe(1);
    expect(await store.countRows("observe_id = 'b'")).toBe(1);
    await store.deleteByObserveId("b");
    expect(await store.countRows()).toBe(0);
  });

  test("optimize keeps every row", async () => {
    for (let i = 0; i < 5; i++) {
      await store.upsert([{ chunk_id: `o:c${i}`, fact_id: "f", observe_id: "o", vector: unitVector(i) }]);
    }
    await store.optimize({ cleanupOlderThan: new Date() });
    expect(await store.countRows()).toBe(5);
  });

  test("delete and count on an unconnected table are harmless", async () => {
    await store.deleteByObserveIds(["x"]);
    await store.optimize();
    expect(await store.countRows()).toBe(0);
  });
});
