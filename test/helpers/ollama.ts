/**
 * Shared guard for tests that need a live Ollama. CI has no Ollama, so
 * those suites skip instead of failing; set COMPOST_TEST_SKIP_OLLAMA=1 to
 * force the skip locally and reproduce the CI run.
 */
const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
let cached: Promise<boolean> | null = null;

export function ollamaAvailable(): Promise<boolean> {
  if (process.env.COMPOST_TEST_SKIP_OLLAMA === "1") return Promise.resolve(false);
  cached ??= fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(1000) })
    .then((res) => res.ok)
    .catch(() => false);
  return cached;
}
