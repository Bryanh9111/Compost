import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  detectCuriosityClusters,
  matchFactsToGaps,
  type CuriosityOptions,
  type FactGapMatchOptions,
} from "../../../compost-core/src/cognitive/curiosity";
import type { OpenProblemStatus } from "../../../compost-core/src/cognitive/gap-tracker";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function openDb(): Database {
  const dir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

export function registerCuriosity(program: Command): void {
  const curiosity = program
    .command("curiosity")
    .description(
      "Phase 6 P0 Curiosity agent: `clusters` surfaces gap hotspots (passive); `matches` suggests facts that might answer open gaps (active). Both deterministic, no LLM."
    );

  curiosity
    .command("clusters", { isDefault: true })
    .description(
      "Cluster open gaps by token-level Jaccard overlap and surface hotspots"
    )
    .option(
      "--window-days <n>",
      "Include gaps last asked within this many days",
      (v) => Number.parseInt(v, 10),
      30
    )
    .option(
      "--min-jaccard <f>",
      "Minimum Jaccard overlap (0-1) for two gaps to cluster. Higher = stricter",
      (v) => Number.parseFloat(v),
      0.3
    )
    .option(
      "--max-clusters <n>",
      "Cap on clusters returned (sorted by total_asks desc)",
      (v) => Number.parseInt(v, 10),
      10
    )
    .option(
      "--status <status>",
      "Gap status to cluster over: open | resolved | dismissed",
      "open"
    )
    .option("--json", "Emit JSON report instead of human-readable", false)
    .action((opts) => {
      const db = openDb();
      try {
        const detectOpts: CuriosityOptions = {
          windowDays: opts.windowDays,
          minJaccard: opts.minJaccard,
          maxClusters: opts.maxClusters,
        };
        if (
          opts.status === "open" ||
          opts.status === "resolved" ||
          opts.status === "dismissed"
        ) {
          detectOpts.status = opts.status as OpenProblemStatus;
        }

        const report = detectCuriosityClusters(db, detectOpts);

        if (opts.json) {
          process.stdout.write(JSON.stringify(report, null, 2) + "\n");
          return;
        }

        if (report.clusters.length === 0 && report.unclustered.length === 0) {
          process.stdout.write(
            `(no gaps in last ${report.window_days}d under status filter)\n`
          );
          return;
        }

        if (report.clusters.length > 0) {
          process.stdout.write(`clusters (${report.clusters.length}):\n`);
          for (const c of report.clusters) {
            process.stdout.write(
              `  [${c.total_asks} asks, ${c.gap_ids.length} gaps] ${c.representative}\n`
            );
            process.stdout.write(
              `    shared: ${c.shared_tokens.join(", ") || "(none)"}\n`
            );
          }
          process.stdout.write("\n");
        }

        if (report.unclustered.length > 0) {
          process.stdout.write(`unclustered (${report.unclustered.length}):\n`);
          for (const g of report.unclustered) {
            process.stdout.write(`  [${g.ask_count} asks] ${g.question}\n`);
          }
        }
      } finally {
        db.close();
      }
    });

  curiosity
    .command("matches")
    .description(
      "Scan recent facts for candidates that might answer open gaps. Surfaces per-gap suggestions ordered by token overlap."
    )
    .option(
      "--since-days <n>",
      "Facts created within this many days",
      (v) => Number.parseInt(v, 10),
      7
    )
    .option(
      "--min-overlap <n>",
      "Minimum shared-token overlap to count",
      (v) => Number.parseInt(v, 10),
      2
    )
    .option(
      "--confidence-floor <f>",
      "Facts confidence ≥ this value",
      (v) => Number.parseFloat(v),
      0.75
    )
    .option(
      "--max-candidates-per-gap <n>",
      "Per-gap cap on candidate facts",
      (v) => Number.parseInt(v, 10),
      3
    )
    .option(
      "--max-gaps <n>",
      "Cap on gaps returned",
      (v) => Number.parseInt(v, 10),
      20
    )
    .option("--json", "Emit JSON report", false)
    .option("--only-with-candidates", "Hide gaps with zero candidates", false)
    .action((opts) => {
      const db = openDb();
      try {
        const matchOpts: FactGapMatchOptions = {
          sinceDays: opts.sinceDays,
          minOverlap: opts.minOverlap,
          confidenceFloor: opts.confidenceFloor,
          maxCandidatesPerGap: opts.maxCandidatesPerGap,
          maxGaps: opts.maxGaps,
        };
        let matches = matchFactsToGaps(db, matchOpts);
        if (opts.onlyWithCandidates) {
          matches = matches.filter((m) => m.candidate_facts.length > 0);
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(matches, null, 2) + "\n");
          return;
        }

        if (matches.length === 0) {
          process.stdout.write("(no open gaps in window)\n");
          return;
        }

        for (const m of matches) {
          process.stdout.write(
            `[${m.ask_count} asks] ${m.question}  (${m.problem_id})\n`
          );
          if (m.candidate_facts.length === 0) {
            process.stdout.write("  (no candidate facts)\n");
            continue;
          }
          for (const c of m.candidate_facts) {
            process.stdout.write(
              `  - overlap=${c.overlap} conf=${c.confidence.toFixed(2)} ${c.fact_id}\n    ${c.subject} ${c.predicate} ${c.object}\n`
            );
          }
        }
      } finally {
        db.close();
      }
    });
}
