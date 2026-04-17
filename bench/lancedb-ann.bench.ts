/**
 * lancedb-ann.bench.ts — measures LanceDB ANN search latency.
 *
 * Network-gated: only runs with COMPOST_BENCH_NETWORK=true. Without the
 * gate this is a no-op so CI on machines without Ollama + LanceDB
 * accessible can still pass the suite.
 *
 * Rationale (debate 017 Codex): isolate embedding + ANN from SQLite so
 * a slow LanceDB merge doesn't skew sqlite-query numbers.
 *
 * Current status: STUB. Full implementation defers to Phase 5 when the
 * Engram adapter lands and we have a realistic embedding workload.
 */

if (process.env.COMPOST_BENCH_NETWORK !== "true") {
  process.stdout.write(
    JSON.stringify({
      name: "lancedb-ann",
      skipped: true,
      reason: "COMPOST_BENCH_NETWORK != true",
    }) + "\n"
  );
  process.exit(0);
}

// Full implementation pending Phase 5 engram adapter — intentional.
process.stdout.write(
  JSON.stringify({
    name: "lancedb-ann",
    skipped: true,
    reason: "full implementation deferred to Phase 5 (needs engram adapter context for realistic fixture)",
  }) + "\n"
);
process.exit(0);
