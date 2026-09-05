import { expect, test, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { withOllamaLock } from "../src/ollama/lock";
import { OllamaEmbeddingService } from "../src/embedding/ollama";

test("cancelled search leaves another caller’s Ollama lock untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compost-search-lock-"));
  const lock = join(dir, "held");
  mkdirSync(lock);
  writeFileSync(
    join(lock, "owner.json"),
    JSON.stringify({ token: "other", acquiredAt: new Date().toISOString() }),
  );
  const previous = process.env.ZYLO_OLLAMA_LOCK_DIR;
  process.env.ZYLO_OLLAMA_LOCK_DIR = lock;
  const controller = new AbortController();
  let ran = false;
  try {
    const waiting = withOllamaLock(
      "search",
      async () => {
        ran = true;
      },
      controller.signal,
    );
    controller.abort();
    await expect(waiting).rejects.toThrow();
    expect(ran).toBe(false);
    expect(existsSync(lock)).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.ZYLO_OLLAMA_LOCK_DIR;
    else process.env.ZYLO_OLLAMA_LOCK_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aborting an embedding request releases the acquired lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compost-embed-abort-"));
  const lock = join(dir, "lock"),
    previous = process.env.ZYLO_OLLAMA_LOCK_DIR;
  process.env.ZYLO_OLLAMA_LOCK_DIR = lock;
  let received!: () => void;
  const arrived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        received();
      }),
  );
  try {
    const svc = new OllamaEmbeddingService({ baseUrl: "http://test.invalid" });
    const controller = new AbortController();
    const result = svc.embed(["中文检索"], controller.signal);
    await arrived;
    controller.abort();
    await expect(result).rejects.toThrow();
    expect(existsSync(lock)).toBe(false);
  } finally {
    fetchMock.mockRestore();
    if (previous === undefined) delete process.env.ZYLO_OLLAMA_LOCK_DIR;
    else process.env.ZYLO_OLLAMA_LOCK_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
