import { describe, test, expect } from "bun:test";
import { OllamaEmbeddingService } from "../src/embedding/ollama";

describe("embedding/ollama", () => {
  const svc = new OllamaEmbeddingService();

  test("model and dim are correct", () => {
    expect(svc.model).toBe("nomic-embed-text:v1.5");
    expect(svc.dim).toBe(768);
  });

  test("embed single text returns Float32Array of dim 768", async () => {
    const results = await svc.embed(["hello world"]);
    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[0].length).toBe(768);
  });

  test("embed batch returns correct count", async () => {
    const results = await svc.embed(["foo", "bar", "baz"]);
    expect(results).toHaveLength(3);
    for (const vec of results) {
      expect(vec).toBeInstanceOf(Float32Array);
      expect(vec.length).toBe(768);
    }
  });

  test("embed empty array returns empty", async () => {
    const results = await svc.embed([]);
    expect(results).toHaveLength(0);
  });

  test("similar texts have higher cosine similarity than dissimilar", async () => {
    const vecs = await svc.embed([
      "The cat sat on the mat",
      "A cat was sitting on a mat",
      "Quantum mechanics describes subatomic particles",
    ]);

    const cosine = (a: Float32Array, b: Float32Array): number => {
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    };

    const simSimilar = cosine(vecs[0], vecs[1]);
    const simDissimilar = cosine(vecs[0], vecs[2]);

    expect(simSimilar).toBeGreaterThan(simDissimilar);
    expect(simSimilar).toBeGreaterThan(0.8);
  });

  test("embed with wrong model throws", async () => {
    const bad = new OllamaEmbeddingService({ model: "nonexistent-model" });
    expect(bad.embed(["test"])).rejects.toThrow();
  });
});
