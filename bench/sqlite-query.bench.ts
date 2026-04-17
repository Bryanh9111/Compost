/**
 * sqlite-query.bench.ts — measures BM25-only query() latency.
 *
 * Scope per debate 017 Codex: no vectorStore passed to query() → no
 * LanceDB ANN, no embeddings, pure FTS5 + Stage-2 rerank. Isolates the
 * SQLite retrieval path from Ollama/LanceDB network variance.
 *
 * Output: one JSON line per fixture size to stdout.
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyMigrations } from "../packages/compost-core/src/schema/migrator";
import { upsertPolicies } from "../packages/compost-core/src/policies/registry";
import { query } from "../packages/compost-core/src/query/search";
import {
  seedSensorySource,
  seedObservations,
  seedFacts,
} from "./lib/gen";
import { runBench, formatResultLine } from "./lib/runner";

const FIXTURE_SIZES = [1_000, 10_000];
if (process.env.COMPOST_BENCH_LARGE === "true") {
  FIXTURE_SIZES.push(100_000);
}

async function benchOneSize(size: number): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), `compost-bench-query-${size}-`));
  const dbPath = join(dataDir, "ledger.db");

  try {
    // Setup: seed ONCE, reuse DB across iterations. Query is read-only
    // so each run sees identical state. Warmup naturally fills the page
    // cache so we measure warm-cache behavior — cold-cache is a separate
    // concern (see debate 016 Codex I3).
    const db = new Database(dbPath, { create: true });
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    upsertPolicies(db);
    const sourceId = seedSensorySource(db);
    const obsIds = seedObservations(db, sourceId, size, { daysBack: 1 });
    // 80% of observations produce a fact — matches observed extraction density.
    seedFacts(db, obsIds, Math.floor(size * 0.8));
    db.close();

    const queryDb = new Database(dbPath);
    queryDb.exec("PRAGMA journal_mode=WAL");
    queryDb.exec("PRAGMA foreign_keys=ON");

    const result = await runBench({
      name: `sqlite-query-bm25-${size}`,
      iters: size >= 10_000 ? 10 : 20,
      warmup: 5,
      run: async () => {
        // "compost" is the most common token in seeded data (LOREM_TOKENS[0]).
        // Hits count roughly matches fixture density.
        await query(queryDb, "compost", { budget: 20 });
      },
    });

    queryDb.close();

    process.stdout.write(
      formatResultLine(result, {
        fixture_size: size,
        git_sha: (process.env.GITHUB_SHA ?? "local").slice(0, 12),
        layer: "sqlite-query-bm25",
      }) + "\n"
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  for (const size of FIXTURE_SIZES) {
    await benchOneSize(size);
  }
}

main().catch((err) => {
  process.stderr.write(`bench sqlite-query failed: ${err}\n`);
  process.exit(1);
});
