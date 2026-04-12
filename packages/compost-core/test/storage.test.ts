import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { VectorStore } from "../src/storage/lancedb";
import { OllamaEmbeddingService } from "../src/embedding/ollama";

describe("storage/lancedb", () => {
  let tmpDir: string;
  let store: VectorStore;
  const embedding = new OllamaEmbeddingService();

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-lance-test-"));
    store = new VectorStore(join(tmpDir, "lancedb"), embedding);
    await store.connect();
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("starts empty", async () => {
    expect(await store.isEmpty()).toBe(true);
    expect(store.connected).toBe(true);
  });

  test("add and search returns results", async () => {
    const [vec] = await embedding.embed(["The cat sat on the mat"]);
    await store.add([
      {
        chunk_id: "c1",
        fact_id: "f1",
        observe_id: "obs1",
        vector: vec,
      },
    ]);

    expect(await store.isEmpty()).toBe(false);

    const hits = await store.search("cat on mat", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunk_id).toBe("c1");
    expect(hits[0].fact_id).toBe("f1");
    expect(hits[0].score).toBeGreaterThan(0.5);
  });

  test("search on empty store returns empty", async () => {
    const hits = await store.search("anything", 10);
    expect(hits).toHaveLength(0);
  });

  test("add multiple and search ranks by similarity", async () => {
    const vecs = await embedding.embed([
      "Machine learning algorithms",
      "Deep neural networks for NLP",
      "Cooking Italian pasta recipes",
    ]);

    await store.add([
      { chunk_id: "c1", fact_id: "f1", observe_id: "obs1", vector: vecs[0] },
      { chunk_id: "c2", fact_id: "f2", observe_id: "obs1", vector: vecs[1] },
      { chunk_id: "c3", fact_id: "f3", observe_id: "obs2", vector: vecs[2] },
    ]);

    const hits = await store.search("artificial intelligence", 3);
    expect(hits).toHaveLength(3);
    // ML and NLP should rank above cooking
    const mlHit = hits.find((h) => h.chunk_id === "c1" || h.chunk_id === "c2");
    const cookHit = hits.find((h) => h.chunk_id === "c3");
    expect(mlHit!.score).toBeGreaterThan(cookHit!.score);
  });

  test("deleteByObserveId removes matching vectors", async () => {
    const vecs = await embedding.embed(["text A", "text B"]);
    await store.add([
      { chunk_id: "c1", fact_id: "f1", observe_id: "obs1", vector: vecs[0] },
      { chunk_id: "c2", fact_id: "f2", observe_id: "obs2", vector: vecs[1] },
    ]);

    await store.deleteByObserveId("obs1");

    const hits = await store.search("text", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].observe_id).toBe("obs2");
  });

  test("searchByVector works", async () => {
    const vecs = await embedding.embed(["hello world", "goodbye moon"]);
    await store.add([
      { chunk_id: "c1", fact_id: "f1", observe_id: "obs1", vector: vecs[0] },
      { chunk_id: "c2", fact_id: "f2", observe_id: "obs1", vector: vecs[1] },
    ]);

    const hits = await store.searchByVector(vecs[0], 2);
    expect(hits).toHaveLength(2);
    expect(hits[0].chunk_id).toBe("c1");
    expect(hits[0].score).toBeGreaterThan(0.9);
  });

  test("dropTable and re-add works", async () => {
    const [vec] = await embedding.embed(["test"]);
    await store.add([
      { chunk_id: "c1", fact_id: "f1", observe_id: "obs1", vector: vec },
    ]);

    await store.dropTable();
    expect(await store.isEmpty()).toBe(true);

    await store.add([
      { chunk_id: "c2", fact_id: "f2", observe_id: "obs2", vector: vec },
    ]);
    expect(await store.isEmpty()).toBe(false);
  });
});
