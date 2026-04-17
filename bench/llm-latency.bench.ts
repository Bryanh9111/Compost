/**
 * llm-latency.bench.ts — measures local Ollama roundtrip latency.
 *
 * Network-gated: only runs with COMPOST_BENCH_NETWORK=true. Needs a
 * running Ollama daemon. Without the gate this is a no-op.
 *
 * Rationale (debate 017 Codex): isolate LLM roundtrip from SQLite and
 * LanceDB so a cold Ollama model load doesn't contaminate local retrieval
 * numbers.
 */

import { runBench, formatResultLine } from "./lib/runner";

if (process.env.COMPOST_BENCH_NETWORK !== "true") {
  process.stdout.write(
    JSON.stringify({
      name: "llm-latency",
      skipped: true,
      reason: "COMPOST_BENCH_NETWORK != true",
    }) + "\n"
  );
  process.exit(0);
}

async function main(): Promise<void> {
  const { OllamaLLMService } = await import(
    "../packages/compost-core/src/llm/ollama"
  );
  const llm = new OllamaLLMService();

  try {
    const result = await runBench({
      name: "llm-latency-ping",
      iters: 5,
      warmup: 2,
      run: async () => {
        await llm.generate("ping", { maxTokens: 8, timeoutMs: 10_000 });
      },
    });

    process.stdout.write(
      formatResultLine(result, {
        model: llm.model,
        git_sha: (process.env.GITHUB_SHA ?? "local").slice(0, 12),
        layer: "llm-latency",
      }) + "\n"
    );
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        name: "llm-latency",
        failed: true,
        error: err instanceof Error ? err.message : String(err),
        hint: "Is Ollama running? Try `ollama serve`.",
      }) + "\n"
    );
    process.exit(1);
  }
}

main();
