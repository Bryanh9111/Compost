/**
 * sqlite-reflect.bench.ts — measures reflect() latency at increasing
 * observation counts.
 *
 * Scope per debate 017 Codex: SQLite-only. No LanceDB, no LLM. This
 * isolates reflect's cost (sensory-GC DELETE + FTS5 trigger fanout)
 * from network noise.
 *
 * Output: one JSON line per fixture size to stdout. CI can jq + compare
 * against a baseline.json (threshold 1.5x p95 ratio fails the build).
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyMigrations } from "../packages/compost-core/src/schema/migrator";
import { upsertPolicies } from "../packages/compost-core/src/policies/registry";
import { reflect } from "../packages/compost-core/src/cognitive/reflect";
import {
  seedSensorySource,
  seedObservations,
  seedFacts,
} from "./lib/gen";
import { runBench, formatResultLine } from "./lib/runner";

const FIXTURE_SIZES = [1_000, 10_000];
// 100k intentionally omitted by default — enable with COMPOST_BENCH_LARGE=true
if (process.env.COMPOST_BENCH_LARGE === "true") {
  FIXTURE_SIZES.push(100_000);
}

async function benchOneSize(size: number): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), `compost-bench-reflect-${size}-`));
  const dbPath = join(dataDir, "ledger.db");

  try {
    const result = await runBench({
      name: `sqlite-reflect-${size}`,
      iters: size >= 10_000 ? 5 : 15,
      warmup: 2,
      setup: () => {
        // Fresh DB each iter so sensory-GC has constant input size.
        rmSync(dbPath, { force: true });
        rmSync(dbPath + "-wal", { force: true });
        rmSync(dbPath + "-shm", { force: true });
        const db = new Database(dbPath, { create: true });
        db.exec("PRAGMA journal_mode=WAL");
        db.exec("PRAGMA foreign_keys=ON");
        applyMigrations(db);
        upsertPolicies(db);
        const sourceId = seedSensorySource(db);
        const obsIds = seedObservations(db, sourceId, size, { daysBack: 30 });
        // Seed facts on ~10% of observations — realistic extraction density.
        seedFacts(db, obsIds, Math.floor(size * 0.1));
        db.close();
      },
      run: () => {
        const db = new Database(dbPath);
        db.exec("PRAGMA journal_mode=WAL");
        db.exec("PRAGMA foreign_keys=ON");
        try {
          reflect(db);
        } finally {
          db.close();
        }
      },
    });

    process.stdout.write(
      formatResultLine(result, {
        fixture_size: size,
        git_sha: (process.env.GITHUB_SHA ?? "local").slice(0, 12),
        layer: "sqlite-reflect",
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
  process.stderr.write(`bench sqlite-reflect failed: ${err}\n`);
  process.exit(1);
});
