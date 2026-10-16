import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OllamaEmbeddingService } from "../src/embedding/ollama";

type Mode = "ok" | "short" | "wrong-dim" | "error" | "slow";

// Exercises every ollama.ts branch against an in-process fake, so the
// coverage gate does not depend on a live Ollama.
describe("embedding/ollama against a fake server", () => {
  let server: ReturnType<typeof Bun.serve>;
  let mode: Mode = "ok";
  const calls: number[] = [];

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { input: string[] };
        calls.push(body.input.length);
        if (mode === "error") return new Response("boom", { status: 500 });
        if (mode === "slow") await Bun.sleep(300);
        const dim = mode === "wrong-dim" ? 4 : 768;
        const count = mode === "short" ? body.input.length - 1 : body.input.length;
        const embeddings = Array.from({ length: count }, () => new Array(dim).fill(0.5));
        return Response.json({ model: "fake", embeddings });
      },
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  const service = (overrides: Partial<{ timeoutMs: number; batchSize: number }> = {}) =>
    new OllamaEmbeddingService({ baseUrl: `http://127.0.0.1:${server.port}`, ...overrides });

  test("returns one Float32Array per input and batches by batchSize", async () => {
    mode = "ok";
    calls.length = 0;
    const vectors = await service({ batchSize: 2 }).embed(["a", "b", "c"]);
    expect(vectors).toHaveLength(3);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(vectors[0]?.length).toBe(768);
    expect(calls).toEqual([2, 1]);
  });

  test("empty input makes no request", async () => {
    calls.length = 0;
    expect(await service().embed([])).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("rejects when the server returns fewer embeddings than inputs", async () => {
    mode = "short";
    await expect(service().embed(["a", "b"])).rejects.toThrow("returned 1 embeddings for 2 inputs");
  });

  test("rejects when a vector has the wrong dimension", async () => {
    mode = "wrong-dim";
    await expect(service().embed(["a"])).rejects.toThrow("Expected dim=768, got 4");
  });

  test("rejects on a non-2xx response with the status code", async () => {
    mode = "error";
    await expect(service().embed(["a"])).rejects.toThrow("Ollama embed failed (500)");
  });

  test("rejects when the request exceeds timeoutMs", async () => {
    mode = "slow";
    await expect(service({ timeoutMs: 50 }).embed(["a"])).rejects.toThrow();
  });
});
